//! Manual edits change the displayed result only, never the recognition source.
use crate::{
    domain::Transcript,
    engine::AppState,
    store::{err, Store},
};
use rusqlite::{params, OptionalExtension};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualCorrection {
    pub previous_text: String,
    pub corrected_at: f64,
}

fn active_processing() -> &'static Mutex<HashSet<String>> {
    static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}
pub struct ProcessingGuard {
    id: String,
}
pub fn processing_guard(id: &str) -> Result<ProcessingGuard, String> {
    if !active_processing().lock().map_err(err)?.insert(id.into()) {
        return Err("This transcription is already being processed".into());
    }
    Ok(ProcessingGuard { id: id.into() })
}
impl Drop for ProcessingGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = active_processing().lock() {
            active.remove(&self.id);
        }
    }
}

impl Store {
    // Delivery completes after the processing guard is released. Patch only its
    // error; a late delivery callback must not replace an intervening edit.
    pub fn record_transcript_error(&self, id: &str, error: &str) -> Result<(), String> {
        let changed = self
            .db
            .lock()
            .map_err(err)?
            .execute(
                "UPDATE transcripts SET data=json_set(data,'$.processingError',?1) WHERE id=?2",
                params![error, id],
            )
            .map_err(err)?;
        if changed == 0 {
            return Err("This transcription was deleted".into());
        }
        Ok(())
    }
    pub fn correct_transcript(
        &self,
        id: &str,
        expected_text: &str,
        text: &str,
    ) -> Result<Transcript, String> {
        if text.trim().is_empty() {
            return Err("Enter the corrected text".into());
        }
        if text.len() > 1_000_000 {
            return Err("The corrected text is too long".into());
        }
        // Read, compare and update under one lock. An edit cannot resurrect a
        // deleted row or overwrite a result changed while the editor was open.
        let active = active_processing().lock().map_err(err)?;
        if active.contains(id) {
            return Err("Wait for text processing to finish before editing this result".into());
        }
        let db = self.db.lock().map_err(err)?;
        let data: Option<String> = db
            .query_row("SELECT data FROM transcripts WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(err)?;
        let mut value: serde_json::Value =
            serde_json::from_str(&data.ok_or("This transcription was deleted")?).map_err(err)?;
        let current: Transcript = serde_json::from_value(value.clone()).map_err(err)?;
        if current.status != "completed" || value["processingState"].as_str() == Some("processing")
        {
            return Err("Wait for this transcription to finish before editing it".into());
        }
        if current.delivered_text() != expected_text {
            return Err(
                "This result changed while you were editing. Reopen it to edit the latest text"
                    .into(),
            );
        }
        // Keep all metadata (including future fields) and the original text.
        // Remove formatted delivery markup: it no longer describes this edit.
        value["manualCorrection"] = serde_json::to_value(ManualCorrection {
            previous_text: current
                .manual_correction
                .as_ref()
                .map(|edit| edit.previous_text.clone())
                .unwrap_or_else(|| current.delivered_text().into()),
            corrected_at: chrono::Utc::now().timestamp_millis() as f64 / 1000.,
        })
        .map_err(err)?;
        value["enhancedText"] = text.into();
        value.as_object_mut().unwrap().remove("formattedSnippet");
        db.execute(
            "UPDATE transcripts SET data=?1 WHERE id=?2",
            params![serde_json::to_string(&value).map_err(err)?, id],
        )
        .map_err(err)?;
        serde_json::from_value(value).map_err(err)
    }
}

#[tauri::command]
pub fn save_transcript_correction(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: String,
    expected_text: String,
    text: String,
) -> Result<Transcript, String> {
    let transcript = state.store.correct_transcript(&id, &expected_text, &text)?;
    let _ = app.emit("data-changed", ());
    Ok(transcript)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> Store {
        Store::open(
            &std::env::temp_dir().join(format!("no-tipe-result-edit-{}", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }
    fn transcript() -> Transcript {
        // Deserialize to keep these tests compatible with additive session fields.
        serde_json::from_value(serde_json::json!({"id":"result", "text":"исходная диктовка", "enhancedText":"  previous edit  ", "formattedSnippet":"<b>previous edit</b>", "processingError":null, "timestamp":1., "duration":2., "audioFile":null, "model":null, "processingModel":null, "mode":null, "status":"completed", "transcriptionDuration":null, "enhancementDuration":null})).unwrap()
    }
    #[test]
    fn correction_survives_restart_without_changing_source_or_statistics() {
        let store = store();
        let t = transcript();
        store.save_transcript(&t).unwrap();
        let stats = serde_json::to_value(store.statistics(0.).unwrap()).unwrap();
        // Unrecognised metadata also survives the atomic patch.
        store.db.lock().unwrap().execute("UPDATE transcripts SET data=json_set(data,'$.futureField','keep') WHERE id='result'", []).unwrap();
        let result = store
            .correct_transcript(&t.id, "  previous edit  ", "  исправленный результат\n")
            .unwrap();
        assert_eq!(result.id, t.id);
        assert_eq!(store.transcripts("исправленный", 0, 50).unwrap().len(), 1);
        assert_eq!(result.text, t.text);
        assert_eq!(result.delivered_text(), "  исправленный результат\n");
        assert!(result.formatted_snippet.is_none());
        assert_eq!(
            result.manual_correction.as_ref().unwrap().previous_text,
            "  previous edit  "
        );
        assert_eq!(
            serde_json::to_value(store.statistics(0.).unwrap()).unwrap(),
            stats
        );
        assert!(store
            .list::<crate::domain::DictionaryEntry>("dictionary")
            .unwrap()
            .is_empty());
        let raw: String = store
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT json_extract(data,'$.futureField') FROM transcripts WHERE id='result'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(raw, "keep");
        let second = store
            .correct_transcript(&t.id, result.delivered_text(), "second correction")
            .unwrap();
        assert_eq!(
            second.manual_correction.as_ref().unwrap().previous_text,
            "  previous edit  "
        );
        let root = store.root.clone();
        drop(store);
        let reopened = Store::open(&root).unwrap();
        assert_eq!(reopened.transcript(&t.id).unwrap().text, t.text);
        assert_eq!(
            serde_json::to_value(reopened.statistics(0.).unwrap()).unwrap(),
            stats
        );
        assert_eq!(
            reopened.transcript(&t.id).unwrap().delivered_text(),
            "second correction"
        );
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn manual_edits_are_not_recovered_as_ai_corrections_on_restart() {
        let store = store();
        let mut t = transcript();
        t.enhanced_text = None;
        store.save_transcript(&t).unwrap();
        let stats = serde_json::to_value(store.statistics(0.).unwrap()).unwrap();
        store
            .correct_transcript(&t.id, &t.text, "manually corrected result")
            .unwrap();
        let root = store.root.clone();
        drop(store);
        let reopened = Store::open(&root).unwrap();
        assert_eq!(
            serde_json::to_value(reopened.statistics(0.).unwrap()).unwrap(),
            stats
        );
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn late_delivery_error_cannot_overwrite_an_edit_or_resurrect_a_deleted_row() {
        let store = store();
        let t = transcript();
        store.save_transcript(&t).unwrap();
        store
            .correct_transcript(&t.id, t.delivered_text(), "saved manual result")
            .unwrap();
        store
            .record_transcript_error(&t.id, "Delivery failed")
            .unwrap();
        let current = store.transcript(&t.id).unwrap();
        assert_eq!(current.delivered_text(), "saved manual result");
        assert_eq!(current.text, t.text);
        assert!(current.manual_correction.is_some());
        assert_eq!(current.processing_error.as_deref(), Some("Delivery failed"));
        store.delete("transcripts", &t.id).unwrap();
        assert!(store
            .record_transcript_error(&t.id, "Late delivery")
            .is_err());
        assert!(store.transcripts("", 0, 50).unwrap().is_empty());
        let root = store.root.clone();
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn active_processing_rejects_edits_and_duplicate_requests() {
        let store = store();
        let mut t = transcript();
        t.id = "processing-session".into();
        store.save_transcript(&t).unwrap();
        let guard = processing_guard(&t.id).unwrap();
        assert!(processing_guard(&t.id).is_err());
        assert!(store
            .correct_transcript(&t.id, t.delivered_text(), "manual edit")
            .is_err());
        drop(guard);
        store
            .correct_transcript(&t.id, t.delivered_text(), "manual edit")
            .unwrap();
        let root = store.root.clone();
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stale_blank_inflight_and_deleted_edits_are_rejected() {
        let store = store();
        let mut t = transcript();
        store.save_transcript(&t).unwrap();
        assert!(store
            .correct_transcript(&t.id, t.delivered_text(), " \n ")
            .is_err());
        store
            .correct_transcript(&t.id, t.delivered_text(), "first correction")
            .unwrap();
        assert!(store
            .correct_transcript(&t.id, t.delivered_text(), "stale correction")
            .is_err());
        assert_eq!(
            store.transcript(&t.id).unwrap().delivered_text(),
            "first correction"
        );
        store.db.lock().unwrap().execute("UPDATE transcripts SET data=json_set(data,'$.processingState','processing') WHERE id='result'", []).unwrap();
        assert!(store
            .correct_transcript(&t.id, "first correction", "during AI processing")
            .is_err());
        t.status = "processing".into();
        store.save_transcript(&t).unwrap();
        assert!(store
            .correct_transcript(&t.id, t.delivered_text(), "during processing")
            .is_err());
        store.delete("transcripts", &t.id).unwrap();
        assert!(store
            .correct_transcript(&t.id, t.delivered_text(), "deleted correction")
            .is_err());
        assert!(store.transcripts("", 0, 50).unwrap().is_empty());
        let root = store.root.clone();
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
