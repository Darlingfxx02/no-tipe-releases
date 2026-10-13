use crate::domain::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct Store {
    pub db: Mutex<Connection>,
    pub root: PathBuf,
}
#[derive(serde::Deserialize)]
pub struct TranscriptCursor {
    pub timestamp: f64,
    pub id: String,
}
impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(err)?;
        for child in ["audio", "models", "backups"] {
            std::fs::create_dir_all(root.join(child)).map_err(err)?;
        }
        let database = root.join(crate::legacy::CURRENT_DATABASE);
        if !database.exists() && root.join(crate::legacy::DATABASE).is_file() {
            crate::legacy::snapshot_database(&root.join(crate::legacy::DATABASE), &database)?;
        }
        let db = Connection::open(database).map_err(err)?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS transcripts(id TEXT PRIMARY KEY, timestamp REAL NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, data TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS transcripts_time ON transcripts(timestamp DESC);
          CREATE INDEX IF NOT EXISTS transcripts_history ON transcripts(timestamp DESC, id DESC);
          CREATE TABLE IF NOT EXISTS metrics(id TEXT PRIMARY KEY, transcript_id TEXT NOT NULL UNIQUE, timestamp REAL NOT NULL, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS modes(id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS empowerments(id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS dictionary(id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS snippets(id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS models(id TEXT PRIMARY KEY, data TEXT NOT NULL);
          PRAGMA user_version=2;").map_err(err)?;
        let store = Self { db: Mutex::new(db), root: root.into() };
        crate::telemetry::create_tables(&*store.db.lock().map_err(err)?)?;
        // Backups and old installations can contain modifier-only Mac shortcuts.
        // Adapt only when loading stored data, never while validating a new edit.
        if cfg!(target_os = "windows") {
            store.update_preferences(|p| {
                p.shortcut = crate::shortcuts::portable_shortcut(&p.shortcut, "windows");
                Ok(())
            })?;
        }
        store.recover_interrupted_transcripts()?;
        store.discard_silent_transcripts()?;
        store.recover_correction_metrics()?;
        // Previous builds retained successful recordings. Keep only audio
        // needed by the ten latest empty recognition failures.
        store.prune_audio(&*store.db.lock().map_err(err)?)?;
        store.remove_orphan_audio()?;
        Ok(store)
    }
    fn discard_silent_transcripts(&self) -> Result<(), String> {
        let items = {
            let db = self.db.lock().map_err(err)?;
            let mut q = db.prepare("SELECT data FROM transcripts WHERE status='failed'").map_err(err)?;
            let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
            rows.map(|row| serde_json::from_str::<Transcript>(&row.map_err(err)?).map_err(err)).collect::<Result<Vec<_>, _>>()?
        };
        for t in items.into_iter().filter(Transcript::is_no_speech) {
            self.discard_no_speech(&t)?;
        }
        Ok(())
    }
    fn discard_no_speech(&self, t: &Transcript) -> Result<(), String> {
        self.db.lock().map_err(err)?.execute("DELETE FROM transcripts WHERE id=?1", [&t.id]).map_err(err)?;
        // Silence has no recovery value. Only remove audio owned by this store.
        if let Some(path) = t.audio_file.as_deref().map(Path::new) {
            if path.parent() == Some(self.root.join("audio").as_path()) {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(())
    }
    fn prune_audio(&self, db: &Connection) -> Result<(), String> {
        let items = {
            let mut q = db.prepare("SELECT data FROM transcripts WHERE json_extract(data,'$.audioFile') IS NOT NULL ORDER BY timestamp DESC, rowid DESC").map_err(err)?;
            let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
            rows.map(|row| serde_json::from_str::<Transcript>(&row.map_err(err)?).map_err(err)).collect::<Result<Vec<_>, _>>()?
        };
        let mut kept = HashSet::new();
        let mut discarded = Vec::new();
        let mut failures = 0;
        for t in items {
            let path = PathBuf::from(t.audio_file.as_deref().unwrap());
            // Pending requests are active work, not retained history. Hourly
            // cleanup must never delete a file being used by recognition.
            if t.status == "pending" || (t.can_retry_recognition() && path.is_file() && failures < 10) {
                if t.status != "pending" { failures += 1; }
                kept.insert(path);
            } else {
                discarded.push((t.id, path));
            }
        }
        for (id, path) in discarded {
            if !kept.contains(&path) { self.remove_managed_audio(&path)?; }
            db.execute("UPDATE transcripts SET data=json_set(data,'$.audioFile',NULL) WHERE id=?1", [id]).map_err(err)?;
        }
        Ok(())
    }
    fn remove_managed_audio(&self, path: &Path) -> Result<(), String> {
        // Imported backup paths and the user's original input files are not
        // owned by this store and must never be deleted.
        if path.parent() == Some(self.root.join("audio").as_path()) {
            match std::fs::remove_file(path) {
                Ok(()) => {},
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
                Err(e) => return Err(err(e)),
            }
        }
        Ok(())
    }
    fn remove_orphan_audio(&self) -> Result<(), String> {
        // Only run before the recorder starts. Live recognition and file
        // preparation also use temporary files without history rows.
        let db = self.db.lock().map_err(err)?;
        let mut q = db.prepare("SELECT json_extract(data,'$.audioFile') FROM transcripts WHERE json_extract(data,'$.audioFile') IS NOT NULL").map_err(err)?;
        let kept = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?
            .map(|row| row.map(PathBuf::from).map_err(err)).collect::<Result<HashSet<_>, _>>()?;
        for entry in std::fs::read_dir(self.root.join("audio")).map_err(err)? {
            let entry = entry.map_err(err)?;
            let kind = entry.file_type().map_err(err)?;
            if (kind.is_file() || kind.is_symlink()) && !kept.contains(&entry.path()) {
                self.remove_managed_audio(&entry.path())?;
            }
        }
        Ok(())
    }
    fn recover_interrupted_transcripts(&self) -> Result<(), String> {
        let db = self.db.lock().map_err(err)?;
        let rows = {
            let mut q = db.prepare("SELECT data FROM transcripts WHERE status='pending' OR json_extract(data,'$.processingState')='processing'").map_err(err)?;
            let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        for data in rows {
            let mut t: Transcript = serde_json::from_str(&data).map_err(err)?;
            t.recover_interrupted();
            let patch = serde_json::json!({"status":t.status,"recognitionError":t.recognition_error,"processingError":t.processing_error,"deliveryError":t.delivery_error,"processingState":t.processing_state});
            db.execute("UPDATE transcripts SET status=?2,data=json_patch(data,json(?3)) WHERE id=?1", params![t.id,t.status,patch.to_string()]).map_err(err)?;
        }
        Ok(())
    }
    // Recover measurable AI edits from retained history once. Application and
    // dictionary usage cannot be reconstructed from old recordings.
    fn recover_correction_metrics(&self) -> Result<(), String> {
        let db = self.db.lock().map_err(err)?;
        let mut q = db.prepare("SELECT t.data FROM transcripts t JOIN metrics m ON m.transcript_id=t.id WHERE json_extract(m.data,'$.insights.wordsCorrected') IS NULL AND json_extract(t.data,'$.enhancedText') IS NOT NULL AND json_extract(t.data,'$.manualCorrection') IS NULL").map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        for row in rows {
            let t: Transcript = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if let Some(output) = t.enhanced_text.as_deref().filter(|text| !text.trim().is_empty()) {
                if let Some(count) = crate::insight_stats::corrected_words(&t.text, output) {
                    db.execute("UPDATE metrics SET data=json_set(data,'$.insights.wordsCorrected',?1) WHERE transcript_id=?2", params![count,t.id]).map_err(err)?;
                }
            }
        }
        Ok(())
    }
    pub fn preferences(&self) -> Result<Preferences, String> {
        Ok(self.get_meta("preferences")?.unwrap_or_default())
    }
    pub fn set_preferences(&self, value: &Preferences) -> Result<(), String> {
        value.validate()?;
        self.set_meta("preferences", value)
    }
    // Read, change and commit under one lock. Cloud controls and settings can
    // write concurrently; neither may replace the other's unrelated choices.
    pub fn update_preferences(&self, update: impl FnOnce(&mut Preferences) -> Result<(), String>) -> Result<Preferences, String> {
        self.update_preferences_with_commit(update, |_| {})
    }
    // OS effects may prepare a replacement before persistence. Commit them
    // under this same lock after SQLite succeeds; dropping the prepared effect
    // rolls it back if serialization or the write fails.
    pub fn update_preferences_with_commit<T>(&self, update: impl FnOnce(&mut Preferences) -> Result<T, String>, commit: impl FnOnce(T)) -> Result<Preferences, String> {
        let db = self.db.lock().map_err(err)?;
        let value: Option<String> = db.query_row("SELECT value FROM metadata WHERE key='preferences'", [], |r| r.get(0)).optional().map_err(err)?;
        let mut p: Preferences = value.map(|v| serde_json::from_str(&v).map_err(err)).transpose()?.unwrap_or_default();
        let previous=p.clone();
        let effects = update(&mut p)?;
        p.validate()?;
        let tx=db.unchecked_transaction().map_err(err)?;
        tx.execute("INSERT INTO metadata(key,value) VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&p).map_err(err)?]).map_err(err)?;
        crate::telemetry::consent_changed(&tx,&previous,&p)?;
        tx.commit().map_err(err)?;
        commit(effects);
        Ok(p)
    }
    pub fn get_meta<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        let s: Option<String> = self
            .db
            .lock()
            .map_err(err)?
            .query_row("SELECT value FROM metadata WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        s.map(|s| serde_json::from_str(&s).map_err(err)).transpose()
    }
    pub fn set_meta<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        self.db.lock().map_err(err)?.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,serde_json::to_string(value).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub fn list<T: DeserializeOwned>(&self, table: &str) -> Result<Vec<T>, String> {
        if !["modes", "empowerments", "dictionary", "snippets", "models", "metrics"].contains(&table) {
            return Err("Invalid collection".into());
        }
        let db = self.db.lock().map_err(err)?;
        let mut q = db
            .prepare(&format!("SELECT data FROM {table} ORDER BY rowid"))
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn put<T: Serialize>(&self, table: &str, id: &str, item: &T) -> Result<(), String> {
        if !["modes", "empowerments", "dictionary", "snippets", "models"].contains(&table) {
            return Err("Invalid collection".into());
        }
        self.db.lock().map_err(err)?.execute(&format!("INSERT INTO {table}(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data"), params![id,serde_json::to_string(item).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        if !["modes", "empowerments", "dictionary", "snippets", "models", "transcripts"].contains(&table) {
            return Err("Invalid collection".into());
        }
        // Metrics intentionally survive history deletion, as in the original app.
        let db=self.db.lock().map_err(err)?;
        let mut audio = None;
        if table == "transcripts" {
            let data: Option<String> = db.query_row("SELECT data FROM transcripts WHERE id=?1", [id], |r| r.get(0)).optional().map_err(err)?;
            if let Some(data) = data {
                let t: Transcript = serde_json::from_str(&data).map_err(err)?;
                if t.status == "pending" || t.processing_state == ProcessingState::Processing {
                    return Err("Wait for this dictation to finish before deleting it".into());
                }
                audio = t.audio_file;
            }
        }
        db.execute(&format!("DELETE FROM {table} WHERE id=?1"), [id]).map_err(err)?;
        if table=="transcripts" {
            purge_voice_cache(&db)?;
            if let Some(path) = audio { self.remove_managed_audio(Path::new(&path))?; }
        }
        Ok(())
    }
    pub fn transcripts(
        &self,
        search: &str,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Transcript>, String> {
        let db = self.db.lock().map_err(err)?;
        let mut q = db.prepare("SELECT data FROM transcripts WHERE (?1='' OR text LIKE ?2 ESCAPE '\\' OR json_extract(data,'$.enhancedText') LIKE ?2 ESCAPE '\\') ORDER BY timestamp DESC LIMIT ?3 OFFSET ?4").map_err(err)?;
        let term = format!(
            "%{}%",
            search
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let rows = q
            .query_map(params![search, term, limit.min(500), offset], |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?;
        rows.map(|r| {
            let mut t: Transcript = serde_json::from_str(&r.map_err(err)?).map_err(err)?;
            t.normalize_stage_errors();
            Ok(t)
        }).collect()
    }
    pub fn transcript_history(&self, search: &str, before: Option<&TranscriptCursor>, limit: u32) -> Result<Vec<Transcript>, String> {
        let db = self.db.lock().map_err(err)?;
        // Filter before limiting so canceled/empty entries cannot hide older
        // results. The ID resolves equal timestamps and keeps scrolling stable
        // when newer dictations arrive or earlier entries are deleted.
        let mut q = db.prepare("SELECT data FROM transcripts
            WHERE status!='canceled'
            AND (trim(text,char(9)||char(10)||char(13)||' ')!='' OR trim(COALESCE(json_extract(data,'$.enhancedText'),''),char(9)||char(10)||char(13)||' ')!='' OR status IN ('failed','pending'))
            AND (?1='' OR text LIKE ?2 ESCAPE '\\' OR json_extract(data,'$.enhancedText') LIKE ?2 ESCAPE '\\')
            AND (?3 IS NULL OR timestamp<?3 OR (timestamp=?3 AND id<?4))
            ORDER BY timestamp DESC, id DESC LIMIT ?5").map_err(err)?;
        let term = format!("%{}%", search.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let rows = q.query_map(params![search, term, before.map(|cursor|cursor.timestamp), before.map(|cursor|cursor.id.as_str()), limit.min(500)], |row|row.get::<_,String>(0)).map_err(err)?;
        rows.map(|row| {
            let mut t: Transcript = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            t.normalize_stage_errors();
            Ok(t)
        }).collect()
    }
    pub fn latest_transcript_text(&self) -> Result<Option<String>, String> {
        let db = self.db.lock().map_err(err)?;
        let mut q = db.prepare("SELECT data FROM transcripts WHERE status IN ('completed','failed') AND (text!='' OR COALESCE(json_extract(data,'$.enhancedText'),'')!='') ORDER BY timestamp DESC").map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        for row in rows {
            let t: Transcript = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            let text = t.delivered_text();
            if !text.trim().is_empty() {
                return Ok(Some(text.to_owned()));
            }
        }
        Ok(None)
    }
    pub fn transcript(&self, id: &str) -> Result<Transcript, String> {
        let data: String = self
            .db
            .lock()
            .map_err(err)?
            .query_row("SELECT data FROM transcripts WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mut t: Transcript = serde_json::from_str(&data).map_err(err)?;
        t.normalize_stage_errors();
        Ok(t)
    }
    /// Atomically reserves this row. Two IPC calls cannot both read an idle
    /// row and then start requests; automatic processing reserves before emit.
    pub fn begin_transcript_recognition(&self, id: &str) -> Result<Transcript, String> {
        let db = self.db.lock().map_err(err)?;
        let data: String = db.query_row("SELECT data FROM transcripts WHERE id=?1", [id], |r| r.get(0)).map_err(err)?;
        let mut t: Transcript = serde_json::from_str(&data).map_err(err)?;
        t.normalize_stage_errors();
        if !t.can_retry_recognition() || t.processing_state == ProcessingState::Processing {
            return Err("Only failed recognition can be retried. Wait for this entry to finish.".into());
        }
        if t.audio_file.as_deref().is_none_or(|path| path.is_empty()) {
            return Err("The recorded audio is no longer available. Start a new dictation.".into());
        }
        t.status = "pending".into();
        t.recognition_error = None;
        let patch = serde_json::json!({"status":t.status,"recognitionError":null,"processingError":t.processing_error});
        db.execute("UPDATE transcripts SET status='pending',data=json_patch(data,json(?2)) WHERE id=?1", params![id,patch.to_string()]).map_err(err)?;
        Ok(t)
    }
    pub fn begin_transcript_processing(&self, id: &str, config: crate::session::ProcessingConfiguration) -> Result<Transcript,String> {
        let db=self.db.lock().map_err(err)?;
        let data:String=db.query_row("SELECT data FROM transcripts WHERE id=?1",[id],|r|r.get(0)).map_err(err)?;
        let mut t:Transcript=serde_json::from_str(&data).map_err(err)?;
        t.normalize_stage_errors();
        if t.processing_state==ProcessingState::Processing {return Err("This entry is already being enhanced".into());}
        if t.status!="completed" || t.text.trim().is_empty() {return Err("Recognition must finish before text processing. Start a new dictation to retry recognition.".into());}
        t.processing_state=ProcessingState::Processing;
        t.processing_error=None;
        t.processing_config=Some(config);
        // Preserve additive history metadata, just as manual corrections do.
        let mut patch=serde_json::json!({"processingState":t.processing_state,"processingError":null,"processingConfig":t.processing_config});
        if let Some(error)=&t.delivery_error { patch["deliveryError"]=error.clone().into(); }
        if let Some(error)=&t.recognition_error { patch["recognitionError"]=error.clone().into(); }
        db.execute("UPDATE transcripts SET data=json_patch(data,json(?2)) WHERE id=?1",params![id,patch.to_string()]).map_err(err)?;
        Ok(t)
    }
    pub fn finish_transcript_processing(&self, t: &Transcript) -> Result<(),String> {
        let mut db=self.db.lock().map_err(err)?;
        let tx=db.transaction().map_err(err)?;
        let mut patch=serde_json::json!({"enhancedText":t.enhanced_text,"processingError":t.processing_error,"processingState":t.processing_state,"processingModel":t.processing_model,"enhancementDuration":t.enhancement_duration});
        if t.processing_state==ProcessingState::Completed {
            patch["manualCorrection"]=serde_json::Value::Null;
            patch["formattedSnippet"]=serde_json::Value::Null;
        }
        let changed=tx.execute("UPDATE transcripts SET data=json_patch(data,json(?2)) WHERE id=?1",params![t.id,patch.to_string()]).map_err(err)?;
        if changed!=1 {return Err("This history entry no longer exists".into());}
        if t.processing_state==ProcessingState::Completed {
            if let Some(count)=t.insights.as_ref().and_then(|i|i.words_corrected).or_else(||t.enhanced_text.as_deref().and_then(|output|crate::insight_stats::corrected_words(&t.text,output))) {
                tx.execute("UPDATE metrics SET data=json_set(data,'$.insights.wordsCorrected',?2) WHERE transcript_id=?1",params![t.id,count]).map_err(err)?;
                tx.execute("UPDATE transcripts SET data=json_set(data,'$.insights.wordsCorrected',?2) WHERE id=?1",params![t.id,count]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)?;
        drop(db);
        crate::diagnostics::transcript_saved(t);
        Ok(())
    }
    pub fn record_delivery_error(&self, id: &str, error: Option<String>) -> Result<(),String> {
        let db=self.db.lock().map_err(err)?;
        db.execute("UPDATE transcripts SET data=json_set(data,'$.deliveryError',json(?2)) WHERE id=?1",params![id,serde_json::to_string(&error).map_err(err)?]).map_err(err)?;
        if let Ok(data)=db.query_row("SELECT data FROM transcripts WHERE id=?1",[id],|r|r.get::<_,String>(0)){if let Ok(t)=serde_json::from_str::<Transcript>(&data){let _=crate::telemetry::record(&db,&t);}}
        Ok(())
    }
    pub fn save_transcript(&self, t: &Transcript) -> Result<(), String> {
        if t.is_no_speech() {
            self.discard_no_speech(t)?;
            crate::diagnostics::transcript_saved(t);
            return Ok(());
        }
        let mut db = self.db.lock().map_err(err)?;
        let tx = db.transaction().map_err(err)?;

        tx.execute("INSERT INTO transcripts(id,timestamp,status,text,data) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET status=excluded.status,text=excluded.text,data=excluded.data", params![t.id,t.timestamp,t.status,t.text,serde_json::to_string(t).map_err(err)?]).map_err(err)?;
        if t.status == "completed" && !t.text.trim().is_empty() {
            let m = Metric {
                id: t.id.clone(),
                transcript_id: t.id.clone(),
                timestamp: t.timestamp,
                words: t.text.split_whitespace().count() as u64,
                duration: t.duration,
                model: t.model.clone().unwrap_or_default(),
                transcription_duration: t.transcription_duration.unwrap_or_default(),
                mode: t.mode.clone().unwrap_or_default(),
                insights: t.insights.clone(),
            };
            tx.execute("INSERT INTO metrics(id,transcript_id,timestamp,data) VALUES(?1,?2,?3,?4) ON CONFLICT(transcript_id) DO NOTHING", params![m.id,m.transcript_id,m.timestamp,serde_json::to_string(&m).map_err(err)?]).map_err(err)?;
        }
        if t.status == "completed" {
            if let Some(insights) = &t.insights {
                // Totals stay immutable; enrichment must neither double count
                // a session nor erase metadata imported with a backup.
                tx.execute("UPDATE metrics SET data=json_set(data,'$.insights',json_patch(COALESCE(json_extract(data,'$.insights'),'{}'),json(?1))) WHERE transcript_id=?2", params![serde_json::to_string(insights).map_err(err)?,t.id]).map_err(err)?;
            } else if let Some(output) = t.enhanced_text.as_deref().filter(|text| t.manual_correction.is_none() && !text.trim().is_empty()) {
                if let Some(count) = crate::insight_stats::corrected_words(&t.text, output) {
                    tx.execute("UPDATE metrics SET data=json_set(data,'$.insights.wordsCorrected',?1) WHERE transcript_id=?2", params![count,t.id]).map_err(err)?;
                }
            }
        }
        {
            // Statistics must never interrupt the user's dictation.
            let _=crate::telemetry::record(&tx,t);
        }
        tx.commit().map_err(err)?;
        self.prune_audio(&db)?;
        drop(db);
        crate::diagnostics::transcript_saved(t);
        Ok(())
    }
    pub fn statistics(&self, since: f64) -> Result<Statistics, String> {
        self.statistics_range(since, f64::INFINITY)
    }
    pub fn statistics_range(&self, since: f64, until: f64) -> Result<Statistics, String> {
        if !since.is_finite() || until.is_nan() || until <= since {
            return Err("Invalid statistics date range".into());
        }
        let mut s = Statistics::default();
        let mut daily: BTreeMap<String, DayStats> = BTreeMap::new();
        let mut models: BTreeMap<String, ModelStats> = BTreeMap::new();
        let mut applications: BTreeMap<String, ApplicationStats> = BTreeMap::new();
        let p = self.preferences()?;
        let mut metrics: Vec<Metric> = self
            .list::<Metric>("metrics")?
            .into_iter()
            .filter(|m| m.timestamp >= since && m.timestamp < until)
            .collect();
        // Weighted recent samples: long recordings remain in totals but do
        // not distort the short-dictation speed estimate.
        metrics.sort_by(|a, b| b.timestamp.total_cmp(&a.timestamp));
        for m in metrics {
            s.words += m.words;
            let seconds = if m.duration.is_finite() { m.duration.max(0.) } else { 0. };
            s.duration += seconds;
            s.sessions += 1;
            if let Some(insights) = &m.insights {
                if let Some(count) = insights.words_corrected { s.words_corrected += count; s.correction_samples += 1; }
                if let Some(count) = insights.dictionary_fixes { s.dictionary_fixes += count; s.dictionary_samples += 1; }
                if let Some(id) = insights.application.as_ref().filter(|id| !id.is_empty()) {
                    let app = applications.entry(id.clone()).or_insert_with(|| ApplicationStats { id: id.clone(), ..Default::default() });
                    app.sessions += 1; app.words += m.words;
                }
            }
            if s.speed_samples < 100 && m.words > 0 && seconds > 0. && seconds < 400. {
                s.speed_words += m.words;
                s.speed_seconds += seconds;
                s.speed_samples += 1;
            }

            let date = chrono::DateTime::from_timestamp(m.timestamp as i64, 0)
                .map(|d| {
                    d.with_timezone(&chrono::Local)
                        .format("%Y-%m-%d")
                        .to_string()
                })
                .unwrap_or_default();
            let day = daily.entry(date.clone()).or_insert_with(|| DayStats {
                date,
                ..Default::default()
            });
            day.words += m.words;
            day.seconds += seconds;
            day.sessions += 1;
            let model = models.entry(m.model.clone()).or_insert_with(|| ModelStats {
                name: m.model.clone(),
                ..Default::default()
            });
            model.words += m.words;
            model.seconds += seconds;
            model.sessions += 1;
        }
        s.saved_seconds = (s.words as f64 / p.typing_wpm * 60. - s.duration).max(0.);
        s.daily = daily.into_values().collect();
        s.models = models.into_values().collect();
        s.applications = applications.into_values().collect();
        Ok(s)
    }
    pub fn backup(&self) -> Result<Backup, String> {
        let db = self.db.lock().map_err(err)?;
        let mut q = db
            .prepare("SELECT data FROM transcripts ORDER BY timestamp DESC")
            .map_err(err)?;
        let transcripts = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect::<Result<Vec<_>, String>>()?;
        drop(q);
        drop(db);
        Ok(Backup {
            format: "no-tipe-desktop".into(),
            version: 1,
            preferences: self.preferences()?,
            transcripts,
            metrics: self.list("metrics")?,
            modes: self.list("modes")?,
            empowerments: self.list("empowerments")?,
            dictionary: self.list("dictionary")?,
            snippets: self.list("snippets")?,
            models: self.list("models")?,
        })
    }
    pub fn import_backup(&self, b: Backup) -> Result<usize, String> {
        self.import_backup_with(b, |_| Ok(()))
    }
    pub fn import_backup_with(&self, b: Backup, apply: impl FnOnce(&Preferences) -> Result<(), String>) -> Result<usize, String> {
        self.import_backup_with_commit(b, |_, next| apply(next), |_| {})
    }
    pub fn import_backup_with_commit<T>(&self, mut b: Backup, apply: impl FnOnce(&Preferences, &Preferences) -> Result<T, String>, commit: impl FnOnce(T)) -> Result<usize, String> {
        // New exports use the product name; previously exported backups remain valid.
        if !["no-tipe-desktop", crate::legacy::BACKUP_FORMAT].contains(&b.format.as_str()) || b.version != 1 {
            return Err("Unsupported backup version".into());
        }
        b.preferences.shortcut = crate::shortcuts::portable_shortcut(&b.preferences.shortcut, std::env::consts::OS);
        b.preferences.validate()?;
        let mut db = self.db.lock().map_err(err)?;
        let value: Option<String> = db.query_row("SELECT value FROM metadata WHERE key='preferences'", [], |r| r.get(0)).optional().map_err(err)?;
        let previous:Preferences = value.map(|v| serde_json::from_str(&v).map_err(err)).transpose()?.unwrap_or_default();
        // Consent belongs to this device and cannot be granted by a backup.
        b.preferences.usage_analytics=previous.usage_analytics;
        b.preferences.usage_analytics_version=previous.usage_analytics_version;
        let tx = db.transaction().map_err(err)?;
        let mut count = 0;
        for mut t in b.transcripts {
            t.recover_interrupted();
            if t.is_no_speech() { continue; }
            count += tx.execute("INSERT OR IGNORE INTO transcripts(id,timestamp,status,text,data) VALUES(?1,?2,?3,?4,?5)", params![t.id,t.timestamp,t.status,t.text,serde_json::to_string(&t).map_err(err)?]).map_err(err)?;
        }
        for m in b.metrics {
            tx.execute("INSERT OR IGNORE INTO metrics(id,transcript_id,timestamp,data) VALUES(?1,?2,?3,?4)", params![m.id,m.transcript_id,m.timestamp,serde_json::to_string(&m).map_err(err)?]).map_err(err)?;
        }
        for m in b.modes {
            tx.execute(
                "INSERT OR IGNORE INTO modes(id,data) VALUES(?1,?2)",
                params![m.id, serde_json::to_string(&m).map_err(err)?],
            )
            .map_err(err)?;
        }
        for item in b.empowerments {
            let item = item.normalized()?;
            tx.execute("INSERT OR IGNORE INTO empowerments(id,data) VALUES(?1,?2)", params![item.id, serde_json::to_string(&item).map_err(err)?]).map_err(err)?;
        }
        for d in b.dictionary {
            tx.execute(
                "INSERT OR IGNORE INTO dictionary(id,data) VALUES(?1,?2)",
                params![d.id, serde_json::to_string(&d).map_err(err)?],
            )
            .map_err(err)?;
        }
        for m in b.models {
            validate_endpoint_or_local(&m)?;
            tx.execute(
                "INSERT OR IGNORE INTO models(id,data) VALUES(?1,?2)",
                params![m.id, serde_json::to_string(&m).map_err(err)?],
            )
            .map_err(err)?;
        }
        for snippet in b.snippets {
            crate::snippets::validate(&snippet)?;
            tx.execute("INSERT OR IGNORE INTO snippets(id,data) VALUES(?1,?2)", params![snippet.id, serde_json::to_string(&snippet).map_err(err)?]).map_err(err)?;
        }
        tx.execute("INSERT INTO metadata(key,value) VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&b.preferences).map_err(err)?]).map_err(err)?;
        // Validate all imported rows before touching OS settings. A conflict
        // rolls back both the library and preferences instead of importing a
        // shortcut that the OS cannot register.
        let effects = apply(&previous, &b.preferences)?;
        tx.commit().map_err(err)?;
        commit(effects);
        self.prune_audio(&db)?;
        Ok(count)
    }
    pub fn save_snippet(&self, mut snippet: crate::snippets::Snippet) -> Result<(), String> {
        snippet.trigger = snippet.trigger.trim().to_owned();
        crate::snippets::validate(&snippet)?;
        let db = self.db.lock().map_err(err)?;
        let snippets = read_items::<crate::snippets::Snippet>(&db, "snippets")?;
        let dictionary = read_items::<DictionaryEntry>(&db, "dictionary")?;
        if crate::snippets::conflict(&snippet, &snippets, &dictionary) {
            return Err("This phrase already exists in your snippets or dictionary. Choose a different phrase.".into());
        }
        db.execute("INSERT INTO snippets(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![snippet.id, serde_json::to_string(&snippet).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub fn import_snippets(&self, items: Vec<crate::snippets::Snippet>) -> Result<usize, String> {
        if items.len() > 1000 { return Err("Import up to 1,000 snippets at a time.".into()); }
        let mut db = self.db.lock().map_err(err)?;
        let tx = db.transaction().map_err(err)?;
        let mut snippets = read_items::<crate::snippets::Snippet>(&tx, "snippets")?;
        let dictionary = read_items::<DictionaryEntry>(&tx, "dictionary")?;
        let mut added = 0;
        for mut snippet in items {
            snippet.trigger = snippet.trigger.trim().to_owned();
            crate::snippets::validate(&snippet)?;
            if snippets.iter().any(|s| s.id == snippet.id) || crate::snippets::conflict(&snippet, &snippets, &dictionary) { continue; }
            tx.execute("INSERT INTO snippets(id,data) VALUES(?1,?2)", params![snippet.id, serde_json::to_string(&snippet).map_err(err)?]).map_err(err)?;
            snippets.push(snippet); added += 1;
        }
        tx.commit().map_err(err)?;
        Ok(added)
    }
    pub fn cleanup(&self) -> Result<(), String> {
        let p = self.preferences()?;
        let now = chrono::Utc::now().timestamp() as f64;
        if p.transcript_retention_days > 0 {
            let db = self.db.lock().map_err(err)?;
            let mut q = db.prepare("DELETE FROM transcripts WHERE timestamp < ?1 AND status!='pending' AND COALESCE(json_extract(data,'$.processingState'),'idle')!='processing' RETURNING json_extract(data,'$.audioFile')").map_err(err)?;
            let paths = q.query_map([now - p.transcript_retention_days as f64 * 86400.], |r| r.get::<_, Option<String>>(0)).map_err(err)?
                .collect::<Result<Vec<_>, _>>().map_err(err)?;
            for path in paths.into_iter().flatten() { self.remove_managed_audio(Path::new(&path))?; }
        }
        purge_voice_cache(&*self.db.lock().map_err(err)?)?;
        self.prune_audio(&*self.db.lock().map_err(err)?)?;
        Ok(())
    }
}
fn read_items<T: DeserializeOwned>(db: &Connection, table: &str) -> Result<Vec<T>, String> {
    let mut query = db.prepare(&format!("SELECT data FROM {table}")).map_err(err)?;
    let rows = query.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err)).collect()
}
pub fn validate_endpoint_or_local(m: &Model) -> Result<(), String> {
    if m.local {
        Ok(())
    } else {
        validate_endpoint(&m.endpoint)
    }
}
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn purge_voice_cache(db: &Connection) -> Result<(), String> {
    db.execute("DELETE FROM metadata WHERE key='voiceProfile.v1' AND EXISTS(SELECT 1 FROM json_each(metadata.value,'$.sourceIds') source WHERE NOT EXISTS(SELECT 1 FROM transcripts t WHERE t.id=source.value AND t.status='completed'))", []).map_err(err)?;
    Ok(())
}
