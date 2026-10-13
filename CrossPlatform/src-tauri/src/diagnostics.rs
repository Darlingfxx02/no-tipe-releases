use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Listener};

const MAX_ENTRIES: usize = 4_000;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const EVENTS: &[&str] = &[
    "app-error", "audio-error", "delivery-notice", "permissions-needed", "navigate",
    "data-changed", "voice-profile-changed", "text-models-changed", "model-catalog-changed",
    "model-download", "file-transcription-progress", "cloud-state", "cloud-active",
    "cloud-dock", "cloud-audio", "cloud-pointer", "shortcut-reserved", "shortcut-modifier",
];
static LOGGER: OnceLock<Logger> = OnceLock::new();
static APP_VERSION: OnceLock<String> = OnceLock::new();
static SECRETS: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: u64,
    timestamp: String,
    level: String,
    source: String,
    message: String,
    details: Value,
    session: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub enabled: bool,
    entries: Vec<Entry>,
    storage_error: Option<String>,
    max_entries: usize,
}

struct Inner {
    enabled: bool,
    entries: VecDeque<(Entry, usize)>,
    bytes: usize,
    disk_bytes: usize,
    next_id: u64,
    storage_error: Option<String>,
    samples: HashMap<String, (Instant, String)>,
}

pub struct Logger {
    path: PathBuf,
    session: String,
    inner: Mutex<Inner>,
}

impl Logger {
    fn open(root: &Path, enabled: bool) -> Self {
        let path = root.join("diagnostics/events.jsonl");
        let mut inner = Inner {
            enabled, entries: VecDeque::new(), bytes: 0, disk_bytes: 0, next_id: 1,
            storage_error: None, samples: HashMap::new(),
        };
        match fs::File::open(&path) {
            Ok(mut file) => {
                let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                inner.disk_bytes = size as usize;
                // A crash or an older build must not allow unbounded reads.
                if size > (MAX_BYTES * 2) as u64 {
                    let _ = file.seek(SeekFrom::End(-((MAX_BYTES * 2) as i64)));
                }
                for line in BufReader::new(file).lines().map_while(Result::ok) {
                    if let Ok(mut entry) = serde_json::from_str::<Entry>(&line) {
                        entry.message = redact(&entry.message);
                        entry.details = safe_details(&entry.details);
                        inner.next_id = inner.next_id.max(entry.id.saturating_add(1));
                        let bytes = serde_json::to_vec(&entry).map(|v| v.len() + 1).unwrap_or(0);
                        inner.bytes += bytes;
                        inner.entries.push_back((entry, bytes));
                        trim(&mut inner);
                    } else { inner.disk_bytes = MAX_BYTES * 2; }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => inner.storage_error = Some(redact(&error.to_string())),
        }
        Self { path, session: uuid::Uuid::new_v4().to_string(), inner: Mutex::new(inner) }
    }

    fn set_enabled(&self, enabled: bool) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false; };
        if inner.enabled == enabled { return false; }
        if inner.enabled {
            self.append(&mut inner, "info", "app", "developer-mode.disabled", Value::Null);
        }
        inner.enabled = enabled;
        inner.samples.clear();
        if enabled {
            self.append(&mut inner, "info", "app", "developer-mode.enabled", system_details());
        }
        true
    }

    fn record(&self, level: &str, source: &str, message: &str, details: Value, sampled: bool) {
        let Ok(mut inner) = self.inner.lock() else { return; };
        if !inner.enabled { return; }
        let details = safe_details(&details);
        if sampled {
            let key = format!("{source}:{message}");
            // Keep every phase/error transition. Continuous meters, pointer
            // samples and unchanged polling responses use at most one row/s.
            let fingerprint = if message == "cloud-state" {
                json!([details["state"], details["paused"], details["error"]]).to_string()
            } else if ["file-transcription-progress", "model-download"].contains(&message) {
                json!([details["stage"], details["error"], details["status"], !details["total"].is_null() && details["done"] == details["total"]]).to_string()
            } else { String::new() };
            if inner.samples.get(&key).is_some_and(|(time, previous)| {
                time.elapsed() < Duration::from_secs(1) && previous == &fingerprint
            }) { return; }
            inner.samples.insert(key, (Instant::now(), fingerprint));
        }
        self.append(&mut inner, level, source, message, details);
    }

    fn append(&self, inner: &mut Inner, level: &str, source: &str, message: &str, details: Value) {
        let entry = Entry {
            id: inner.next_id, timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            level: match level { "debug" | "warn" | "error" => level, _ => "info" }.into(),
            source: redact(source), message: redact(message), details: safe_details(&details), session: self.session.clone(),
        };
        inner.next_id = inner.next_id.saturating_add(1);
        let Ok(mut bytes) = serde_json::to_vec(&entry) else { return; };
        bytes.push(b'\n');
        inner.bytes += bytes.len();
        inner.entries.push_back((entry, bytes.len()));
        trim(inner);
        let result = (|| -> std::io::Result<()> {
            self.prepare_directory()?;
            if inner.disk_bytes + bytes.len() > MAX_BYTES * 2 {
                self.compact(inner)?;
            } else {
                let mut options = OpenOptions::new();
                options.create(true).append(true);
                #[cfg(unix)] {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                options.open(&self.path)?.write_all(&bytes)?;
                inner.disk_bytes += bytes.len();
            }
            Ok(())
        })();
        inner.storage_error = result.err().map(|e| redact(&e.to_string()));
    }

    fn prepare_directory(&self) -> std::io::Result<()> {
        let directory = self.path.parent().unwrap();
        fs::create_dir_all(directory)?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }

    fn compact(&self, inner: &mut Inner) -> std::io::Result<()> {
        let temp = self.path.with_extension("tmp");
        let result = (|| -> std::io::Result<()> {
            let mut options = OpenOptions::new();
            options.create(true).write(true).truncate(true);
            #[cfg(unix)] {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp)?;
            for (entry, _) in &inner.entries {
                serde_json::to_writer(&mut file, entry)?;
                file.write_all(b"\n")?;
            }
            file.sync_all()?;
            fs::rename(&temp, &self.path)?;
            inner.disk_bytes = inner.bytes;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(temp); }
        result
    }

    fn snapshot(&self) -> Result<Snapshot, String> {
        let inner = self.inner.lock().map_err(crate::store::err)?;
        Ok(Snapshot {
            enabled: inner.enabled,
            entries: if inner.enabled { inner.entries.iter().map(|(entry, _)| entry.clone()).collect() } else { vec![] },
            storage_error: inner.storage_error.clone(), max_entries: MAX_ENTRIES,
        })
    }

    fn clear(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(crate::store::err)?;
        if !inner.enabled { return Err("Developer mode is disabled".into()); }
        // Remove persisted evidence before clearing the visible buffer.
        match fs::remove_file(&self.path) {
            Ok(()) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(redact(&error.to_string())),
        }
        let _ = fs::remove_file(self.path.with_extension("tmp"));
        inner.entries.clear();
        inner.samples.clear();
        inner.bytes = 0;
        inner.disk_bytes = 0;
        inner.storage_error = None;
        Ok(())
    }
}

fn trim(inner: &mut Inner) {
    while inner.entries.len() > MAX_ENTRIES || inner.bytes > MAX_BYTES {
        if let Some((_, bytes)) = inner.entries.pop_front() { inner.bytes -= bytes; } else { break; }
    }
}

pub fn remember_secret(secret: &str) {
    let secret = secret.trim();
    if secret.len() < 4 { return; }
    if let Ok(mut secrets) = SECRETS.lock() {
        if !secrets.iter().any(|value| value == secret) { secrets.push(secret.into()); }
    }
}

fn redact(input: &str) -> String {
    let mut value = input.to_owned();
    if let Ok(secrets) = SECRETS.lock() {
        for secret in secrets.iter() { value = value.replace(secret, "[redacted]"); }
    }
    if let Some(home) = dirs::home_dir() {
        value = value.replace(home.to_string_lossy().as_ref(), "~");
    }
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    for pattern in PATTERNS.get_or_init(|| [
        r"(?i)(?:bearer\s+)[a-z0-9._~+/=-]+",
        r"(?i)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|secret)\s*[\x22']?\s*[:=]\s*[\x22']?[^\s\x22',;}]+",
        r"(?:sk-[a-zA-Z0-9_-]{8,}|(?:gh[pousr]_|github_pat_|hf_)[a-zA-Z0-9_]{8,}|AIza[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)",
        r"https?://[^\s\x22'<>]+",
        r"(?i)(?:/Users/|/home/|[a-z]:\\Users\\)[^/\\\s]+",
    ].iter().map(|pattern| regex::Regex::new(pattern).unwrap()).collect()) {
        value = pattern.replace_all(&value, "[redacted]").into_owned();
    }
    value.chars().filter(|ch| !ch.is_control() || *ch == '\n' || *ch == '\t').take(2_000).collect()
}

// Explicitly keep operational metadata. Unknown/nested fields cannot smuggle
// transcript text, prompts, clipboard contents, credentials or personal paths.
fn safe_details(value: &Value) -> Value {
    const FIELDS: &[&str] = &[
        "id", "state", "stage", "paused", "error", "rendererError", "fallback", "glError",
        "done", "total", "duration", "transcriptionDuration", "enhancementDuration", "status",
        "processingState", "recognitionError", "processingError", "deliveryError", "characters",
        "completedSeconds", "requestId", "count", "cached", "version", "platform", "architecture",
        "session", "action", "command", "fields", "elapsedMs", "window", "page", "provider", "model",
        "width", "height", "palette", "hidden", "nativeActive", "enabled", "focused", "level", "peak",
        "result", "reason", "line", "column", "stack", "message", "name", "changed",
        "backend", "device", "gpu_requested",
        "revision", "frontApp", "capturedApp", "targetRole", "webEditor", "trusted",
        "heldModifiers", "eventFlags", "directAttempted", "pastePosted",
        "baselineReadable", "selectionKnown", "focusAttempts",
        "focusProbe", "source", "axError", "anchorRole", "pidMatches", "searchVisited",
        "searchExpired", "resolved", "accessibilityRequestError",
    ];
    match value {
        Value::Object(fields) => Value::Object(fields.iter().filter(|(key, _)| FIELDS.contains(&key.as_str()))
            .take(40).map(|(key, value)| (key.clone(), safe_details(value))).collect()),
        Value::Array(values) => Value::Array(values.iter().take(60).map(safe_details).collect()),
        Value::String(value) => Value::String(redact(value)),
        other => other.clone(),
    }
}

fn app_version() -> &'static str {
    APP_VERSION.get().map(String::as_str).unwrap_or(crate::channel::VERSION)
}

fn system_details() -> Value {
    json!({"version":app_version(),"platform":std::env::consts::OS,"architecture":std::env::consts::ARCH})
}

pub fn record(level: &str, source: &str, message: &str, details: Value) {
    if let Some(logger) = LOGGER.get() { logger.record(level, source, message, details, false); }
}

pub fn transcript_saved(t: &crate::domain::Transcript) {
    record(
        if t.recognition_error.is_some() || t.processing_error.is_some() || t.delivery_error.is_some() { "error" } else { "info" },
        "transcription", "saved", json!({
            "id":t.id,"status":t.status,"processingState":t.processing_state,"duration":t.duration,
            "characters":t.text.chars().count(),"transcriptionDuration":t.transcription_duration,
            "enhancementDuration":t.enhancement_duration,"recognitionError":t.recognition_error,
            "processingError":t.processing_error,"deliveryError":t.delivery_error,
        }),
    );
}

pub fn initialize(app: &AppHandle, root: &Path, enabled: bool) {
    let _ = APP_VERSION.set(app.package_info().version.to_string());
    let _ = LOGGER.set(Logger::open(root, enabled));
    for &name in EVENTS {
        app.listen_any(name, move |event| {
            let Some(logger) = LOGGER.get() else { return; };
            let payload = serde_json::from_str::<Value>(event.payload()).unwrap_or(Value::Null);
            let level = if name.ends_with("error") || payload.get("error").is_some_and(|v| !v.is_null()) { "error" }
                else if name == "delivery-notice" { "warn" } else if ["cloud-audio", "cloud-pointer"].contains(&name) { "debug" } else { "info" };
            let details = if payload.is_object() { payload } else { json!({"message":payload}) };
            logger.record(level, "event", name, details, ["cloud-audio", "cloud-pointer", "cloud-dock", "cloud-state", "model-download", "file-transcription-progress"].contains(&name));
        });
    }
    record("info", "app", "session.started", system_details());
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        let message = panic.payload().downcast_ref::<String>().map(String::as_str)
            .or_else(|| panic.payload().downcast_ref::<&str>().copied()).unwrap_or("Native panic");
        record("error", "native", "panic", json!({"message":message,"line":panic.location().map(|l|l.line())}));
        previous(panic);
    }));
}

pub fn synchronize(app: &AppHandle, enabled: bool) {
    if LOGGER.get().is_some_and(|logger| logger.set_enabled(enabled)) {
        let _ = app.emit("developer-mode-changed", enabled);
    }
}

pub fn command_received(invoke: &tauri::ipc::Invoke) {
    let command = invoke.message.command();
    if command.starts_with("developer_") { return; }
    let Some(logger) = LOGGER.get() else { return; };
    let mut details = json!({"window":invoke.message.webview_ref().label()});
    let mut sampled = ["cloud_snapshot", "cloud_dock_geometry", "permission_status"].contains(&command);
    if let tauri::ipc::InvokeBody::Json(value) = invoke.message.payload() {
        if let Some(fields) = value.as_object() {
            sampled |= command == "cloud_action" && value["action"] == "regions";
            details["fields"] = json!(fields.keys().collect::<Vec<_>>());
            if let Some(action) = fields.get("action") { details["action"] = action.clone(); }
            if let Some(patch) = fields.get("patch").and_then(Value::as_object) {
                details["changed"] = json!(patch.keys().collect::<Vec<_>>());
            }
            if command == "cloud_action" && value["action"] == "renderer-status" {
                details["error"] = value["detail"]["error"].clone();
                details["stage"] = value["detail"]["stage"].clone();
            }
        }
    }
    logger.record(if details["error"].is_string() { "error" } else { "debug" }, "command", command, details, sampled);
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let mut details = json!({"window":window.label()});
    let name = match event {
        tauri::WindowEvent::Focused(focused) => { details["focused"] = json!(focused); "focused" },
        tauri::WindowEvent::Resized(size) => { details["width"] = json!(size.width); details["height"] = json!(size.height); "resized" },
        tauri::WindowEvent::CloseRequested { .. } => "close-requested",
        tauri::WindowEvent::Destroyed => "destroyed",
        _ => return,
    };
    record("debug", "window", name, details);
}

#[tauri::command]
pub fn developer_status() -> bool {
    LOGGER.get().and_then(|logger| logger.inner.lock().ok().map(|inner| inner.enabled)).unwrap_or(false)
}

#[tauri::command]
pub fn developer_logs() -> Result<Snapshot, String> {
    LOGGER.get().ok_or("Diagnostics unavailable")?.snapshot()
}

#[tauri::command]
pub fn developer_client_event(window: tauri::Window, level: String, message: String, details: Value) {
    // Do not accept arbitrary console argument objects from the webview.
    let mut safe = safe_details(&details);
    if !safe.is_object() { safe = json!({}); }
    safe["window"] = json!(window.label());
    record(&level, "frontend", &message, safe);
}

#[tauri::command]
pub fn developer_clear_logs() -> Result<(), String> {
    LOGGER.get().ok_or("Diagnostics unavailable")?.clear()
}

fn report(limit: Option<usize>) -> Result<String, String> {
    format_report(developer_logs()?, limit)
}

fn format_report(mut snapshot: Snapshot, limit: Option<usize>) -> Result<String, String> {
    if !snapshot.enabled { return Err("Developer mode is disabled".into()); }
    let skip = snapshot.entries.len().saturating_sub(limit.unwrap_or(MAX_ENTRIES));
    snapshot.entries.drain(..skip);
    let mut content = format!("No Type diagnostic log\nVersion: {}\nPlatform: {} / {}\nExported: {}\nEntries: {}\nContinuous meter/pointer/progress events are sampled once per second.\nCredentials and content payloads are excluded.\n\n",
        app_version(), std::env::consts::OS, std::env::consts::ARCH,
        chrono::Utc::now().to_rfc3339(), snapshot.entries.len());
    if let Some(error) = snapshot.storage_error { content.push_str(&format!("Log storage error: {error}\n\n")); }
    for entry in snapshot.entries {
        content.push_str(&format!("{} [{}] {}: {} {} (session {})\n", entry.timestamp, entry.level.to_uppercase(), entry.source, entry.message,
            if entry.details.is_null() { String::new() } else { entry.details.to_string() }, entry.session));
    }
    Ok(content)
}

#[tauri::command]
pub fn developer_export_logs(path: PathBuf) -> Result<(), String> {
    crate::commands::atomic_export(&path, report(None)?.as_bytes())
}

#[tauri::command]
pub fn developer_copy_logs(limit: Option<usize>) -> Result<(), String> {
    crate::platform::copy(&report(limit)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf { std::env::temp_dir().join(format!("no-type-logs-{}", uuid::Uuid::new_v4())) }

    #[test]
    fn copied_report_selects_recent_events_in_time_order_and_export_keeps_all() {
        let root = root();
        let logger = Logger::open(&root, true);
        for name in ["older-event", "recent-event", "latest-error"] {
            logger.record("info", "test", name, Value::Null, false);
        }
        let recent = format_report(logger.snapshot().unwrap(), Some(2)).unwrap();
        assert!(recent.contains("Entries: 2\n"));
        assert!(!recent.contains("older-event"));
        assert!(recent.find("recent-event").unwrap() < recent.find("latest-error").unwrap());
        let all = format_report(logger.snapshot().unwrap(), None).unwrap();
        assert!(all.contains("Entries: 3\n") && all.contains("older-event"));
        assert!(format_report(logger.snapshot().unwrap(), Some(100)).unwrap().contains("Entries: 3\n"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mode_gates_logging_and_survives_restart_without_losing_evidence() {
        let root = root();
        let logger = Logger::open(&root, false);
        logger.record("error", "test", "disabled", Value::Null, false);
        assert!(!logger.path.exists());
        assert!(logger.set_enabled(true));
        logger.record("error", "test", "example", json!({"error":"HTTP 503"}), false);
        logger.set_enabled(false);
        let reopened = Logger::open(&root, true);
        let snapshot = reopened.snapshot().unwrap();
        assert!(snapshot.entries.iter().any(|e|e.message == "example"));
        assert!(snapshot.entries.iter().any(|e|e.message == "developer-mode.disabled"));
        assert!(!snapshot.entries.iter().any(|e|e.message == "disabled"));
        reopened.clear().unwrap();
        assert!(Logger::open(&root, true).snapshot().unwrap().entries.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn secrets_paths_and_content_never_reach_disk() {
        let root = root();
        let secret = "diagnostic-test-custom-key-12345";
        remember_secret(secret);
        let logger = Logger::open(&root, true);
        logger.record("error", "test", "failed", json!({
            "error":format!("Authorization: Bearer abcdefg key {secret} https://api.test/?token=hidden /Users/someone/private"),
            "text":"private transcript", "clipboard":"private clipboard", "key":secret,
            "details":{"password":"hidden"}, "status":"failed"
        }), false);
        let contents = fs::read_to_string(&logger.path).unwrap();
        for private in [secret,"abcdefg","api.test","someone","private transcript","private clipboard","password"] {
            assert!(!contents.contains(private), "leaked {private}");
        }
        assert!(contents.contains("failed"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delivery_focus_metadata_survives_without_editor_content() {
        let details = safe_details(&json!({
            "result":"clipboardOnly", "reason":"verificationUnavailable",
            "platform":{
                "revision":"delivery-20261005-focus", "frontApp":"com.example.editor",
                "targetRole":"none", "trusted":true, "pastePosted":true,
                "baselineReadable":false, "selectionKnown":false, "focusAttempts":6,
                "heldModifiers":[], "text":"private transcript", "value":"private field",
                "focusProbe":[{"source":"application","axError":-25212,"anchorRole":"AXGroup","value":"private field"}],
                "clipboard":"private clipboard", "windowTitle":"private title"
            }
        }));
        assert_eq!(details["platform"]["focusAttempts"], 6);
        assert_eq!(details["platform"]["pastePosted"], true);
        assert_eq!(details["platform"]["targetRole"], "none");
        assert_eq!(details["platform"]["focusProbe"][0]["axError"], -25212);
        assert!(!details.to_string().contains("private"));
    }

    #[test]
    fn bounded_storage_preserves_recent_errors_and_reads_incomplete_last_line() {
        let root = root();
        let logger = Logger::open(&root, true);
        for index in 0..MAX_ENTRIES + 100 {
            logger.record("info", "test", &format!("event-{index}"), json!({"message":"x".repeat(1800)}), false);
        }
        logger.record("error", "test", "latest-error", Value::Null, false);
        let inner = logger.inner.lock().unwrap();
        assert!(inner.entries.len() <= MAX_ENTRIES);
        assert!(inner.bytes <= MAX_BYTES);
        assert!(fs::metadata(&logger.path).unwrap().len() <= (MAX_BYTES * 2) as u64);
        drop(inner);
        OpenOptions::new().append(true).open(&logger.path).unwrap().write_all(b"{incomplete").unwrap();
        let reopened = Logger::open(&root, true);
        assert_eq!(reopened.snapshot().unwrap().entries.last().unwrap().message, "latest-error");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sampling_keeps_recorder_phase_and_error_transitions() {
        let root = root();
        let logger = Logger::open(&root, true);
        for state in ["recording", "recording", "busy", "failed"] {
            logger.record("info", "event", "cloud-state", json!({"state":state}), true);
        }
        logger.record("error", "event", "cloud-state", json!({"state":"failed","error":"failed microphone"}), true);
        assert_eq!(logger.snapshot().unwrap().entries.len(), 4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sampling_preserves_fast_file_job_completion_and_channel_defaults() {
        let root = root();
        let logger = Logger::open(&root, true);
        for stage in ["transcribing", "transcribing", "processing", "completed"] {
            logger.record("info", "event", "file-transcription-progress", json!({"stage":stage}), true);
        }
        assert_eq!(logger.snapshot().unwrap().entries.len(), 3);
        let old: crate::domain::Preferences = serde_json::from_value(json!({"keepInTray":false})).unwrap();
        assert_eq!(old.developer_mode, crate::channel::DEVELOPER);
        let disabled = old.patched(&json!({"developerMode":false})).unwrap();
        assert!(!disabled.developer_mode);
        let next = old.patched(&json!({"developerMode":true})).unwrap();
        assert!(next.developer_mode);
        assert!(!next.keep_in_tray);
        fs::remove_dir_all(root).unwrap();
    }
}
