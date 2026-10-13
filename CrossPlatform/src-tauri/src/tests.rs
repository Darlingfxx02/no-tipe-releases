use crate::{audio, domain::*, store::Store};
use crate::snippets::{Snippet, TextStyle};

#[test]
fn hover_hiding_defaults_off_and_survives_restart_and_backup() {
    let source = store();
    source.set_meta("preferences", &serde_json::json!({"recorderStyle":"pixel"})).unwrap();
    assert!(!source.preferences().unwrap().hide_recorder_on_hover);
    source.update_preferences(|p| {
        *p = p.patched(&serde_json::json!({"hideRecorderOnHover":true}))?;
        Ok(())
    }).unwrap();
    let reopened = Store::open(&source.root).unwrap();
    assert!(reopened.preferences().unwrap().hide_recorder_on_hover);
    let state = crate::engine::AppState::new(Store::open(&source.root).unwrap()).unwrap();
    assert!(state.hide_recorder_on_hover.load(std::sync::atomic::Ordering::Relaxed));
    let restored = store();
    restored.import_backup(reopened.backup().unwrap()).unwrap();
    assert!(restored.preferences().unwrap().hide_recorder_on_hover);
    assert!(Preferences::default().patched(&serde_json::json!({"hideRecorderOnHover":"yes"})).is_err());
}

#[test]
fn hover_hiding_only_applies_while_idle_and_resumes_after_a_session() {
    let state = crate::engine::AppState::new(store()).unwrap();
    assert!(!state.hover_hiding_enabled());
    state.hide_recorder_on_hover.store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(state.hover_hiding_enabled());
    for (phase, paused) in [("preparing", false), ("recording", false), ("recording", true),
        ("busy", false), ("result", false), ("copied", false), ("failed", false)] {
        {
            let mut runtime = state.runtime.lock().unwrap();
            runtime.snapshot.state = phase.into();
            runtime.snapshot.paused = paused;
        }
        assert!(!state.hover_hiding_enabled(), "{phase}, paused={paused} must keep native controls available");
    }
    state.runtime.lock().unwrap().snapshot.state = "idle".into();
    assert!(state.hover_hiding_enabled());
    state.hide_recorder_on_hover.store(false, std::sync::atomic::Ordering::Relaxed);
    assert!(!state.hover_hiding_enabled());
}

#[test]
fn sidebar_preferences_migrate_and_survive_backup_restore() {
    let old: Preferences = serde_json::from_value(serde_json::json!({"uiLanguage":"ru"})).unwrap();
    assert!(old.sidebar_order.is_empty() && old.sidebar_hidden.is_empty());
    let changed = old.patched(&serde_json::json!({"sidebarOrder":["Customization","Dashboard"],"sidebarHidden":["Insights"]})).unwrap();
    let source = store();
    source.set_preferences(&changed).unwrap();
    let target = store();
    target.import_backup(source.backup().unwrap()).unwrap();
    let restored = target.preferences().unwrap();
    assert_eq!(restored.sidebar_order, changed.sidebar_order);
    assert_eq!(restored.sidebar_hidden, changed.sidebar_hidden);
    assert_eq!(restored.ui_language, "ru");
    for invalid in [serde_json::json!({"sidebarHidden":["Settings"]}),serde_json::json!({"sidebarOrder":["Dashboard","Dashboard"]})] {
        assert!(old.patched(&invalid).is_err());
    }
}

#[test]
fn retired_palettes_migrate_in_saved_preferences_backups_and_patches() {
    let replacements = [("indigo", "prism"), ("blue", "lagoon"), ("cyan", "aurora"),
        ("purple", "sakura"), ("rose", "ember"), ("amber", "dune"), ("siri", "siri"), ("sber", "sber")];
    let source = store();
    for (old, new) in replacements {
        source.set_meta("preferences", &serde_json::json!({"palette":old,"lightIntensity":0.61,"waveBrightness":0.82,"enhance":true})).unwrap();
        let migrated = source.preferences().unwrap();
        assert_eq!(migrated.palette, new);
        assert_eq!(migrated.light_intensity, 0.61);
        assert_eq!(migrated.wave_brightness, 0.82);
        assert!(migrated.enhance);
        migrated.validate().unwrap();
        assert_eq!(Preferences::default().patched(&serde_json::json!({"palette":old})).unwrap().palette, new);
        source.set_preferences(&migrated).unwrap();
        assert_eq!(source.get_meta::<serde_json::Value>("preferences").unwrap().unwrap()["palette"], new);
        let mut backup = source.backup().unwrap();
        backup.preferences.palette = old.into();
        let recovered = serde_json::from_value(serde_json::to_value(backup).unwrap()).unwrap();
        let target = store();
        target.import_backup(recovered).unwrap();
        assert_eq!(target.preferences().unwrap().palette, new);
    }
    assert!(Preferences::default().patched(&serde_json::json!({"palette":"missing"})).is_err());
}

fn snippet(trigger: &str, expansion: &str) -> Snippet {
    Snippet {id:uuid::Uuid::new_v4().to_string(),trigger:trigger.into(),expansion:expansion.into(),enabled:true,date_added:1.,formatting:vec![]}
}
#[test]
fn snippets_persist_reopen_update_delete_and_reject_conflicts() {
    let source = store();
    source.put("dictionary", "word", &DictionaryEntry {id:"word".into(),word:"No Type".into(),replacement:None,enabled:true}).unwrap();
    let mut s = snippet("my signature", "Alex\nDesigner");
    source.save_snippet(s.clone()).unwrap();
    source.save_transcript(&transcript()).unwrap();
    let reopened = Store::open(&source.root).unwrap();
    assert_eq!(reopened.list::<Snippet>("snippets").unwrap()[0].expansion, "Alex\nDesigner");
    assert_eq!(reopened.list::<DictionaryEntry>("dictionary").unwrap()[0].word, "No Type");
    assert_eq!(reopened.transcripts("",0,10).unwrap().len(), 1);
    assert!(reopened.save_snippet(snippet("MY SIGNATURE!", "Duplicate")).is_err());
    assert!(reopened.save_snippet(snippet("no type", "Dictionary conflict")).is_err());
    s.expansion = "Updated".into(); s.enabled = false;
    reopened.save_snippet(s.clone()).unwrap();
    assert!(!crate::snippets::prepare("my signature", &reopened.list("snippets").unwrap()).has_matches());
    reopened.delete("snippets", &s.id).unwrap();
    assert!(reopened.list::<Snippet>("snippets").unwrap().is_empty());
}
#[test]
fn snippets_backup_preserves_styles_and_old_backups_remain_compatible() {
    let source = store(); let mut s = snippet("my signature", "Alex");
    s.formatting = vec![TextStyle {start:0,end:4,bold:true,italic:false,link:None}]; s.enabled = false;
    source.save_snippet(s.clone()).unwrap();
    let backup = source.backup().unwrap(); let mut old = serde_json::to_value(&backup).unwrap();
    old.as_object_mut().unwrap().remove("snippets");
    let old: Backup = serde_json::from_value(old).unwrap(); assert!(old.snippets.is_empty());
    let target = store(); target.import_backup(backup).unwrap();
    let restored = target.list::<Snippet>("snippets").unwrap();
    assert_eq!(restored[0].expansion, "Alex"); assert!(restored[0].formatting[0].bold); assert!(!restored[0].enabled);
}
#[test]
fn snippet_import_is_atomic_and_rechecks_new_conflicts() {
    let source = store(); let s = snippet("my email", "a@example.com");
    assert_eq!(source.import_snippets(vec![s.clone(),snippet("MY EMAIL", "duplicate")]).unwrap(), 1);
    assert_eq!(source.import_snippets(vec![s]).unwrap(), 0);
    assert!(source.import_snippets(vec![snippet("new phrase", "Valid"),snippet("!!!", "Invalid")]).is_err());
    assert_eq!(source.list::<Snippet>("snippets").unwrap().len(), 1);
}
#[test]
fn existing_preferences_keep_idle_cloud_until_user_turns_it_off() {
    let p: Preferences = serde_json::from_str(r#"{"palette":"cyan"}"#).unwrap();
    assert!(p.always_show_cloud);
    assert_eq!(p.palette, "aurora");
    let p: Preferences = serde_json::from_str(r#"{"alwaysShowCloud":false}"#).unwrap();
    assert!(!p.always_show_cloud);
}
#[test]
fn backup_shortcut_conflicts_roll_back_the_library_and_preferences() {
    let source = store();
    source.save_transcript(&transcript()).unwrap();
    let mut backup = source.backup().unwrap();
    backup.preferences.shortcut = "Control+Alt+D".into();
    backup.preferences.palette = "sber".into();
    let target = store();
    let previous = target.preferences().unwrap();
    let error = target.import_backup_with(backup, |p| {
        assert_eq!(p.shortcut, "Control+Alt+D");
        Err("Shortcut is already registered".into())
    }).unwrap_err();
    assert!(error.contains("already registered"));
    assert!(target.transcripts("", 0, 10).unwrap().is_empty());
    assert_eq!(target.preferences().unwrap().shortcut, previous.shortcut);
    assert_eq!(target.preferences().unwrap().palette, previous.palette);

    let mut accepted = source.backup().unwrap();
    accepted.preferences.shortcut = "Control+Alt+D".into();
    let mut applied = false;
    assert_eq!(target.import_backup_with(accepted, |p| {
        assert_eq!(p.shortcut, "Control+Alt+D");
        applied = true;
        Ok(())
    }).unwrap(), 1);
    assert!(applied);
    let reopened = Store::open(&target.root).unwrap();
    assert_eq!(reopened.preferences().unwrap().shortcut, "Control+Alt+D");
    assert_eq!(reopened.transcripts("", 0, 10).unwrap().len(), 1);
}
#[test]
fn invalid_backup_rows_never_change_os_settings() {
    let source = store();
    source.save_transcript(&transcript()).unwrap();
    let mut backup = source.backup().unwrap();
    backup.snippets.push(snippet("!!!", "Invalid"));
    let target = store();
    assert!(target.import_backup_with(backup, |_| panic!("OS settings must not be changed")).is_err());
    assert!(target.transcripts("", 0, 10).unwrap().is_empty());
}
#[cfg(target_os = "windows")]
#[test]
fn windows_imports_and_old_preferences_replace_mac_only_shortcuts() {
    let source = store();
    let mut backup = source.backup().unwrap();
    backup.preferences.shortcut = "AltRight".into();
    backup.preferences.shortcut_mode = "pushToTalk".into();
    backup.preferences.palette = "sber".into();
    let target = store();
    target.import_backup_with(backup, |p| {
        assert_eq!(p.shortcut, "Control+Alt+D");
        Ok(())
    }).unwrap();
    assert_eq!(target.preferences().unwrap().shortcut_mode, "pushToTalk");
    assert_eq!(target.preferences().unwrap().palette, "sber");
    target.set_meta("preferences", &serde_json::json!({"shortcut":"Fn","palette":"sber"})).unwrap();
    let reopened = Store::open(&target.root).unwrap();
    assert_eq!(reopened.preferences().unwrap().shortcut, "Control+Alt+D");
    assert_eq!(reopened.preferences().unwrap().palette, "sber");
}
#[test]
fn recorder_light_preferences_migrate_validate_and_roundtrip() {
    let old: Preferences = serde_json::from_str(r#"{"palette":"sber"}"#).unwrap();
    assert_eq!(old.light_intensity, 0.28);
    assert_eq!(old.wave_brightness, 0.35);
    assert_eq!(old.recorder_scale, 1.0);
    assert!(old.show_dictation_waves);
    let p = old.patched(&serde_json::json!({
        "lightIntensity": 0.0, "waveBrightness": 0.62, "recorderScale": 0.6, "showDictationWaves": false
    })).unwrap();
    let source = store();
    source.set_preferences(&p).unwrap();
    let restored = store();
    restored.import_backup(source.backup().unwrap()).unwrap();
    let saved = restored.preferences().unwrap();
    let snapshot = Snapshot::idle(&saved);
    assert_eq!(snapshot.light_intensity, 0.0);
    assert_eq!(snapshot.wave_brightness, 0.62);
    assert_eq!(snapshot.recorder_scale, 0.6);
    assert!(!snapshot.show_dictation_waves);
    assert_eq!(saved.palette, "sber");
    let maximum = p.patched(&serde_json::json!({"lightIntensity": 2.0, "waveBrightness": 4.0})).unwrap();
    source.set_preferences(&maximum).unwrap();
    restored.import_backup(source.backup().unwrap()).unwrap();
    assert_eq!(Snapshot::idle(&restored.preferences().unwrap()).light_intensity, 2.0);
    assert_eq!(Snapshot::idle(&restored.preferences().unwrap()).wave_brightness, 4.0);
    assert!(p.patched(&serde_json::json!({"lightIntensity": 2.01})).is_err());
    assert!(p.patched(&serde_json::json!({"waveBrightness": 4.01})).is_err());
    assert!(p.patched(&serde_json::json!({"waveBrightness": -0.01})).is_err());
    assert!(p.patched(&serde_json::json!({"waveBrightness": null})).is_err());
    for invalid in [serde_json::json!(0.59), serde_json::json!(1.01), serde_json::Value::Null] {
        assert!(p.patched(&serde_json::json!({"recorderScale": invalid})).is_err());
    }
    assert_eq!(p.patched(&serde_json::json!({"recorderScale": 1.0})).unwrap().recorder_scale, 1.0);
}
#[test]
fn recorder_styles_migrate_validate_and_survive_backup_restore() {
    let old: Preferences = serde_json::from_str(r#"{"palette":"sber"}"#).unwrap();
    assert_eq!(Preferences::default().recorder_style, "pixel");
    assert_eq!(old.recorder_style, "pixel");
    assert_eq!(old.pixel_emotion, "auto");
    assert_eq!(old.pixel_processing, "auto");
    let pixel = old.patched(&serde_json::json!({"recorderStyle":"pixel","pixelEmotion":"wink","pixelProcessing":"starship"})).unwrap();
    let source = store();
    source.set_preferences(&pixel).unwrap();
    let restored = store();
    restored.import_backup(source.backup().unwrap()).unwrap();
    let snapshot = Snapshot::idle(&restored.preferences().unwrap());
    assert_eq!(snapshot.recorder_style, "pixel");
    assert_eq!(snapshot.pixel_emotion, "wink");
    assert_eq!(snapshot.pixel_processing, "starship");
    assert_eq!(snapshot.palette, "sber");
    let liquid = pixel.patched(&serde_json::json!({"recorderStyle":"liquid"})).unwrap();
    source.set_preferences(&liquid).unwrap();
    restored.import_backup(source.backup().unwrap()).unwrap();
    assert_eq!(Snapshot::idle(&restored.preferences().unwrap()).recorder_style, "liquid");
    for invalid in [serde_json::json!("unknown"), serde_json::Value::Null] {
        assert!(pixel.patched(&serde_json::json!({"recorderStyle":invalid})).is_err());
        assert!(pixel.patched(&serde_json::json!({"pixelEmotion":invalid})).is_err());
        assert!(pixel.patched(&serde_json::json!({"pixelProcessing":invalid})).is_err());
    }
    for animation in ["auto", "pong", "starship", "snake", "breakout"] {
        assert_eq!(pixel.patched(&serde_json::json!({"pixelProcessing":animation})).unwrap().pixel_processing, animation);
    }
}
#[test]
fn dashboard_only_effect_survives_preferences_and_backup_restore() {
    let mut p: Preferences = serde_json::from_str(r#"{"palette":"sber","enhance":true}"#).unwrap();
    assert!(!p.dashboard_effect_only);
    p.dashboard_effect_only = true;
    let source = store();
    source.set_preferences(&p).unwrap();
    assert!(source.preferences().unwrap().dashboard_effect_only);
    let restored = store();
    restored.import_backup(source.backup().unwrap()).unwrap();
    let value = restored.preferences().unwrap();
    assert!(value.dashboard_effect_only);
    assert_eq!(value.palette, "sber");
    assert!(value.enhance);
    assert_eq!(value.always_show_cloud, p.always_show_cloud);
}
#[test]
fn media_pause_is_opt_in_and_survives_preferences_and_backup_restore() {
    let old: Preferences = serde_json::from_str(r#"{"palette":"siri"}"#).unwrap();
    assert!(!old.pause_media);
    let source = store();
    let mut p = old;
    p.pause_media = true;
    source.set_preferences(&p).unwrap();
    assert!(source.preferences().unwrap().pause_media);
    let restored = store();
    restored.import_backup(source.backup().unwrap()).unwrap();
    assert!(restored.preferences().unwrap().pause_media);
    assert_eq!(restored.preferences().unwrap().palette, "siri");
    p.pause_media = false;
    restored.set_preferences(&p).unwrap();
    assert!(!restored.preferences().unwrap().pause_media);
}
#[test]
fn rebranding_keeps_the_existing_library_and_imports_legacy_backups() {
    let source = store();
    source.save_transcript(&transcript()).unwrap();
    let mut preferences = source.preferences().unwrap();
    preferences.palette = "aurora".into();
    source.set_preferences(&preferences).unwrap();
    let root = source.root.clone();
    drop(source);

    assert!(root.join(crate::legacy::CURRENT_DATABASE).exists());
    std::fs::rename(root.join(crate::legacy::CURRENT_DATABASE), root.join(crate::legacy::DATABASE)).unwrap();
    let reopened = Store::open(&root).unwrap();
    assert_eq!(reopened.transcripts("", 0, 10).unwrap().len(), 1);
    assert_eq!(reopened.preferences().unwrap().palette, "aurora");
    let mut backup = reopened.backup().unwrap();
    assert_eq!(backup.format, "no-tipe-desktop");
    backup.format = crate::legacy::BACKUP_FORMAT.into();
    let restored = store();
    assert_eq!(restored.import_backup(backup).unwrap(), 1);
    assert_eq!(restored.preferences().unwrap().palette, "aurora");
    assert_eq!(restored.transcript("session-1").unwrap().text, transcript().text);
    let mut invalid = reopened.backup().unwrap();
    invalid.format = "another-product".into();
    assert!(restored.import_backup(invalid).is_err());
}

fn store() -> Store {
    Store::open(&std::env::temp_dir().join(format!("no-tipe-test-{}", uuid::Uuid::new_v4())))
        .unwrap()
}
fn transcript() -> Transcript {
    Transcript {
        id: "session-1".into(),
        text: "The original dictation remains intact".into(),
        enhanced_text: None,
        formatted_snippet: None,
        processing_source: None,
        manual_correction: None,
        session_config: None,
        recognition_error: None,
        delivery_error: None,
        processing_state: crate::domain::ProcessingState::Idle,
        processing_config: None,
        processing_error: Some("Processing unavailable".into()),
        timestamp: 1700000000.,
        duration: 3.,
        audio_file: None,
        model: Some("Whisper".into()),
        processing_model: None,
        mode: None,
        status: "completed".into(),
        transcription_duration: Some(0.2),
        enhancement_duration: None,
        insights: None,
    }
}
#[test]
fn no_speech_discards_the_pending_entry_and_managed_audio_without_counting_a_session() {
    for error in ["No speech detected", "No speech text was returned", " No Speech Detected ", "no-tipe-i18n:native.no_speech", "no-tipe-i18n:native.no_speech_text"] {
        let s = store();
        let mut t = transcript();
        t.text.clear(); t.status = "pending".into(); t.processing_error = None;
        let path = s.root.join("audio/silence.wav");
        std::fs::write(&path, b"silence").unwrap();
        t.audio_file = Some(path.to_string_lossy().into());
        s.save_transcript(&t).unwrap();
        t.status = "failed".into(); t.recognition_error = Some(error.into());
        s.save_transcript(&t).unwrap();
        assert!(s.transcripts("", 0, 50).unwrap().is_empty());
        assert!(s.transcript(&t.id).is_err());
        assert!(!path.exists());
        assert_eq!(s.statistics(0.).unwrap().sessions, 0);
    }
}
#[test]
fn old_and_imported_no_speech_entries_are_removed_but_text_and_other_failures_are_retained() {
    let s = store();
    let mut silent = transcript();
    silent.id = "silence".into(); silent.text = "\t\n".into(); silent.status = "failed".into();
    silent.processing_error = Some("No speech detected".into());
    let mut partial = silent.clone(); partial.id = "partial".into(); partial.text = "Saved partial text".into();
    let mut failed = silent.clone(); failed.id = "network".into(); failed.processing_error = Some("Provider timed out".into());
    // Simulate pre-update data, bypassing the new write policy.
    for t in [&silent, &partial, &failed] {
        s.db.lock().unwrap().execute("INSERT INTO transcripts(id,timestamp,status,text,data) VALUES(?1,?2,?3,?4,?5)", rusqlite::params![t.id,t.timestamp,t.status,t.text,serde_json::to_string(t).unwrap()]).unwrap();
    }
    let backup = s.backup().unwrap();
    let target = store();
    assert_eq!(target.import_backup(backup).unwrap(), 2);
    let root = s.root.clone(); drop(s);
    let reopened = Store::open(&root).unwrap();
    assert!(reopened.transcript("silence").is_err());
    assert_eq!(reopened.transcript("partial").unwrap().text, "Saved partial text");
    assert_eq!(reopened.transcript("network").unwrap().recognition_error.as_deref(), Some("Provider timed out"));
}
#[test]
fn recognition_retry_reserves_one_entry_and_counts_success_once() {
    let s = store();
    let mut t = transcript();
    t.status = "failed".into(); t.text.clear(); t.processing_error = None;
    let path = s.root.join("audio/recording.wav");
    std::fs::write(&path, b"retry audio").unwrap();
    t.recognition_error = Some("Provider timed out".into()); t.audio_file = Some(path.to_string_lossy().into());
    s.save_transcript(&t).unwrap();
    let mut pending = s.begin_transcript_recognition(&t.id).unwrap();
    assert_eq!(pending.status, "pending"); assert!(pending.recognition_error.is_none());
    assert!(s.begin_transcript_recognition(&t.id).is_err());
    assert!(s.delete("transcripts", &t.id).is_err());
    pending.status = "completed".into(); pending.text = "Recovered original dictation".into();
    s.save_transcript(&pending).unwrap(); s.save_transcript(&pending).unwrap();
    let entries = s.transcripts("", 0, 50).unwrap();
    assert_eq!(entries.len(), 1); assert_eq!(entries[0].id, t.id); assert_eq!(entries[0].timestamp, t.timestamp);
    assert_eq!(s.statistics(0.).unwrap().sessions, 1);
    assert!(entries[0].audio_file.is_none()); assert!(!path.exists());
    assert!(s.begin_transcript_recognition(&t.id).is_err());
    let mut no_audio = t.clone(); no_audio.id = "missing-audio".into(); no_audio.audio_file = None;
    s.save_transcript(&no_audio).unwrap(); assert!(s.begin_transcript_recognition(&no_audio.id).is_err());
}
#[test]
fn processing_failure_preserves_original_and_counts_once() {
    let s = store();
    let t = transcript();
    s.save_transcript(&t).unwrap();
    s.save_transcript(&t).unwrap();
    assert_eq!(s.transcript(&t.id).unwrap().delivered_text(), t.text);
    assert_eq!(s.statistics(0.).unwrap().sessions, 1);
    assert_eq!(s.statistics(0.).unwrap().words, 5);
    assert!(s.transcript(&t.id).unwrap().processing_error.is_some());
}
#[test]
fn backup_roundtrip_is_idempotent_and_metrics_survive_history_deletion() {
    let source = store();
    source.save_transcript(&transcript()).unwrap();
    let backup = source.backup().unwrap();
    let dest = store();
    assert_eq!(dest.import_backup(backup.clone()).unwrap(), 1);
    assert_eq!(dest.import_backup(backup).unwrap(), 0);
    assert_eq!(dest.statistics(0.).unwrap().sessions, 1);
    dest.delete("transcripts", "session-1").unwrap();
    assert!(dest.transcripts("", 0, 10).unwrap().is_empty());
    assert_eq!(dest.statistics(0.).unwrap().sessions, 1);
}
#[test]
fn failed_recognition_never_counts_as_productive_dictation() {
    let s = store();
    let mut t = transcript();
    t.status = "failed".into();
    t.text.clear();
    s.save_transcript(&t).unwrap();
    assert_eq!(s.statistics(0.).unwrap().sessions, 0);
}
#[test]
fn audio_keeps_only_the_ten_latest_empty_recognition_failures() {
    let s = store();
    for index in 0..12 {
        let mut t = transcript();
        t.id = format!("failed-{index}"); t.timestamp += index as f64;
        t.text.clear(); t.status = "failed".into(); t.processing_error = None;
        t.recognition_error = Some("Provider timed out".into());
        let path = s.root.join("audio").join(format!("{index}.wav"));
        std::fs::write(&path, b"retry audio").unwrap();
        t.audio_file = Some(path.to_string_lossy().into());
        s.save_transcript(&t).unwrap();
    }
    assert_eq!(s.transcripts("", 0, 50).unwrap().len(), 12);
    for index in 0..12 {
        let t = s.transcript(&format!("failed-{index}")).unwrap();
        assert_eq!(t.audio_file.is_some(), index >= 2);
        assert_eq!(s.root.join("audio").join(format!("{index}.wav")).exists(), index >= 2);
    }
    // Repeating an old request cannot displace a newer retained failure.
    let pending = s.begin_transcript_recognition("failed-2").unwrap();
    s.save_transcript(&pending).unwrap();
    let mut newer = s.transcript("failed-11").unwrap();
    newer.id = "newest".into(); newer.timestamp += 1.;
    let path = s.root.join("audio/newest.wav"); std::fs::write(&path, b"audio").unwrap();
    newer.audio_file = Some(path.to_string_lossy().into()); s.save_transcript(&newer).unwrap();
    s.cleanup().unwrap();
    assert!(s.root.join("audio/2.wav").exists(), "An active retry is protected");
    let mut failed_again = pending; failed_again.status = "failed".into();
    failed_again.recognition_error = Some("Provider timed out".into());
    s.save_transcript(&failed_again).unwrap();
    assert!(!s.root.join("audio/2.wav").exists());
    assert!(s.transcript("failed-2").unwrap().audio_file.is_none());
}
#[test]
fn partial_text_cancellation_and_processing_errors_do_not_retain_audio() {
    for (status, text) in [("failed", "Partial dictation"), ("canceled", ""), ("completed", "Original dictation")] {
        let s = store();
        let mut t = transcript(); t.status = status.into(); t.text = text.into();
        let path = s.root.join("audio/recording.wav"); std::fs::write(&path, b"audio").unwrap();
        t.audio_file = Some(path.to_string_lossy().into());
        s.save_transcript(&t).unwrap();
        assert!(!path.exists());
        let saved = s.transcript(&t.id).unwrap();
        assert!(saved.audio_file.is_none()); assert_eq!(saved.text, text);
    }
}
#[test]
fn startup_and_backup_import_apply_audio_policy_without_deleting_external_inputs() {
    let source = store();
    let external = source.root.join("input.wav"); std::fs::write(&external, b"original input").unwrap();
    let mut completed = transcript(); completed.audio_file = Some(external.to_string_lossy().into());
    source.save_transcript(&completed).unwrap(); assert!(external.exists());
    for index in 0..12 {
        let mut t = transcript(); t.id = format!("old-{index}"); t.timestamp += index as f64;
        t.text.clear(); t.status = "failed".into(); t.processing_error = None;
        t.recognition_error = Some("Provider timed out".into());
        let path = source.root.join("audio").join(format!("{index}.wav"));
        std::fs::write(&path, b"old audio").unwrap(); t.audio_file = Some(path.to_string_lossy().into());
        source.db.lock().unwrap().execute("INSERT INTO transcripts(id,timestamp,status,text,data) VALUES(?1,?2,?3,?4,?5)", rusqlite::params![t.id,t.timestamp,t.status,t.text,serde_json::to_string(&t).unwrap()]).unwrap();
    }
    let completed_path = source.root.join("audio/completed.wav"); std::fs::write(&completed_path, b"old successful audio").unwrap();
    completed.audio_file = Some(completed_path.to_string_lossy().into());
    source.db.lock().unwrap().execute("UPDATE transcripts SET data=?1 WHERE id=?2", rusqlite::params![serde_json::to_string(&completed).unwrap(),completed.id]).unwrap();
    let orphan = source.root.join("audio/orphan.wav"); std::fs::write(&orphan, b"orphan").unwrap();
    source.set_meta("preferences", &serde_json::json!({"audioRetentionDays":0})).unwrap();
    let backup = source.backup().unwrap();
    let destination = store(); destination.import_backup(backup).unwrap();
    assert_eq!(destination.transcripts("", 0, 50).unwrap().iter().filter(|t| t.audio_file.is_some()).count(), 10);
    assert!(destination.transcript(&completed.id).unwrap().audio_file.is_none());
    assert!(!serde_json::to_value(destination.preferences().unwrap()).unwrap().as_object().unwrap().contains_key("audioRetentionDays"));
    // A backup's audio paths belong to its source, not to the destination.
    assert!(completed_path.exists()); assert!(source.root.join("audio/0.wav").exists());
    let root = source.root.clone(); drop(source);
    let reopened = Store::open(&root).unwrap();
    assert_eq!(reopened.transcripts("", 0, 50).unwrap().iter().filter(|t| t.audio_file.is_some()).count(), 10);
    assert!(!completed_path.exists()); assert!(!orphan.exists()); assert!(external.exists());
    assert_eq!(reopened.transcript(&completed.id).unwrap().text, completed.text);
    reopened.delete("transcripts", "old-11").unwrap(); assert!(!root.join("audio/11.wav").exists());
    let mut p = reopened.preferences().unwrap(); p.transcript_retention_days = 1;
    reopened.set_preferences(&p).unwrap(); reopened.cleanup().unwrap();
    assert!(reopened.transcripts("", 0, 50).unwrap().is_empty());
    assert_eq!(std::fs::read_dir(root.join("audio")).unwrap().count(), 0);
}
#[test]
fn processing_options_are_independent_and_translation_detects_source() {
    let mut p = Preferences::default();
    assert!(processing_prompt(&p, None).is_none());
    p.enhance = true;
    p.shorten = true;
    p.translation = "russian".into();
    let prompt = processing_prompt(&p, None).unwrap();
    assert!(prompt.contains("grammar"));
    assert!(prompt.contains("concise"));
    assert!(prompt.contains("Detect the source language"));
    assert!(prompt.contains("Russian"));
    assert!(!prompt.contains("Keep the original language"));
}
#[test]
fn translation_survives_unrelated_settings_writes_and_the_next_session() {
    let s = store();
    s.update_preferences(|p| { p.translation = "english".into(); Ok(()) }).unwrap();
    s.update_preferences(|p| { *p = p.patched(&serde_json::json!({"palette":"cyan"}))?; Ok(()) }).unwrap();
    let reopened = Store::open(&s.root).unwrap();
    let preferences = reopened.preferences().unwrap();
    for _ in 0..2 {
        let mut session = Snapshot::idle(&preferences);
        session.state = "recording".into();
        assert_eq!(session.translation, "english");
        assert!(processing_prompt(&preferences, None).unwrap().contains("English"));
    }
    assert_eq!(preferences.palette, "aurora");
    s.update_preferences(|p| { p.translation = "off".into(); Ok(()) }).unwrap();
    assert_eq!(Snapshot::idle(&s.preferences().unwrap()).translation, "off");
    assert!(s.update_preferences(|p| { *p=p.patched(&serde_json::json!({"translation":"invalid"}))?; Ok(()) }).is_err());
    assert_eq!(s.preferences().unwrap().translation, "off");
}
#[test]
fn translation_only_does_not_apply_mode_editing_instructions() {
    let mut mode = Mode::default();
    mode.output = "respond".into();
    mode.translation = "off".into();
    mode.prompt = "Custom instructions".into();
    let mut p = Preferences::default();
    p.translation = "russian".into();
    let prompt = processing_prompt(&p, Some(&mode)).unwrap();
    assert!(prompt.contains("Russian"));
    assert!(!prompt.contains("Custom instructions"));
    assert!(!prompt.contains("Improve grammar"));
    assert!(!prompt.contains("Make the text concise"));
}
#[test]
fn unsafe_endpoints_and_invalid_preferences_are_rejected() {
    assert!(validate_endpoint("http://example.com/v1").is_err());
    assert!(validate_endpoint("https://key:secret@example.com").is_err());
    assert!(validate_endpoint("http://127.0.0.1:11434/v1").is_ok());
    let mut p = Preferences::default();
    p.hidden_style = "invalid".into();
    assert!(p.validate().is_err());
}
#[test]
fn shrinking_to_idle_clears_transcript_completion_and_error() {
    let p = Preferences::default();
    let s = Snapshot::idle(&p);
    assert_eq!(s.state, "idle");
    assert!(s.error.is_none());
    assert!(s.transcript.is_empty());
    assert!(!s.paused);
}
#[test]
fn resampling_preserves_duration_and_speech_band_energy() {
    let input: Vec<f32> = (0..48000)
        .map(|i| (std::f32::consts::TAU * 440. * i as f32 / 48000.).sin() * 0.2)
        .collect();
    let output = audio::resample(&input, 48000, 16000).unwrap();
    assert_eq!(output.len(), 16000);
    let rms = (output.iter().map(|x| x * x).sum::<f32>() / output.len() as f32).sqrt();
    assert!((rms - 0.1414).abs() < 0.01);
}
#[test]
fn literal_search_does_not_treat_percent_as_wildcard() {
    let s = store();
    s.save_transcript(&transcript()).unwrap();
    assert!(s.transcripts("%", 0, 20).unwrap().is_empty());
    assert_eq!(s.transcripts("original", 0, 20).unwrap().len(), 1);
}
#[test]
fn transcript_history_limits_after_filtering_and_preserves_older_text() {
    let s = store();
    for index in 0..17 {
        let mut t = transcript(); t.id = format!("saved-{index:02}"); t.timestamp += index as f64;
        s.save_transcript(&t).unwrap();
    }
    for index in 0..30 {
        let mut t = transcript(); t.id = format!("hidden-{index}"); t.timestamp += 100. + index as f64;
        if index % 2 == 0 { t.status = "canceled".into(); } else { t.text = " \n\t ".into(); }
        s.save_transcript(&t).unwrap();
    }
    let recent = s.transcript_history("", None, 10).unwrap();
    assert_eq!(recent.len(), 10);
    assert_eq!(recent[0].id, "saved-16"); assert_eq!(recent[9].id, "saved-07");
    assert_eq!(s.transcript_history("", None, 50).unwrap().len(), 17);
    assert_eq!(s.backup().unwrap().transcripts.len(), 47, "The compact list never deletes stored transcripts");
}
#[test]
fn transcript_history_cursor_handles_equal_timestamps_insertions_and_deletions() {
    let s = store();
    for index in 0..112 {
        let mut t = transcript(); t.id = format!("entry-{index:03}");
        s.save_transcript(&t).unwrap();
    }
    let first = s.transcript_history("", None, 50).unwrap();
    assert_eq!(first[0].id, "entry-111"); assert_eq!(first[49].id, "entry-062");
    let cursor = crate::store::TranscriptCursor { timestamp:first[49].timestamp, id:first[49].id.clone() };
    s.delete("transcripts", "entry-110").unwrap();
    let mut newest = transcript(); newest.id = "newest".into(); newest.timestamp += 1.; s.save_transcript(&newest).unwrap();
    let second = s.transcript_history("", Some(&cursor), 50).unwrap();
    assert_eq!(second[0].id, "entry-061"); assert_eq!(second[49].id, "entry-012");
    let cursor = crate::store::TranscriptCursor { timestamp:second[49].timestamp, id:second[49].id.clone() };
    let last = s.transcript_history("", Some(&cursor), 50).unwrap();
    assert_eq!(last.len(), 12); assert_eq!(last[11].id, "entry-000");
}
#[test]
fn transcript_history_search_matches_saved_results_and_literal_symbols() {
    let s = store(); let mut t = transcript();
    t.enhanced_text = Some("A saved 50%_result".into()); s.save_transcript(&t).unwrap();
    assert_eq!(s.transcript_history("original", None, 50).unwrap().len(), 1);
    assert_eq!(s.transcript_history("50%_", None, 50).unwrap().len(), 1);
    assert!(s.transcript_history("50%_other", None, 50).unwrap().is_empty());
}
#[test]
fn rejected_import_is_atomic() {
    let source = store();
    source.save_transcript(&transcript()).unwrap();
    let mut backup = source.backup().unwrap();
    backup.preferences.translation = "invalid".into();
    let dest = store();
    assert!(dest.import_backup(backup).is_err());
    assert!(dest.transcripts("", 0, 10).unwrap().is_empty());
}

#[test]
fn disabled_recorder_processing_bypasses_saved_mode_instructions() {
    let p = Preferences::default();
    let mut mode = Mode::default();
    mode.enhance = true;
    mode.shorten = true;
    mode.translation = "russian".into();
    mode.prompt = "Legacy mode instructions".into();
    for output in ["paste", "clipboard", "respond", "customCommand"] {
        mode.output = output.into();
        assert!(processing_prompt(&p, Some(&mode)).is_none(), "{output}");
    }
    assert_eq!(mode.prompt, "Legacy mode instructions");
}

#[test]
fn recorder_editing_switches_enable_mode_instructions_independently() {
    let mode = Mode { prompt: "Custom editing instructions".into(), ..Default::default() };
    for (enhance, shorten) in [(true, false), (false, true), (true, true)] {
        let p = Preferences { enhance, shorten, ..Default::default() };
        let prompt = processing_prompt(&p, Some(&mode)).unwrap();
        assert!(prompt.contains("Custom editing instructions"));
        assert_eq!(prompt.contains("Improve grammar"), enhance);
        assert_eq!(prompt.contains("Make the text concise"), shorten);
    }
}

#[test]
fn edited_mode_provider_overrides_legacy_and_can_return_to_default() {
    let p = Preferences::default();
    let mut mode = Mode::default();
    mode.legacy = Some(serde_json::json!({"selectedAIProvider":"OpenAI","selectedAIModel":"old"}));
    mode.processing_provider = Some("ollama".into());
    mode.processing_model = Some("local-model".into());
    assert_eq!(processing_preferences(&p, Some(&mode)).processing_endpoint, "http://127.0.0.1:11434/v1");
    assert_eq!(processing_preferences(&p, Some(&mode)).processing_model, "local-model");
    mode.processing_provider = Some("default".into());
    assert_eq!(processing_preferences(&p, Some(&mode)).processing_model, p.processing_model);
    let restored: Mode = serde_json::from_value(serde_json::to_value(mode).unwrap()).unwrap();
    assert_eq!(restored.processing_provider.as_deref(), Some("default"));
}

#[test]
fn gigaam_requires_complete_model_and_reuses_existing_download() {
    let s = store();
    let legacy = s.root.join("existing-gigaam");
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(legacy.join("tokens.json"), "[]").unwrap();
    assert!(!crate::gigaam::installed(&legacy));
    for asset in crate::gigaam::assets() {
        let path = legacy.join(asset.path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::File::create(path).unwrap().set_len(asset.size).unwrap();
    }
    assert!(crate::gigaam::installed(&legacy));
    assert_eq!(crate::gigaam::model_path(&s.root, Some(legacy.clone())), legacy);
    std::fs::remove_file(legacy.join("GigaAMv3Encoder.mlpackage/Manifest.json")).unwrap();
    assert!(!crate::gigaam::installed(&legacy));
    assert_eq!(crate::gigaam::model_path(&s.root, Some(legacy)), s.root.join("models").join(crate::gigaam::ID));
    let root = s.root.clone();
    drop(s); // Windows keeps the SQLite files locked until the store closes.
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn mode_provider_is_identical_for_initial_processing_and_retry() {
    let p = Preferences::default();
    let mut mode = Mode::default();
    mode.legacy =
        Some(serde_json::json!({"selectedAIProvider":"Ollama","selectedAIModel":"local-model"}));
    let configured = processing_preferences(&p, Some(&mode));
    assert_eq!(configured.processing_provider, "ollama");
    assert_eq!(configured.processing_model, "local-model");
    assert_eq!(configured.processing_endpoint, "http://127.0.0.1:11434/v1");
}

#[test]
fn time_saved_uses_total_time_including_slow_sessions() {
    let s = store();
    let mut slow = transcript();
    slow.duration = 60.;
    s.save_transcript(&slow).unwrap();
    let mut fast = transcript();
    fast.id = "second".into();
    fast.duration = 1.;
    s.save_transcript(&fast).unwrap();
    assert_eq!(s.statistics(0.).unwrap().saved_seconds, 0.);
}

#[test]
fn insights_ranges_are_half_open_and_metrics_survive_history_deletion() {
    let s = store();
    for (id, time) in [("before", 99.), ("start", 100.), ("inside", 199.), ("end", 200.)] {
        let mut t = transcript();
        t.id = id.into(); t.timestamp = time;
        s.save_transcript(&t).unwrap();
    }
    s.delete("transcripts", "inside").unwrap();
    let stats = s.statistics_range(100., 200.).unwrap();
    assert_eq!(stats.sessions, 2);
    assert_eq!(stats.words, 10);
    assert_eq!(stats.speed_samples, 2);
    assert!(s.statistics_range(200., 100.).is_err());
    assert!(s.statistics_range(f64::NAN, 200.).is_err());
}

#[test]
fn insights_speed_uses_latest_100_qualifying_samples_with_weighted_duration() {
    let s = store();
    // Insertion order is the reverse of recency. Older slow samples and
    // zero/long durations must not displace the latest qualifying samples.
    for index in (0..105).rev() {
        let mut t = transcript();
        t.id = format!("speed-{index}"); t.timestamp = 1_700_000_000. + index as f64;
        t.duration = if index < 5 { 300. } else { 3. };
        s.save_transcript(&t).unwrap();
    }
    for (id, duration) in [("missing-time", 0.), ("long-recording", 400.)] {
        let mut t = transcript(); t.id = id.into(); t.timestamp = 1_800_000_000.; t.duration = duration;
        s.save_transcript(&t).unwrap();
    }
    let stats = s.statistics(0.).unwrap();
    assert_eq!(stats.sessions, 107);
    assert_eq!(stats.speed_samples, 100);
    assert_eq!(stats.speed_words, 500);
    assert_eq!(stats.speed_seconds, 300.);
    assert_eq!(stats.duration, 2200.);
}

#[test]
fn notch_is_opt_in_and_roundtrips_without_changing_dictation_preferences() {
    let mut p: Preferences = serde_json::from_str(r#"{"palette":"siri","enhance":true,"translation":"russian"}"#).unwrap();
    assert_eq!(p.recorder_placement, "island");
    p.recorder_placement = "notch".into();
    assert!(p.validate().is_ok());
    let source = store(); source.set_preferences(&p).unwrap();
    let destination = store(); destination.import_backup(source.backup().unwrap()).unwrap();
    let restored = destination.preferences().unwrap();
    assert_eq!(restored.recorder_placement, "notch");
    assert_eq!(restored.palette, "siri");
    assert_eq!(restored.translation, "russian");
    assert!(restored.enhance);
    p.recorder_placement = "unknown".into();
    assert!(p.validate().is_err());
}

#[test]
fn supported_translation_targets_validate_and_keep_formatting_independent() {
    for (code, language) in [("english", "English"), ("russian", "Russian"), ("de", "German"), ("fr", "French"), ("es", "Spanish"), ("it", "Italian"), ("pt", "Portuguese"), ("zh", "Chinese"), ("ja", "Japanese"), ("ko", "Korean"), ("uk", "Ukrainian")] {
        let p = Preferences { translation: code.into(), enhance: false, shorten: false, ..Default::default() };
        p.validate().unwrap();
        let prompt = processing_prompt(&p, None).unwrap();
        assert!(prompt.contains(&format!("translate into natural {language}")));
        assert!(!prompt.contains("Improve grammar"));
        assert!(!prompt.contains("Make the text concise"));
        assert!(!prompt.contains("Keep the original language"));
    }
    assert!(Preferences { translation: "unknown".into(), ..Default::default() }.validate().is_err());
}

#[test]
fn insight_enrichment_survives_deletion_backup_and_resaving_without_double_counting() {
    let s = store(); let mut t = transcript();
    t.insights = Some(SessionInsights { source: None, application: Some("com.apple.mail".into()), words_corrected: Some(0), dictionary_fixes: Some(2) });
    s.save_transcript(&t).unwrap();
    t.insights.as_mut().unwrap().words_corrected = Some(3);
    t.enhanced_text = Some("edited words".into());
    s.save_transcript(&t).unwrap(); s.save_transcript(&t).unwrap();
    let mut old = transcript(); old.id = "old-untracked".into(); s.save_transcript(&old).unwrap();
    s.delete("transcripts", &t.id).unwrap();
    let stats = s.statistics(0.).unwrap();
    assert_eq!(stats.sessions, 2); assert_eq!(stats.words, 10);
    assert_eq!(stats.words_corrected, 3); assert_eq!(stats.dictionary_fixes, 2);
    assert_eq!(stats.correction_samples, 1); assert_eq!(stats.dictionary_samples, 1);
    assert_eq!(stats.applications[0].id, "com.apple.mail");
    assert_eq!(stats.applications[0].sessions, 1);
    let dest = store(); dest.import_backup(s.backup().unwrap()).unwrap();
    assert_eq!(dest.statistics(0.).unwrap().words_corrected, 3);
}

#[test]
fn historical_correction_recovery_preserves_unknown_application_and_dictionary_usage() {
    let s = store(); let mut t = transcript(); t.enhanced_text = Some("The original dictation stays intact".into());
    s.save_transcript(&t).unwrap();
    // Simulate a metric written by an earlier version with retained history.
    s.db.lock().unwrap().execute("UPDATE metrics SET data=json_remove(data,'$.insights')", []).unwrap();
    let root = s.root.clone(); drop(s);
    let reopened = Store::open(&root).unwrap();
    let stats = reopened.statistics(0.).unwrap();
    assert_eq!(stats.words_corrected, 1); assert_eq!(stats.correction_samples, 1);
    assert_eq!(stats.dictionary_samples, 0); assert!(stats.applications.is_empty());
    reopened.delete("transcripts", &t.id).unwrap();
    assert_eq!(reopened.statistics(0.).unwrap().words_corrected, 1);
}

#[test]
fn identity_migration_snapshots_live_wal_and_remaps_files_without_touching_source() {
    let parent = std::env::temp_dir().join(format!("no-tipe-migration-test-{}", uuid::Uuid::new_v4()));
    let old = parent.join(crate::legacy::DESKTOP_IDENTIFIER);
    let new = parent.join("app.no-tipe.desktop");
    let source = Store::open(&old).unwrap();
    drop(source);
    std::fs::rename(old.join(crate::legacy::CURRENT_DATABASE), old.join(crate::legacy::DATABASE)).unwrap();
    let source = rusqlite::Connection::open(old.join(crate::legacy::DATABASE)).unwrap();
    source.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;").unwrap();
    std::fs::write(old.join("audio/recording.wav"), b"audio fixture").unwrap();
    std::fs::write(old.join("models/model.bin"), b"model fixture").unwrap();
    let mut t = transcript();
    t.duration = 11.466666666666667;
    t.audio_file = Some(old.join("audio/recording.wav").to_string_lossy().into());
    let data = serde_json::to_string(&t).unwrap();
    source.execute("INSERT INTO transcripts(id,timestamp,status,text,data) VALUES(?1,?2,?3,?4,?5)", rusqlite::params![t.id,t.timestamp,t.status,t.text,data]).unwrap();
    // Windows initializes portable preferences on open. Replace that setup
    // value with the legacy fixture before taking the live WAL snapshot.
    source.execute("INSERT INTO metadata VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [r#"{"palette":"cyan"}"#]).unwrap();
    source.execute("INSERT INTO metadata VALUES('updateRepository',?1)", [r#""former/project""#]).unwrap();
    source.execute("INSERT INTO models VALUES('local',?1)", [serde_json::json!({"path":old.join("models/model.bin")}).to_string()]).unwrap();
    assert!(old.join(format!("{}-wal", crate::legacy::DATABASE)).exists());
    crate::legacy::prepare_data_root(&new).unwrap();
    let target = Store::open(&new).unwrap();
    assert_eq!(target.preferences().unwrap().palette, "aurora");
    assert!(target.transcript(&t.id).unwrap().audio_file.is_none());
    assert!(!new.join("audio/recording.wav").exists());
    assert!(old.join("audio/recording.wav").exists());
    let original_json: String = source.query_row("SELECT data FROM transcripts", [], |r| r.get(0)).unwrap();
    let migrated_json: String = target.db.lock().unwrap().query_row("SELECT data FROM transcripts", [], |r| r.get(0)).unwrap();
    // Removing retained audio must preserve the rest of the original data.
    assert_eq!(migrated_json, original_json.replace(
        &format!("\"audioFile\":{}", serde_json::to_string(&t.audio_file).unwrap()),
        "\"audioFile\":null",
    ));
    // Obsolete updater preferences are preserved as data and ignored by updates.
    assert_eq!(target.get_meta::<String>("updateRepository").unwrap().as_deref(), Some("former/project"));
    assert_eq!(std::fs::read(new.join("models/model.bin")).unwrap(), b"model fixture");
    let data: String = target.db.lock().unwrap().query_row("SELECT data FROM models WHERE id='local'", [], |r| r.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&data).unwrap()["path"], new.join("models/model.bin").to_string_lossy().as_ref());
    let original: String = source.query_row("SELECT data FROM transcripts", [], |r| r.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Transcript>(&original).unwrap().audio_file, t.audio_file);
    target.set_meta("updateRepository", &"new/project").unwrap();
    crate::legacy::prepare_data_root(&new).unwrap();
    assert_eq!(target.get_meta::<String>("updateRepository").unwrap().as_deref(), Some("new/project"));
    drop(target); drop(source);
    std::fs::remove_dir_all(parent).unwrap();
}

#[test]
fn identity_migration_refuses_to_overwrite_nonempty_destination() {
    let parent = std::env::temp_dir().join(format!("no-tipe-migration-test-{}", uuid::Uuid::new_v4()));
    let old = parent.join(crate::legacy::DESKTOP_IDENTIFIER);
    let new = parent.join("app.no-tipe.desktop");
    std::fs::create_dir_all(&old).unwrap();
    std::fs::create_dir_all(&new).unwrap();
    std::fs::write(old.join(crate::legacy::DATABASE), b"fixture").unwrap();
    std::fs::write(new.join("keep.txt"), b"existing data").unwrap();
    assert!(crate::legacy::prepare_data_root(&new).is_err());
    assert_eq!(std::fs::read(new.join("keep.txt")).unwrap(), b"existing data");
    assert_eq!(std::fs::read(old.join(crate::legacy::DATABASE)).unwrap(), b"fixture");
    std::fs::remove_dir_all(parent).unwrap();
}

#[test]
fn session_configuration_roundtrips_history_and_legacy_backups() {
    let source = store();
    let mut t = transcript();
    t.session_config = Some(crate::session::tests::fixture().configuration);
    source.save_transcript(&t).unwrap();
    let backup_json = serde_json::to_value(source.backup().unwrap()).unwrap();
    let restored = store();
    let backup: Backup = serde_json::from_value(backup_json.clone()).unwrap();
    restored.import_backup(backup).unwrap();
    let c = restored.transcript(&t.id).unwrap().session_config.unwrap();
    assert_eq!(c.version, 1); assert_eq!(c.language, "ru"); assert_eq!(c.processing.model, "text-old"); assert_eq!(c.delivery.output, "clipboard");
    let mut old_json = backup_json;
    old_json["format"] = serde_json::json!(crate::legacy::BACKUP_FORMAT);
    old_json["transcripts"][0].as_object_mut().unwrap().remove("sessionConfig");
    let old_backup: Backup = serde_json::from_value(old_json).unwrap();
    let old_history = store(); old_history.import_backup(old_backup).unwrap();
    let old = old_history.transcript(&t.id).unwrap();
    assert!(old.session_config.is_none()); assert_eq!(old.text, t.text);
}
