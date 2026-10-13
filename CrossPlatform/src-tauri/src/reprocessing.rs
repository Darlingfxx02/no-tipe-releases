//! Retry processing updates the existing history row; recognition is a separate
//! operation. Never rebuild a transcript from its audio as a side effect.
use crate::{domain::*, session::ProcessingConfiguration, store::Store};
use std::time::Instant;

pub fn saved_configuration(t: &Transcript) -> Result<Option<ProcessingConfiguration>, String> {
    if t.session_config.as_ref().is_some_and(|s| s.version != 1) {
        return Err(
            "Unsupported saved session configuration. Choose current settings in Review.".into(),
        );
    }
    Ok(t.processing_config
        .clone()
        .or_else(|| t.session_config.as_ref().map(|s| s.processing.clone())))
}

pub fn current_configuration(store: &Store) -> Result<ProcessingConfiguration, String> {
    let mut p = store.preferences()?;
    let modes = store.list::<Mode>("modes")?;
    let mode = modes
        .iter()
        .find(|m| m.enabled && Some(&m.id) == p.active_mode.as_ref());
    // Review's explicit Enhance button can process a dictation recorded with
    // editing off, without changing switches for the next recording.
    if processing_prompt(&p, mode).is_none() {
        p.enhance = true;
    }
    let config = processing_preferences(&p, mode);
    Ok(ProcessingConfiguration {
        empowerment: None,
        provider: config.processing_provider.clone(),
        model: config.processing_model.clone(),
        endpoint: crate::session::saved_endpoint(&config.processing_endpoint),
        timeout: config.processing_timeout,
        enhance: p.enhance,
        shorten: p.shorten,
        remove_trailing_period: p.remove_trailing_period,
        translation: p.translation.clone(),
        instructions: mode.map(|m| m.prompt.clone()).unwrap_or_default(),
        prompt: processing_prompt(&p, mode),
    })
}

pub fn error_message(error: String) -> String {
    if matches!(error.as_str(), "No speech text was returned" | "no-tipe-i18n:native.no_speech_text") {
        crate::localization::message("native.empty_processing")
    } else {
        error
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{Arc, Mutex},
    };
    fn transcript() -> Transcript {
        serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"text":"the original text","enhancedText":null,"processingError":null,"timestamp":1700000000.0,"duration":3.0,"audioFile":null,"model":"Speech","processingModel":null,"mode":null,"status":"completed","transcriptionDuration":0.2,"enhancementDuration":null})).unwrap()
    }
    fn configuration(endpoint: String) -> ProcessingConfiguration {
        ProcessingConfiguration {
            empowerment: None,
            provider: "ollama".into(),
            model: "test-text".into(),
            endpoint,
            timeout: 10,
            enhance: true,
            shorten: false,
            remove_trailing_period: false,
            translation: "off".into(),
            instructions: "Keep names".into(),
            prompt: Some("Clean punctuation and keep names".into()),
        }
    }
    fn server(status: u16, output: &str) -> (String, std::thread::JoinHandle<serde_json::Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let body = serde_json::json!({"message":{"content":output}}).to_string();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .unwrap();
            let mut bytes = vec![];
            let offset = loop {
                let mut buffer = [0; 4096];
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let headers = String::from_utf8_lossy(&bytes[..offset]);
            assert!(headers.starts_with("POST /api/chat "));
            let length: usize = headers
                .lines()
                .find_map(|l| {
                    l.to_lowercase()
                        .strip_prefix("content-length: ")
                        .map(str::to_owned)
                })
                .unwrap()
                .parse()
                .unwrap();
            while bytes.len() < offset + length {
                let mut buffer = [0; 4096];
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
            }
            let request = serde_json::from_slice(&bytes[offset..offset + length]).unwrap();
            write!(stream,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            request
        });
        (endpoint, thread)
    }
    fn store() -> Store {
        Store::open(
            &std::env::temp_dir().join(format!("no-tipe-retry-test-{}", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }
    fn add_extra_metadata(s: &Store, id: &str) {
        s.db.lock().unwrap().execute("UPDATE transcripts SET data=json_set(data,'$.legacyExtension.label','keep') WHERE id=?1", [id]).unwrap();
    }
    fn assert_extra_metadata(s: &Store, id: &str) {
        let label: String = s
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT json_extract(data,'$.legacyExtension.label') FROM transcripts WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(label, "keep");
    }
    #[tokio::test]
    async fn source_is_published_before_result_and_same_row_updates_without_duplicate_statistics() {
        let s = store();
        let t = transcript();
        s.save_transcript(&t).unwrap();
        add_extra_metadata(&s, &t.id);
        let (endpoint, server_thread) = server(200, "The improved text.");
        let events = Mutex::new(vec![]);
        let result = retry(&s, &t.id, configuration(endpoint), || {
            let stored = s.transcript(&t.id).unwrap();
            assert_extra_metadata(&s, &t.id);
            events
                .lock()
                .unwrap()
                .push((stored.processing_state, stored.delivered_text().to_owned()));
        })
        .await
        .unwrap();
        assert_eq!(server_thread.join().unwrap()["model"], "test-text");
        assert_eq!(
            events.into_inner().unwrap(),
            vec![
                (ProcessingState::Processing, t.text.clone()),
                (ProcessingState::Completed, "The improved text.".into())
            ]
        );
        assert_eq!(result.id, t.id);
        assert_eq!(result.text, t.text);
        assert_eq!(s.transcripts("", 0, 50).unwrap().len(), 1);
        assert_eq!(s.statistics(0.).unwrap().sessions, 1);
        assert_eq!(s.statistics(0.).unwrap().words, 3);
        assert_eq!(s.statistics(0.).unwrap().words_corrected, 1);
        let (endpoint, server_thread) = server(200, "The original text!");
        retry(&s, &t.id, configuration(endpoint), || {})
            .await
            .unwrap();
        server_thread.join().unwrap();
        assert_eq!(s.statistics(0.).unwrap().sessions, 1);
        assert_eq!(s.statistics(0.).unwrap().words, 3);
        assert_eq!(s.statistics(0.).unwrap().words_corrected, 0);
        let root = s.root.clone();
        drop(s);
        let reopened = Store::open(&root).unwrap();
        assert_extra_metadata(&reopened, &t.id);
        assert_eq!(
            reopened.transcript(&t.id).unwrap().delivered_text(),
            "The original text!"
        );
    }
    #[tokio::test]
    async fn final_period_cleanup_runs_after_ai_and_survives_saved_retries() {
        let s = store();
        let mut t = transcript();
        t.text = "First sentence. Last sentence.".into();
        s.save_transcript(&t).unwrap();
        for _ in 0..2 {
            let (endpoint, thread) = server(200, "First sentence. Improved last sentence.");
            let mut config = configuration(endpoint);
            config.remove_trailing_period = true;
            let result = retry(&s, &t.id, config, || {}).await.unwrap();
            thread.join().unwrap();
            assert_eq!(result.text, t.text);
            assert_eq!(result.delivered_text(), "First sentence. Improved last sentence");
            assert!(saved_configuration(&result).unwrap().unwrap().remove_trailing_period);
        }
    }
    #[tokio::test]
    async fn failure_retains_original_and_delivery_error_is_independent() {
        let s = store();
        let t = transcript();
        s.save_transcript(&t).unwrap();
        let (endpoint, server_thread) = server(503, "private response should never be saved");
        let result = retry(&s, &t.id, configuration(endpoint), || {
            if s.transcript(&t.id).unwrap().processing_state == ProcessingState::Processing {
                s.record_delivery_error(&t.id, Some("Delivery adapter failed".into()))
                    .unwrap();
            }
        })
        .await
        .unwrap();
        server_thread.join().unwrap();
        assert_eq!(result.processing_state, ProcessingState::Failed);
        assert_eq!(result.delivered_text(), t.text);
        assert_eq!(
            result.processing_error,
            Some(crate::localization::message_with_values("native.provider.http",serde_json::json!({"status":503})))
        );
        assert_eq!(
            result.delivery_error.as_deref(),
            Some("Delivery adapter failed")
        );
        assert!(result.recognition_error.is_none());
        assert_eq!(s.statistics(0.).unwrap().sessions, 1);
    }
    #[tokio::test]
    async fn saved_empowerment_survives_retry_without_reaching_the_editing_model_or_duplicating() {
        let s = store();
        let t = transcript();
        s.save_transcript(&t).unwrap();
        let modifier = crate::empowerment::Empowerment::resolve(Some("brief"), &Preferences { ui_language: "en".into(), ..Default::default() }).unwrap().unwrap();
        for _ in 0..2 {
            let (endpoint, thread) = server(200, "The improved text.");
            let mut config = configuration(endpoint);
            config.empowerment = Some(modifier.clone());
            let result = retry(&s, &t.id, config, || {}).await.unwrap();
            let request = thread.join().unwrap();
            assert!(!request.to_string().contains(&modifier.instruction));
            assert_eq!(result.text, t.text);
            assert_eq!(result.delivered_text(), modifier.append("The improved text."));
            let stored = saved_configuration(&s.transcript(&t.id).unwrap()).unwrap().unwrap();
            assert_eq!(stored.empowerment.unwrap().instruction, modifier.instruction);
        }
        assert_eq!(s.statistics(0.).unwrap().sessions, 1);
    }
    #[test]
    fn simultaneous_retries_have_one_winner_and_restart_recovers_source() {
        let s = Arc::new(store());
        let t = transcript();
        s.save_transcript(&t).unwrap();
        add_extra_metadata(&s, &t.id);
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let threads: Vec<_> = (0..2)
            .map(|_| {
                let s = s.clone();
                let barrier = barrier.clone();
                let id = t.id.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    s.begin_transcript_processing(
                        &id,
                        configuration("http://127.0.0.1:1/v1".into()),
                    )
                    .is_ok()
                })
            })
            .collect();
        barrier.wait();
        let wins = threads
            .into_iter()
            .filter_map(|t| t.join().ok())
            .filter(|ok| *ok)
            .count();
        assert_eq!(wins, 1);
        assert!(s.delete("transcripts", &t.id).is_err());
        let reopened = Store::open(&s.root).unwrap();
        assert_extra_metadata(&reopened, &t.id);
        let recovered = reopened.transcript(&t.id).unwrap();
        assert_eq!(recovered.processing_state, ProcessingState::Interrupted);
        assert_eq!(recovered.text, t.text);
        assert_eq!(reopened.statistics(0.).unwrap().sessions, 1);
        assert!(reopened
            .begin_transcript_processing(&t.id, configuration("http://127.0.0.1:1/v1".into()))
            .is_ok());
    }
    #[tokio::test]
    async fn retry_uses_protected_source_and_saved_configuration_after_settings_change() {
        let s = store();
        let mut t = transcript();
        let snippet = crate::snippets::Snippet {
            id: "signature".into(),
            trigger: "my signature".into(),
            expansion: "Alex\nDesigner".into(),
            enabled: true,
            date_added: 0.,
            formatting: vec![],
        };
        let expansion = crate::snippets::prepare("hello my signature", &[snippet]);
        t.text = expansion.restore(&expansion.protected);
        t.processing_source = Some(expansion.clone());
        let (endpoint, server_thread) = server(
            200,
            &format!(
                "Hello {}.",
                expansion.protected.trim_start_matches("hello ")
            ),
        );
        t.processing_config = Some(configuration(endpoint));
        s.save_transcript(&t).unwrap();
        s.set_preferences(&Preferences {
            processing_model: "changed".into(),
            ..Default::default()
        })
        .unwrap();
        let result = retry(&s, &t.id, saved_configuration(&t).unwrap().unwrap(), || {})
            .await
            .unwrap();
        let sent = server_thread.join().unwrap();
        assert_eq!(sent["model"], "test-text");
        assert!(sent["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains(crate::snippets::PRESERVE));
        assert!(result.delivered_text().contains("Alex\nDesigner"));
        assert_eq!(result.text, t.text);
    }
    #[tokio::test]
    async fn failed_retry_preserves_manual_result_success_clears_old_manual_metadata() {
        let s = store();
        let mut value = serde_json::to_value(transcript()).unwrap();
        value["enhancedText"] = serde_json::json!("Manually corrected text");
        value["manualCorrection"] =
            serde_json::json!({"previousText":"Earlier AI text","correctedAt":1700000000.0});
        value["formattedSnippet"] = serde_json::json!("<div>Old formatting</div>");
        let t: Transcript = serde_json::from_value(value).unwrap();
        s.save_transcript(&t).unwrap();
        let (endpoint, server_thread) = server(503, "");
        let failed = retry(&s, &t.id, configuration(endpoint), || {})
            .await
            .unwrap();
        server_thread.join().unwrap();
        assert_eq!(failed.delivered_text(), "Manually corrected text");
        assert_eq!(
            serde_json::to_value(&failed).unwrap()["manualCorrection"]["previousText"],
            "Earlier AI text"
        );
        assert!(failed.formatted_snippet.is_some());
        let (endpoint, server_thread) = server(200, "Processed again");
        let completed = retry(&s, &t.id, configuration(endpoint), || {})
            .await
            .unwrap();
        server_thread.join().unwrap();
        assert_eq!(completed.text, t.text);
        assert_eq!(completed.delivered_text(), "Processed again");
        assert!(serde_json::to_value(&completed).unwrap()["manualCorrection"].is_null());
        assert!(completed.formatted_snippet.is_none());
        assert_eq!(s.statistics(0.).unwrap().sessions, 1);
    }
    #[test]
    fn backup_import_recovers_processing_and_keeps_legacy_history_and_totals() {
        let source = store();
        let t = transcript();
        source.save_transcript(&t).unwrap();
        source
            .begin_transcript_processing(&t.id, configuration("http://127.0.0.1:1/v1".into()))
            .unwrap();
        let backup = source.backup().unwrap();
        let target = store();
        assert_eq!(target.import_backup(backup).unwrap(), 1);
        let recovered = target.transcript(&t.id).unwrap();
        assert_eq!(recovered.processing_state, ProcessingState::Interrupted);
        assert_eq!(recovered.text, t.text);
        assert!(recovered.session_config.is_none());
        assert_eq!(target.statistics(0.).unwrap().sessions, 1);
        assert_eq!(target.statistics(0.).unwrap().words, 3);
        let mut legacy = transcript();
        legacy.id = "legacy-pending".into();
        legacy.status = "pending".into();
        legacy.text.clear();
        target.save_transcript(&legacy).unwrap();
        let root = target.root.clone();
        drop(target);
        let reopened = Store::open(&root).unwrap();
        let old = reopened.transcript(&legacy.id).unwrap();
        assert_eq!(old.status, "failed");
        assert!(old.recognition_error.is_some());
        assert!(old.processing_error.is_none());
        assert_eq!(reopened.statistics(0.).unwrap().sessions, 1);
    }
    #[test]
    fn legacy_recognition_and_delivery_errors_are_classified_without_processing_audio() {
        let mut t = transcript();
        assert!(saved_configuration(&t).unwrap().is_none());
        t.processing_error = Some("Text could not be delivered. It is saved in History.".into());
        t.normalize_stage_errors();
        assert!(t.delivery_error.is_some());
        assert!(t.processing_error.is_none());
        t.status = "failed".into();
        t.processing_error = Some("No speech detected".into());
        t.normalize_stage_errors();
        assert!(t.recognition_error.is_some());
        assert!(t.processing_error.is_none());
        let s = store();
        s.save_transcript(&t).unwrap();
        assert!(s
            .begin_transcript_processing(&t.id, configuration("http://127.0.0.1:1/v1".into()))
            .is_err());
        assert_eq!(s.transcripts("", 0, 50).unwrap().len(), 1);
    }
}

pub async fn retry(
    store: &Store,
    id: &str,
    config: ProcessingConfiguration,
    changed: impl Fn(),
) -> Result<Transcript, String> {
    let _guard = crate::result_edit::processing_guard(id)?;
    config.preferences().validate()?;
    let prompt = config
        .prompt
        .clone()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Choose processing rules in Review before enhancing this entry")?;
    let mut saved = config.clone();
    saved.endpoint = crate::session::saved_endpoint(&saved.endpoint);
    let mut t = store.begin_transcript_processing(id, saved)?;
    changed();
    let start = Instant::now();
    let plan = crate::snippets::processing_plan(&t);
    let input = plan.protected.as_str();
    let prompt = if plan.has_matches() {
        format!("{prompt}\n{}", crate::snippets::PRESERVE)
    } else {
        prompt
    };
    let result = crate::providers::process(&config.preferences(), &prompt, input).await;
    match result {
        Ok(text) if !text.trim().is_empty() => {
            if let Some(insights) = &mut t.insights {
                insights.words_corrected = crate::insight_stats::corrected_words(input, &text);
            }
            let text = plan.restore(&text);
            t.enhanced_text = Some(config.empowerment.as_ref().map_or_else(|| text.clone(), |modifier| modifier.append(&text)));
            crate::text_cleanup::apply(&mut t, config.remove_trailing_period);
            t.processing_error = None;
            t.processing_state = ProcessingState::Completed;
        }
        result => {
            t.processing_error = Some(match result {
                Err(error) => error_message(error),
                Ok(_) => crate::localization::message("native.empty_processing"),
            });
            t.processing_state = ProcessingState::Failed;
        }
    }
    t.processing_model = Some(config.model);
    t.enhancement_duration = Some(start.elapsed().as_secs_f64());
    // Delivery may finish while a history retry runs. Update only the fields
    // owned by processing, so its delivery error cannot be overwritten.
    store.finish_transcript_processing(&t)?;
    changed();
    store.transcript(id)
}
