//! Read-only import from the SwiftData stores. The source app can remain open;
//! SQLite provides a consistent snapshot of committed rows, including its WAL.
use crate::{
    domain::*,
    store::{err, Store},
};
use rusqlite::{Connection, OpenFlags, Row};
use serde_json::Value;
use std::{collections::HashSet, path::Path};

fn read_store(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)
}
fn string(row: &Row<'_>, name: &str) -> Option<String> {
    row.get::<_, Option<String>>(name).ok().flatten()
}
fn number(row: &Row<'_>, name: &str) -> f64 {
    row.get::<_, Option<f64>>(name)
        .ok()
        .flatten()
        .unwrap_or_default()
}
fn identifier(row: &Row<'_>, name: &str) -> String {
    row.get::<_, Vec<u8>>(name)
        .ok()
        .and_then(|v| uuid::Uuid::from_slice(&v).ok())
        .map(|u| u.to_string())
        .or_else(|| string(row, name))
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}
const APPLE_EPOCH: f64 = 978307200.;
pub fn available() -> bool {
    dirs::home_dir().is_some_and(|home| {
        crate::legacy::native_root(&home).join("default.store")
            .exists()
    })
}
pub fn import_legacy(store: &Store) -> Result<usize, String> {
    if !cfg!(target_os = "macos") {
        return Err("Import a No Type backup from your Mac instead".into());
    }
    let home = dirs::home_dir().ok_or("Home directory not found")?;
    let root = crate::legacy::native_root(&home);
    let source = read_store(&root.join("default.store"))?;
    let mut b = Backup {
        empowerments: vec![],
        format: "no-tipe-desktop".into(),
        version: 1,
        preferences: store.preferences()?,
        transcripts: vec![],
        metrics: vec![],
        modes: vec![],
        dictionary: vec![],
        snippets: vec![],
        models: vec![],
    };
    let mut q = source
        .prepare("SELECT * FROM ZTRANSCRIPTION")
        .map_err(err)?;
    let items = q
        .query_map([], |row| {
            Ok(Transcript {
                id: identifier(row, "ZID"),
                text: string(row, "ZTEXT").unwrap_or_default(),
                enhanced_text: string(row, "ZENHANCEDTEXT"),
                formatted_snippet: None,
                processing_source: None,
                manual_correction: None,
                session_config: None,
                recognition_error: None,
                delivery_error: None,
                processing_state: crate::domain::ProcessingState::Idle,
                processing_config: None,
                processing_error: string(row, "ZPROCESSINGERROR"),
                timestamp: number(row, "ZTIMESTAMP") + APPLE_EPOCH,
                duration: number(row, "ZDURATION"),
                audio_file: string(row, "ZAUDIOFILEURL"),
                model: string(row, "ZTRANSCRIPTIONMODELNAME"),
                processing_model: string(row, "ZAIENHANCEMENTMODELNAME"),
                mode: string(row, "ZMODENAME").or_else(|| string(row, "ZPOWERMODENAME")),
                status: string(row, "ZTRANSCRIPTIONSTATUS").unwrap_or_else(|| "completed".into()),
                transcription_duration: Some(number(row, "ZTRANSCRIPTIONDURATION")),
                enhancement_duration: Some(number(row, "ZENHANCEMENTDURATION")),
                insights: None,
            })
        })
        .map_err(err)?;
    b.transcripts = items.collect::<Result<_, _>>().map_err(err)?;
    if root.join("stats.store").exists() {
        let stats = read_store(&root.join("stats.store"))?;
        let mut q = stats.prepare("SELECT * FROM ZSESSIONMETRIC").map_err(err)?;
        b.metrics = q
            .query_map([], |r| {
                Ok(Metric {
                    id: identifier(r, "ZID"),
                    transcript_id: identifier(r, "ZTRANSCRIPTIONID"),
                    timestamp: number(r, "ZTIMESTAMP") + APPLE_EPOCH,
                    words: number(r, "ZWORDCOUNT") as u64,
                    duration: number(r, "ZAUDIODURATION"),
                    model: string(r, "ZTRANSCRIPTIONMODELNAME").unwrap_or_default(),
                    transcription_duration: number(r, "ZTRANSCRIPTIONDURATION"),
                    mode: string(r, "ZMODENAME").unwrap_or_default(),
                    insights: None,
                })
            })
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
    }
    let known: HashSet<_> = b.metrics.iter().map(|m| m.transcript_id.clone()).collect();
    for t in &b.transcripts {
        if !known.contains(&t.id) && t.status == "completed" && !t.text.trim().is_empty() {
            b.metrics.push(Metric {
                id: t.id.clone(),
                transcript_id: t.id.clone(),
                timestamp: t.timestamp,
                words: t.text.split_whitespace().count() as u64,
                duration: t.duration,
                model: t.model.clone().unwrap_or_default(),
                transcription_duration: t.transcription_duration.unwrap_or_default(),
                mode: t.mode.clone().unwrap_or_default(),
                insights: t.insights.clone(),
            });
        }
    }
    if root.join("dictionary.store").exists() {
        let dict = read_store(&root.join("dictionary.store"))?;
        let mut q = dict.prepare("SELECT * FROM ZVOCABULARYWORD").map_err(err)?;
        for row in q
            .query_map([], |r| Ok(string(r, "ZWORD").unwrap_or_default()))
            .map_err(err)?
        {
            let word = row.map_err(err)?;
            if !word.is_empty() {
                b.dictionary.push(DictionaryEntry {
                    id: format!("legacy-word-{}", word.to_lowercase()),
                    word,
                    replacement: None,
                    enabled: true,
                });
            }
        }
        let mut q = dict
            .prepare("SELECT * FROM ZWORDREPLACEMENT")
            .map_err(err)?;
        for row in q
            .query_map([], |r| {
                Ok(DictionaryEntry {
                    id: identifier(r, "ZID"),
                    word: string(r, "ZORIGINALTEXT").unwrap_or_default(),
                    replacement: Some(string(r, "ZREPLACEMENTTEXT").unwrap_or_default()),
                    enabled: number(r, "ZISENABLED") != 0.,
                })
            })
            .map_err(err)?
        {
            b.dictionary.push(row.map_err(err)?);
        }
    }
    let native_id = root.file_name().ok_or("Native data directory has no name")?.to_string_lossy();
    let prefs_path = home.join("Library/Preferences").join(format!("{native_id}.plist"));
    if prefs_path.exists() {
        let plist = plist::Value::from_file(prefs_path).map_err(err)?;
        if let Some(d) = plist.as_dictionary() {
            let s = |key: &str| d.get(key).and_then(|v| v.as_string()).map(str::to_owned);
            let flag = |key: &str, default: bool| {
                d.get(key).and_then(|v| v.as_boolean()).unwrap_or(default)
            };
            b.preferences.palette = canonical_palette(&s("CloudRecorderPalette").unwrap_or(b.preferences.palette)).into();
            b.preferences.chromatic = flag("CloudRecorderChromatic", false);
            b.preferences.hidden_style =
                s("CloudRecorderHiddenStyle").unwrap_or_else(|| "split".into());
            b.preferences.show_transcript = flag("ShowLiveTranscript", false);
            b.preferences.enhance = flag("CloudRecorderEnhance", false);
            b.preferences.shorten = flag("CloudRecorderShorten", false);
            b.preferences.translation =
                s("CloudRecorderTranslation").unwrap_or_else(|| "off".into());
            b.preferences.restore_clipboard = flag("restoreClipboardAfterPaste", true);
            b.preferences.append_space = flag("AppendTrailingSpace", false);
            b.preferences.pause_media = flag("isPauseMediaEnabled", false);
            b.preferences.shortcut_mode =
                s("primaryRecordingShortcutMode").unwrap_or_else(|| "toggle".into());
            let decode = |key: &str| -> Option<Value> {
                let v = d.get(key)?;
                if let Some(bytes) = v.as_data() {
                    serde_json::from_slice(bytes).ok()
                } else {
                    v.as_string().and_then(|s| serde_json::from_str(s).ok())
                }
            };
            let prompts = decode("customPrompts")
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default();
            if let Some(modes) = decode("modeConfigurationsV2").and_then(|v| v.as_array().cloned())
            {
                for m in modes {
                    let get =
                        |key: &str, default: &str| m[key].as_str().unwrap_or(default).to_owned();
                    let id = get("id", &uuid::Uuid::new_v4().to_string()).to_lowercase();
                    let prompt_id = m["selectedPrompt"].as_str().unwrap_or("");
                    let prompt = prompts
                        .iter()
                        .find(|p| p["id"].as_str() == Some(prompt_id))
                        .and_then(|p| p["promptText"].as_str())
                        .unwrap_or("")
                        .to_owned();
                    let model = m["selectedTranscriptionModelName"]
                        .as_str()
                        .map(str::to_owned);
                    b.modes.push(Mode {
                        id: id.clone(),
                        name: get("name", "Dictation"),
                        icon: "✦".into(),
                        enabled: m["isEnabled"].as_bool().unwrap_or(true),
                        model: model.clone(),
                        language: get("selectedLanguage", "auto"),
                        prompt,
                        enhance: m["isAIEnhancementEnabled"].as_bool().unwrap_or(false),
                        output: get("outputMode", "paste"),
                        auto_send: get("autoSendKey", "none"),
                        command: m["customCommand"]["command"].as_str().unwrap_or("").into(),
                        clipboard_context: m["useClipboardContext"].as_bool().unwrap_or(false),
                        selected_text_context: m["useSelectedTextContext"]
                            .as_bool()
                            .unwrap_or(false),
                        app_patterns: m["appConfigs"]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| {
                                        v["bundleIdentifier"].as_str().map(str::to_owned)
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                        url_patterns: m["urlConfigs"]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v["url"].as_str().map(str::to_owned))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        legacy: Some(m.clone()),
                        ..Mode::default()
                    });
                    let active = s("activeConfigurationId")
                        .is_some_and(|a| a.eq_ignore_ascii_case(&id))
                        || m["isDefault"].as_bool() == Some(true);
                    if active {
                        b.preferences.active_mode = Some(id);
                        if let Some(model) = model {
                            b.preferences.transcription_model = model;
                        }
                        b.preferences.language = get("selectedLanguage", "auto");
                        if let Some(provider) = m["selectedAIProvider"].as_str() {
                            b.preferences.processing_provider = provider.to_lowercase();
                        }
                        if let Some(model) = m["selectedAIModel"].as_str() {
                            b.preferences.processing_model = model.into();
                        }
                        if b.preferences.processing_provider == "ollama" {
                            b.preferences.processing_endpoint = "http://127.0.0.1:11434/v1".into();
                        }
                    }
                }
            }
            // Legacy local builds stored these as Data in UserDefaults. Import into
            // native credential storage only; never put them in JSON or IPC responses.
            for provider in [
                "openai",
                "groq",
                "deepgram",
                "mistral",
                "elevenlabs",
                "gemini",
                "soniox",
                "assemblyai",
                "speechmatics",
                "cartesia",
                "xai",
                "anthropic",
                "openrouter",
            ] {
                let account = crate::credentials::legacy_account(provider);
                if let Some(value) = d
                    .get(&format!("LocalKeychain_{account}"))
                    .and_then(|v| v.as_data())
                    .and_then(|b| String::from_utf8(b.to_vec()).ok())
                {
                    if !value.is_empty() {
                        crate::credentials::save(provider, &value)?;
                    }
                }
            }
        }
    }
    let count = store.import_backup(b)?;
    store.set_meta("legacyImported", &chrono::Utc::now().to_rfc3339())?;
    Ok(count)
}
