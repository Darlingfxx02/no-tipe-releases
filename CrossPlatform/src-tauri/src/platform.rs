use crate::store::err;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock},
    time::Duration,
};

static RESOURCE_ROOT: OnceLock<PathBuf> = OnceLock::new();
pub fn configure(root: PathBuf) {
    let _ = RESOURCE_ROOT.set(root);
}
#[cfg(target_os = "macos")]
pub fn resource_path(file: &str) -> PathBuf {
    let bundled = RESOURCE_ROOT.get().map(|root|root.join(file));
    bundled.filter(|p|p.exists()).unwrap_or_else(||PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(file))
}
struct Adapter {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Drop for Adapter {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
static ADAPTER: OnceLock<Mutex<Option<Adapter>>> = OnceLock::new();
#[cfg(target_os = "macos")]
extern "C" {
    fn no_tipe_paste_request(json: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn no_tipe_paste_free(value: *mut std::ffi::c_char);
}
#[cfg(target_os = "macos")]
fn request(message: Value) -> Result<Value, String> {
    if matches!(
        message["action"].as_str(),
        Some("capture" | "paste" | "context" | "copyFormatted")
    ) {
        // The main executable owns TCC access. Only model inference runs in the
        // Swift helper; capture and insertion must use the same identity as UI.
        let input = std::ffi::CString::new(message.to_string()).map_err(err)?;
        let output = unsafe { no_tipe_paste_request(input.as_ptr()) };
        if output.is_null() {
            return Err("Paste service unavailable".into());
        }
        let bytes = unsafe { std::ffi::CStr::from_ptr(output).to_bytes().to_vec() };
        unsafe { no_tipe_paste_free(output) };
        let value: Value = serde_json::from_slice(&bytes).map_err(err)?;
        return if let Some(error) = value["error"].as_str() {
            Err(error.into())
        } else {
            Ok(value)
        };
    }
    let lock = ADAPTER.get_or_init(|| Mutex::new(None));
    let mut adapter = lock.lock().map_err(err)?;
    // A canceled preview may have been queued behind model loading/inference.
    // Do not send that stale work to the helper ahead of the final recording.
    if message["cancelPath"].as_str().is_some_and(|path| Path::new(path).exists()) {
        return Err("Canceled".into());
    }
    if adapter.is_none() {
        let root = RESOURCE_ROOT
            .get()
            .ok_or("Platform adapter is not configured")?;
        let path = root.join("platform/no-tipe-platform");
        let path = if path.exists() {
            path
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("platform/no-tipe-platform")
        };
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(err)?;
        let input = child
            .stdin
            .take()
            .ok_or("Platform adapter input unavailable")?;
        let output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or("Platform adapter output unavailable")?,
        );
        *adapter = Some(Adapter {
            child,
            input,
            output,
        });
    }
    let a = adapter.as_mut().ok_or("Platform adapter unavailable")?;
    serde_json::to_writer(&mut a.input, &message).map_err(err)?;
    a.input.write_all(b"\n").map_err(err)?;
    a.input.flush().map_err(err)?;
    let mut line = String::new();
    if a.output.read_line(&mut line).map_err(err)? == 0 {
        *adapter = None;
        return Err("Platform adapter exited unexpectedly".into());
    }
    let value: Value = serde_json::from_str(&line).map_err(err)?;
    if let Some(e) = value["error"].as_str() {
        Err(e.into())
    } else {
        Ok(value)
    }
}
#[cfg(target_os = "windows")]
fn request(message: Value) -> Result<Value, String> {
    windows_adapter::request(message)
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn request(_: Value) -> Result<Value, String> {
    Err("This build supports macOS and Windows".into())
}
async fn call(message: Value) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || request(message))
        .await
        .map_err(err)?
}
pub async fn capture() -> Result<String, String> {
    Ok(call(json!({"action":"capture"})).await?["app"]
        .as_str()
        .unwrap_or("")
        .into())
}
pub async fn paste(
    text: &str,
    restore: bool,
    delay: u64,
    auto_send: &str,
    html: Option<&str>,
) -> Result<PasteOutcome, String> {
    let response = call(
        json!({"action":"paste","text":text,"restore":restore,"delay":delay,"autoSend":auto_send,"html":html}),
    )
    .await?;
    Ok(PasteOutcome {
        result: response["result"]
            .as_str()
            .unwrap_or("clipboardOnly")
            .into(),
        reason: response["reason"].as_str().map(str::to_owned),
        diagnostics: response.get("diagnostics").cloned(),
    })
}
pub async fn copy_formatted(text: &str, html: Option<&str>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if html.is_some() {
        call(json!({"action":"copyFormatted","text":text,"html":html})).await?;
        return Ok(());
    }
    copy(text)
}
pub struct PasteOutcome {
    pub result: String,
    pub reason: Option<String>,
    pub diagnostics: Option<Value>,
}
impl From<&str> for PasteOutcome {
    fn from(result: &str) -> Self {
        Self {
            result: result.into(),
            reason: None,
            diagnostics: None,
        }
    }
}
// Cancellation crosses the helper's blocking JSON protocol without killing its
// loaded model. The worker owns cleanup even when its async caller is dropped.
struct CancelMarker { path: PathBuf, finished: bool }
impl CancelMarker {
    fn signal(&self) {
        if !self.finished {
            let _ = std::fs::OpenOptions::new().write(true).create_new(true).open(&self.path);
        }
    }
    fn finish(&mut self) {
        self.finished = true;
        let _ = std::fs::remove_file(&self.path);
    }
}
struct FinishMarker(Arc<Mutex<CancelMarker>>);
impl Drop for FinishMarker {
    fn drop(&mut self) { if let Ok(mut marker) = self.0.lock() { marker.finish(); } }
}
struct NativeCancellation {
    marker: Arc<Mutex<CancelMarker>>,
    watcher: tokio::task::JoinHandle<()>,
}
impl Drop for NativeCancellation {
    fn drop(&mut self) {
        self.watcher.abort();
        if let Ok(marker) = self.marker.lock() { marker.signal(); }
    }
}
async fn inference_call(mut message: Value, cancel: Arc<AtomicBool>) -> Result<Value, String> {
    if cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
    let path = std::env::temp_dir().join(format!("no-tipe-asr-cancel-{}", uuid::Uuid::new_v4()));
    message["cancelPath"] = json!(path);
    let marker = Arc::new(Mutex::new(CancelMarker { path, finished: false }));
    let watched = marker.clone();
    let watcher = tokio::spawn(async move {
        while !cancel.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        if let Ok(marker) = watched.lock() { marker.signal(); }
    });
    let _guard = NativeCancellation { marker: marker.clone(), watcher };
    // Construct the cleanup guard before spawning: queued/aborted jobs also own
    // the marker, and a late watcher cannot recreate it after completion.
    let cleanup = FinishMarker(marker);
    tokio::task::spawn_blocking(move || {
        let _cleanup = cleanup;
        request(message)
    }).await.map_err(err)?
}
pub async fn prepare_coreml(model_path: &str, cancel: Arc<AtomicBool>) -> Result<(), String> {
    inference_call(json!({"action":"prepareCoreML","modelPath":model_path}), cancel).await?;
    Ok(())
}
pub async fn coreml(path: &Path, model_path: &str, cancel: Arc<AtomicBool>) -> Result<String, String> {
    Ok(inference_call(json!({"action":"coreml","path":path,"modelPath":model_path}), cancel).await?["text"]
        .as_str()
        .ok_or("No recognition result")?
        .into())
}

#[cfg(test)]
mod inference_cancel_tests {
    use super::*;
    fn marker() -> Arc<Mutex<CancelMarker>> {
        Arc::new(Mutex::new(CancelMarker { path: std::env::temp_dir().join(format!("no-tipe-cancel-test-{}", uuid::Uuid::new_v4())), finished: false }))
    }
    #[tokio::test]
    async fn dropping_the_caller_signals_until_the_worker_finishes() {
        let marker = marker();
        let path = marker.lock().unwrap().path.clone();
        let cleanup = FinishMarker(marker.clone());
        let caller = NativeCancellation { marker: marker.clone(), watcher: tokio::spawn(std::future::pending()) };
        drop(caller);
        assert!(path.exists());
        drop(cleanup);
        assert!(!path.exists());
        marker.lock().unwrap().signal();
        assert!(!path.exists(), "late cancellation must not leak a marker after completion");
    }
    #[tokio::test]
    async fn completed_worker_does_not_leave_a_marker_when_caller_returns() {
        let marker = marker();
        let path = marker.lock().unwrap().path.clone();
        let caller = NativeCancellation { marker: marker.clone(), watcher: tokio::spawn(std::future::pending()) };
        drop(FinishMarker(marker));
        drop(caller);
        assert!(!path.exists());
    }
}
pub fn copy(text: &str) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(err)?
        .set_text(text)
        .map_err(err)
}
pub fn clipboard() -> Option<String> {
    arboard::Clipboard::new().ok()?.get_text().ok()
}

#[cfg(target_os = "windows")]
mod windows_adapter {
    use super::*;
    use crate::paste_evidence::{insertion_confirmed, Selection};
    use windows::{
        core::Interface,
        Win32::{
            Foundation::HWND,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
            },
            UI::{
                Accessibility::{
                    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
                    IUIAutomationValuePattern, TextPatternRangeEndpoint_End,
                    TextPatternRangeEndpoint_Start, UIA_TextPatternId, UIA_ValuePatternId,
                },
                Input::KeyboardAndMouse::{
                    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
                    VK_CONTROL, VK_V,
                },
                WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
            },
        },
    };
    struct Target {
        window: isize,
        pid: u32,
    }
    static TARGET: OnceLock<Mutex<Option<Target>>> = OnceLock::new();
    unsafe fn focus() -> Result<(IUIAutomationElement, String), String> {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let element = automation.GetFocusedElement().map_err(err)?;
        let value = field_value(&element)?;
        Ok((element, value))
    }
    unsafe fn field_value(element: &IUIAutomationElement) -> Result<String, String> {
        if element.CurrentIsPassword().map_err(err)?.as_bool() {
            return Err("Secure field".into());
        }
        let pattern: IUIAutomationValuePattern = element
            .GetCurrentPattern(UIA_ValuePatternId)
            .map_err(err)?
            .cast()
            .map_err(err)?;
        if pattern.CurrentIsReadOnly().map_err(err)?.as_bool() {
            return Err("Read-only field".into());
        }
        Ok(pattern.CurrentValue().map_err(err)?.to_string())
    }
    unsafe fn selection(element: &IUIAutomationElement, value: &str) -> Option<Selection> {
        let pattern: IUIAutomationTextPattern = element
            .GetCurrentPattern(UIA_TextPatternId).ok()?.cast().ok()?;
        let ranges = pattern.GetSelection().ok()?;
        if ranges.Length().ok()? != 1 {
            return None;
        }
        let selected = ranges.GetElement(0).ok()?;
        let document = pattern.DocumentRange().ok()?;
        // ValuePattern and TextPattern must describe the same UTF-16 document.
        if document.GetText(-1).ok()?.to_string() != value {
            return None;
        }
        let prefix = document.Clone().ok()?;
        prefix.MoveEndpointByRange(
            TextPatternRangeEndpoint_End, &selected, TextPatternRangeEndpoint_Start,
        ).ok()?;
        Some(Selection {
            start: prefix.GetText(-1).ok()?.len(),
            length: selected.GetText(-1).ok()?.len(),
        })
    }
    pub fn request(message: Value) -> Result<Value, String> {
        unsafe {
            match message["action"].as_str().unwrap_or("") {
                "capture" => {
                    let hwnd = GetForegroundWindow();
                    let mut pid = 0;
                    GetWindowThreadProcessId(hwnd, Some(&mut pid));
                    *TARGET
                        .get_or_init(|| Mutex::new(None))
                        .lock()
                        .map_err(err)? = Some(Target {
                        window: hwnd.0 as isize,
                        pid,
                    });
                    Ok(json!({"app":pid.to_string()}))
                }
                "permissions" => Ok(json!({"granted":true})),
                "paste" => {
                    let text = message["text"].as_str().unwrap_or("");
                    let previous = clipboard();
                    copy(text)?;
                    let target = TARGET
                        .get_or_init(|| Mutex::new(None))
                        .lock()
                        .map_err(err)?
                        .take();
                    let Some(target) = target else {
                        return Ok(json!({"result":"clipboardOnly"}));
                    };
                    let hwnd = GetForegroundWindow();
                    let mut pid = 0;
                    GetWindowThreadProcessId(hwnd, Some(&mut pid));
                    if hwnd != HWND(target.window as *mut _) || pid != target.pid {
                        return Ok(json!({"result":"clipboardOnly"}));
                    }
                    // Read the active field and selection immediately before
                    // Ctrl+V; both can change while dictation is running.
                    let Ok((element, before)) = focus() else {
                        return Ok(json!({"result":"clipboardOnly"}));
                    };
                    let before_selection = selection(&element, &before);
                    let key = |vk, up| INPUT {
                        r#type: INPUT_KEYBOARD,
                        Anonymous: INPUT_0 {
                            ki: KEYBDINPUT {
                                wVk: vk,
                                dwFlags: if up {
                                    KEYEVENTF_KEYUP
                                } else {
                                    Default::default()
                                },
                                ..Default::default()
                            },
                        },
                    };
                    let inputs = [
                        key(VK_CONTROL, false),
                        key(VK_V, false),
                        key(VK_V, true),
                        key(VK_CONTROL, true),
                    ];
                    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
                    let mut inserted = false;
                    for _ in 0..10 {
                        std::thread::sleep(std::time::Duration::from_millis(45));
                        if GetForegroundWindow() != hwnd {
                            break;
                        }
                        if let Ok(value) = field_value(&element) {
                            if insertion_confirmed(
                                &before, before_selection, &value, selection(&element, &value), text,
                            ) {
                                inserted = true;
                                break;
                            }
                        }
                    }
                    if inserted && message["restore"] == true {
                        let expected = text.to_owned();
                        let delay = message["delay"].as_u64().unwrap_or(1500);
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(delay));
                            if clipboard().as_deref() == Some(&expected) {
                                if let Some(previous) = previous {
                                    let _ = copy(&previous);
                                }
                            }
                        });
                    }
                    Ok(json!({"result":if inserted{"inserted"}else{"clipboardOnly"}}))
                }
                _ => Err(
                    "This model requires macOS; select an on-device Whisper model on Windows"
                        .into(),
                ),
            }
        }
    }
}
