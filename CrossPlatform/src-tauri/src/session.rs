//! Resolve recognition, mode rules and delivery before opening the microphone.
//! Explicit recorder controls may replace processing choices until recording
//! finishes, without reading edited settings or catalog entries into the session.
use crate::{domain::*, models, snippets::Snippet, store::Store};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub enum ProcessingChange {
    Enhance(bool),
    Shorten(bool),
    Translation(String),
}
impl ProcessingChange {
    pub fn apply(&self, p: &mut Preferences) {
        match self {
            Self::Enhance(enabled) => p.enhance = *enabled,
            Self::Shorten(enabled) => p.shorten = *enabled,
            Self::Translation(language) => p.translation = language.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub endpoint: String,
    pub local: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingConfiguration {
    #[serde(default)]
    pub empowerment: Option<crate::empowerment::Empowerment>,
    pub provider: String,
    pub model: String,
    pub endpoint: String,
    pub timeout: u64,
    pub enhance: bool,
    pub shorten: bool,
    #[serde(default)]
    pub remove_trailing_period: bool,
    pub translation: String,
    pub instructions: String,
    /// Resolved system rules, without clipboard/selected-text contents.
    pub prompt: Option<String>,
}
impl ProcessingConfiguration {
    /// Task 4 can reuse these choices without looking up an edited/deleted mode.
    /// Credentials are looked up by provider only when the request is made.
    pub fn preferences(&self) -> Preferences {
        Preferences {
            processing_provider: self.provider.clone(),
            processing_model: self.model.clone(),
            processing_endpoint: self.endpoint.clone(),
            processing_timeout: self.timeout,
            enhance: self.enhance,
            shorten: self.shorten,
            remove_trailing_period: self.remove_trailing_period,
            translation: self.translation.clone(),
            ..Default::default()
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryConfiguration {
    pub output: String,
    pub command: String,
    pub auto_send: String,
    pub append_space: bool,
    pub restore_clipboard: bool,
    pub clipboard_restore_delay: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfiguration {
    pub version: u32,
    pub speech_model: ConfiguredModel,
    pub language: String,
    pub audio_device: String,
    pub mode_id: Option<String>,
    pub mode_name: Option<String>,
    pub processing: ProcessingConfiguration,
    pub delivery: DeliveryConfiguration,
    pub clipboard_context: bool,
    pub selected_text_context: bool,
}

#[derive(Clone)]
pub struct RecordingSession {
    pub preferences: Preferences,
    pub model: Model,
    pub configuration: SessionConfiguration,
    pub dictionary: Vec<DictionaryEntry>,
    pub vocabulary: Vec<String>,
    pub snippets: Vec<Snippet>,
    /// Ephemeral context is deliberately excluded from saved configuration.
    pub clipboard: Option<String>,
    pub lifecycle: Option<Arc<tokio::sync::OwnedRwLockReadGuard<()>>>,
}
impl RecordingSession {
    pub fn with_modifier(&self, modifier: Option<crate::empowerment::Empowerment>) -> Self {
        let mut session = self.clone();
        session.configuration.processing.empowerment = modifier;
        session
    }
    #[cfg(test)]
    pub fn with_empowerment(&self, id: Option<&str>) -> Result<Self, String> {
        let mut session = self.clone();
        session.configuration.processing.empowerment = crate::empowerment::Empowerment::resolve(id, &session.preferences)?;
        Ok(session)
    }

    pub fn with_processing(&self, change: &ProcessingChange) -> Self {
        let mut session = self.clone();
        change.apply(&mut session.preferences);
        let processing = &mut session.configuration.processing;
        processing.enhance = session.preferences.enhance;
        processing.shorten = session.preferences.shorten;
        processing.translation = session.preferences.translation.clone();
        processing.prompt = processing_prompt_with_instructions(&session.preferences, &processing.instructions);
        if let Some(empowerment) = &mut processing.empowerment {
            if empowerment.localized {
                if let Ok(Some(localized)) = crate::empowerment::Empowerment::resolve(Some(&empowerment.id), &session.preferences) {
                    empowerment.instruction = localized.instruction;
                    empowerment.name = localized.name;
                }
            }
        }
        session
    }

    pub fn resolve(
        store: &Store,
        p: Preferences,
        mode: Option<&Mode>,
        file: bool,
    ) -> Result<Self, String> {
        let model_id = mode
            .and_then(|m| m.model.as_ref().filter(|id| !id.is_empty()))
            .unwrap_or(&p.transcription_model);
        let catalog = models::catalog(store)?;
        let requested = models::find(&catalog, model_id);
        // A saved mode from another device can refer to unavailable weights or
        // a macOS-only provider. Keep that mode intact and use the ready app
        // default for dictation. Explicit file/retry requests must stay exact.
        let model = requested.filter(|m| file || models::ready(m))
            .or_else(|| if !file { models::find(&catalog, &p.transcription_model).filter(|m|models::ready(m)) } else { None })
            .or(requested)
            .cloned()
            .ok_or_else(|| crate::localization::message("native.speech_model_unavailable"))?;
        if !model.installed {
            return Err(crate::localization::message("native.download_speech_model"));
        }
        if !model.has_key {
            return Err(crate::localization::message("native.speech_model_key_required"));
        }
        let dictionary = store.list::<DictionaryEntry>("dictionary")?;
        let vocabulary = dictionary
            .iter()
            .filter(|e| e.enabled && e.replacement.is_none())
            .map(|e| e.word.clone())
            .collect();
        let snippets = store.list("snippets")?;
        Ok(Self::resolved(
            p, mode, model, dictionary, vocabulary, snippets, file,
        ))
    }
    fn resolved(
        p: Preferences,
        mode: Option<&Mode>,
        model: Model,
        dictionary: Vec<DictionaryEntry>,
        vocabulary: Vec<String>,
        snippets: Vec<Snippet>,
        file: bool,
    ) -> Self {
        let config = processing_preferences(&p, mode);
        let prompt = if file {
            crate::file_jobs::prompt(&p, mode)
        } else {
            processing_prompt(&p, mode)
        };
        let configuration = SessionConfiguration {
            version: 1,
            speech_model: ConfiguredModel {
                id: model.id.clone(),
                name: model.name.clone(),
                provider: model.provider.clone(),
                model: model.model.clone(),
                endpoint: saved_endpoint(&model.endpoint),
                local: model.local,
            },
            language: mode
                .map(|m| m.language.clone())
                .unwrap_or_else(|| p.language.clone()),
            audio_device: p.audio_device.clone(),
            mode_id: mode.map(|m| m.id.clone()),
            mode_name: mode.map(|m| m.name.clone()),
            processing: ProcessingConfiguration {
                empowerment: None,
                provider: config.processing_provider.clone(),
                model: config.processing_model.clone(),
                endpoint: saved_endpoint(&config.processing_endpoint),
                timeout: config.processing_timeout,
                enhance: p.enhance,
                shorten: p.shorten,
                remove_trailing_period: p.remove_trailing_period,
                translation: p.translation.clone(),
                instructions: mode.map(|m| m.prompt.clone()).unwrap_or_default(),
                prompt,
            },
            delivery: DeliveryConfiguration {
                output: mode.map(|m| m.output.clone()).unwrap_or("paste".into()),
                command: mode.map(|m| m.command.clone()).unwrap_or_default(),
                auto_send: mode.map(|m| m.auto_send.clone()).unwrap_or("none".into()),
                append_space: p.append_space,
                restore_clipboard: p.restore_clipboard,
                clipboard_restore_delay: p.clipboard_restore_delay,
            },
            clipboard_context: mode.is_some_and(|m| m.clipboard_context),
            selected_text_context: mode.is_some_and(|m| m.selected_text_context),
        };
        Self {
            preferences: config,
            model,
            configuration,
            dictionary,
            vocabulary,
            snippets,
            clipboard: None,
            lifecycle: None,
        }
    }
}
// URLs may come from historical imports. Never copy embedded authentication to
// transcript metadata. Runtime requests still use the resolved original URL.
pub(crate) fn saved_endpoint(endpoint: &str) -> String {
    if endpoint.is_empty() {
        return String::new();
    }
    let Ok(mut url) = url::Url::parse(endpoint) else {
        return String::new();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string().trim_end_matches('/').into()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn fixture() -> RecordingSession {
        let p = Preferences {
            enhance: true,
            show_transcript: true,
            append_space: true,
            active_mode: Some("notes".into()),
            ..Default::default()
        };
        let mode = Mode {
            id: "notes".into(),
            name: "Notes".into(),
            language: "ru".into(),
            prompt: "Keep my paragraphs.".into(),
            output: "clipboard".into(),
            processing_provider: Some("ollama".into()),
            processing_model: Some("text-old".into()),
            clipboard_context: true,
            legacy: Some(serde_json::json!({"apiKey":"DO_NOT_PERSIST"})),
            ..Default::default()
        };
        let model = Model {
            id: "speech-old".into(),
            name: "Old speech".into(),
            provider: "whisper".into(),
            model: "speech-old".into(),
            endpoint: String::new(),
            local: true,
            path: Some("/private/weights".into()),
            download_url: Some("PRIVATE_DOWNLOAD".into()),
            size: 0,
            installed: true,
            has_key: true,
            languages: "ru".into(),
            description: String::new(),
        };
        let dictionary = vec![DictionaryEntry {
            id: "word".into(),
            word: "No Type".into(),
            replacement: None,
            enabled: true,
        }];
        let snippets = vec![Snippet {
            id: "sig".into(),
            trigger: "signature".into(),
            expansion: "Original signature".into(),
            enabled: true,
            date_added: 0.,
            formatting: vec![],
        }];
        RecordingSession::resolved(
            p,
            Some(&mode),
            model,
            dictionary,
            vec!["No Type".into()],
            snippets,
            false,
        )
    }
    #[test]
    fn edited_mode_preferences_catalog_dictionary_and_snippets_cannot_change_session() {
        let mut p = Preferences {
            enhance: true,
            remove_trailing_period: true,
            ..Default::default()
        };
        let mut mode = Mode {
            language: "ru".into(),
            prompt: "Original rules".into(),
            processing_provider: Some("ollama".into()),
            processing_model: Some("text-old".into()),
            command: "original command".into(),
            auto_send: "enter".into(),
            ..Default::default()
        };
        let original = fixture();
        let mut model = original.model.clone();
        let mut dictionary = original.dictionary.clone();
        let mut snippets = original.snippets.clone();
        let session = RecordingSession::resolved(
            p.clone(),
            Some(&mode),
            model.clone(),
            dictionary.clone(),
            original.vocabulary.clone(),
            snippets.clone(),
            false,
        );
        p.language = "en".into();
        p.enhance = false;
        p.remove_trailing_period = false;
        p.processing_timeout = 600;
        p.append_space = true;
        p.restore_clipboard = false;
        mode.language = "de".into();
        mode.prompt = "New rules".into();
        mode.enabled = false;
        mode.output = "respond".into();
        mode.processing_model = Some("text-new".into());
        mode.command.clear();
        mode.auto_send = "none".into();
        model.endpoint = "https://new.example".into();
        model.model = "speech-new".into();
        dictionary.clear();
        snippets[0].expansion = "New signature".into();
        let next =
            RecordingSession::resolved(p, Some(&mode), model, dictionary, vec![], snippets, false);
        let c = &session.configuration;
        assert!(c.processing.remove_trailing_period);
        assert!(!next.configuration.processing.remove_trailing_period);
        assert_eq!(c.language, "ru");
        assert_eq!(session.model.model, "speech-old");
        assert!(session.model.endpoint.is_empty());
        assert_eq!(c.processing.model, "text-old");
        assert_eq!(c.processing.timeout, 90);
        assert!(c
            .processing
            .prompt
            .as_ref()
            .unwrap()
            .contains("Original rules"));
        assert!(!c.processing.prompt.as_ref().unwrap().contains("New rules"));
        assert_eq!(c.delivery.command, "original command");
        assert_eq!(c.delivery.auto_send, "enter");
        assert!(!c.delivery.append_space);
        assert!(c.delivery.restore_clipboard);
        assert_eq!(session.vocabulary, ["No Type"]);
        assert_eq!(session.dictionary.len(), 1);
        assert_eq!(session.snippets[0].expansion, "Original signature");
        assert_eq!(next.configuration.language, "de");
        assert_eq!(next.configuration.processing.model, "text-new");
        assert!(next.configuration.processing.prompt.is_none());
        assert_eq!(next.configuration.delivery.output, "respond");
    }
    #[test]
    fn persisted_configuration_excludes_credentials_context_and_machine_paths() {
        let mut session = fixture();
        session.clipboard = Some("PRIVATE_CLIPBOARD".into());
        session.configuration.processing.endpoint = saved_endpoint(
            "https://user:URL_SECRET@example.com/v1?key=QUERY_SECRET#FRAGMENT_SECRET",
        );
        let saved = serde_json::to_string(&session.configuration).unwrap();
        for secret in [
            "DO_NOT_PERSIST",
            "PRIVATE_CLIPBOARD",
            "/private/weights",
            "PRIVATE_DOWNLOAD",
            "URL_SECRET",
            "QUERY_SECRET",
            "FRAGMENT_SECRET",
            "hasKey",
            "apiKey",
            "legacy",
        ] {
            assert!(!saved.contains(secret), "Unexpected field in saved config");
        }
        assert_eq!(
            session.configuration.processing.endpoint,
            "https://example.com/v1"
        );
        let restored: SessionConfiguration = serde_json::from_str(&saved).unwrap();
        let p = restored.processing.preferences();
        assert_eq!(restored.version, 1);
        assert_eq!(p.processing_model, "text-old");
        assert_eq!(p.processing_provider, "ollama");
        assert!(p.enhance);
    }
    #[tokio::test]
    async fn processing_request_uses_recorder_choices_with_frozen_endpoint_model_and_instructions() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let mut p = Preferences {
            enhance: true,
            processing_provider: "ollama".into(),
            processing_model: "text-original".into(),
            processing_endpoint: endpoint,
            ..Default::default()
        };
        let mut mode = Mode {
            prompt: "Keep original rules".into(),
            ..Default::default()
        };
        let session = RecordingSession::resolved(
            p.clone(),
            Some(&mode),
            fixture().model,
            vec![],
            vec![],
            vec![],
            false,
        )
        .with_processing(&ProcessingChange::Enhance(false))
        .with_processing(&ProcessingChange::Shorten(true))
        .with_processing(&ProcessingChange::Translation("english".into()));
        p.processing_endpoint = "http://127.0.0.1:1/v1".into();
        p.processing_model = "text-changed".into();
        mode.prompt = "New rules".into();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = vec![];
            let offset = loop {
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    break i + 4;
                }
            };
            let headers = String::from_utf8_lossy(&bytes[..offset]);
            assert!(headers.starts_with("POST /api/chat "));
            let len: usize = headers
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length: ")
                        .map(str::to_owned)
                })
                .unwrap()
                .parse()
                .unwrap();
            while bytes.len() < offset + len {
                let mut buf = [0; 4096];
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
            }
            let body: serde_json::Value =
                serde_json::from_slice(&bytes[offset..offset + len]).unwrap();
            assert_eq!(body["model"], "text-original");
            let prompt = body["messages"][0]["content"].as_str().unwrap();
            assert!(prompt.contains("Keep original rules"));
            assert!(!prompt.contains("New rules"));
            assert!(!prompt.contains("Improve grammar"));
            assert!(prompt.contains("Make the text concise"));
            assert!(prompt.contains("translate into natural English"));
            let response = r#"{"message":{"content":"Processed original session"}}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        });
        let text = crate::providers::process(
            &session.preferences,
            session.configuration.processing.prompt.as_ref().unwrap(),
            "Source text",
        )
        .await
        .unwrap();
        assert_eq!(text, "Processed original session");
        server.join().unwrap();
    }
}
