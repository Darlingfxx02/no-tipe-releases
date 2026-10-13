use crate::{
    credentials,
    domain::{Model, Mode, Preferences},
    store::{err, Store},
};
use std::path::Path;
use tauri::{AppHandle, Emitter};

pub fn catalog(store: &Store) -> Result<Vec<Model>, String> {
    let mut models = vec![];
    models.extend(crate::model_hub::assets(&store.root,crate::model_hub::Kind::Speech).into_iter().map(|asset|asset.model(&store.root)));
    for (provider, model, name, endpoint) in [
        (
            "openai",
            "gpt-4o-transcribe",
            "GPT-4o Transcribe",
            "https://api.openai.com/v1",
        ),
        (
            "openai",
            "gpt-4o-mini-transcribe",
            "GPT-4o Mini Transcribe",
            "https://api.openai.com/v1",
        ),
        (
            "groq",
            "whisper-large-v3-turbo",
            "Whisper · Groq",
            "https://api.groq.com/openai/v1",
        ),
        (
            "mistral",
            "voxtral-mini-latest",
            "Voxtral",
            "https://api.mistral.ai/v1",
        ),
        (
            "deepgram",
            "nova-3",
            "Nova 3",
            "https://api.deepgram.com/v1",
        ),
        (
            "elevenlabs",
            "scribe_v2",
            "Scribe v2",
            "https://api.elevenlabs.io/v1",
        ),
        (
            "gemini",
            "gemini-2.5-flash",
            "Gemini Flash",
            "https://generativelanguage.googleapis.com/v1beta",
        ),
        (
            "soniox",
            "stt-async-v5",
            "Soniox",
            "https://api.soniox.com/v1",
        ),
        (
            "assemblyai",
            "universal-3-5-pro",
            "AssemblyAI",
            "https://api.assemblyai.com/v2",
        ),
        (
            "speechmatics",
            "enhanced",
            "Speechmatics",
            "https://asr.api.speechmatics.com/v2",
        ),
        ("xai", "grok-stt", "Grok Speech", "https://api.x.ai/v1"),
        (
            "cartesia",
            "ink-2",
            "Cartesia Ink",
            "https://api.cartesia.ai",
        ),
    ] {
        models.push(Model {
            id: format!("{provider}:{model}"),
            name: name.into(),
            provider: provider.into(),
            model: model.into(),
            endpoint: endpoint.into(),
            local: false,
            path: None,
            download_url: None,
            size: 0,
            installed: true,
            has_key: credentials::has(provider),
            languages: "Multilingual".into(),
            description: "Cloud transcription".into(),
        });
    }
    for mut m in store.list::<Model>("models")? {
        if m.provider == crate::text_models::PROVIDER { continue; }
        m.has_key = m.local || credentials::has(&m.provider);
        m.installed = !m.local || m.path.as_ref().is_some_and(|p| {
            let path=Path::new(p);
            match m.provider.as_str() {
                "whisper" => path.is_file() && (m.size==0 || std::fs::metadata(path).is_ok_and(|meta|meta.len()==m.size)) && crate::model_hub::whisper_file(path).is_ok(),
                "coreml" => cfg!(target_os = "macos") && crate::gigaam::installed(path),
                _ => false,
            }
        });
        models.push(m);
    }
    Ok(models)
}
pub async fn download(app: AppHandle, store: &Store, id: &str) -> Result<(), String> {
    if id == crate::gigaam::ID {
        crate::gigaam::download(&app, &store.root).await?;
    } else {
        let asset=crate::model_hub::asset(&store.root,id).filter(|a|a.kind==crate::model_hub::Kind::Speech).ok_or("This speech model has no verified cloud download")?;
        if !asset.files.is_empty() {crate::speech_bundle::download(&app,&store.root,&asset).await?;}
        else {crate::model_download::install(&store.root,&asset,|done,total|{
            let _=app.emit("model-download",serde_json::json!({"id":id,"done":done,"total":total}));
        }).await?;}
    }
    ensure_default(store, Some(id))?;
    let _=app.emit("model-catalog-changed",crate::model_hub::status(&store.root));
    Ok(())
}

pub fn ready(model: &Model) -> bool { model.installed && model.has_key }
pub fn find<'a>(catalog: &'a [Model], id: &str) -> Option<&'a Model> {
    catalog.iter().find(|model| model.id == id || model.model == id)
}
/// A verified first download makes dictation usable. Existing ready choices,
/// including cloud providers and historical aliases, keep their selection.
pub fn ensure_default(store: &Store, preferred: Option<&str>) -> Result<bool, String> {
    let catalog = catalog(store)?;
    ensure_default_in_catalog(store, &catalog, preferred)
}
fn ensure_default_in_catalog(store: &Store, catalog: &[Model], preferred: Option<&str>) -> Result<bool, String> {
    if find(&catalog, &store.preferences()?.transcription_model).is_some_and(ready) { return Ok(false); }
    let fallback = preferred.and_then(|id| find(&catalog, id)).filter(|m| m.local && ready(m))
        .or_else(|| catalog.iter().find(|m| m.local && ready(m)));
    let Some(fallback) = fallback else { return Ok(false); };
    let mut changed = false;
    store.update_preferences(|p| {
        if !find(&catalog, &p.transcription_model).is_some_and(ready) {
            p.transcription_model = fallback.id.clone();
            if !supports_language(fallback, &p.language) { p.language = "auto".into(); }
            changed = true;
        }
        Ok(())
    })?;
    Ok(changed)
}
fn supports_language(model: &Model, language: &str) -> bool {
    if model.provider=="sherpa-onnx" && language!="auto" {
        let models:Vec<crate::model_hub::Asset>=serde_json::from_str(include_str!("../speech-model-bundles.json")).unwrap();
        return models.into_iter().find(|a|a.id()==model.id).is_some_and(|a|a.language_codes.iter().any(|l|l==language));
    }
    language == "auto" || match model.languages.as_str() { "English" => language == "en", "Russian" => language == "ru", _ => true }
}
/// Explicit activation also makes an active mode inherit the chosen model,
/// without disabling its processing, delivery or application triggers.
pub fn select(store: &Store, id: &str) -> Result<Preferences, String> {
    use rusqlite::{params, OptionalExtension};
    let catalog = catalog(store)?;
    let model = find(&catalog, id).ok_or_else(|| crate::localization::message("native.speech_model_unavailable"))?;
    if !model.installed { return Err(crate::localization::message("native.download_speech_model")); }
    if !model.has_key { return Err(crate::localization::message("native.speech_model_key_required")); }
    let mut db = store.db.lock().map_err(err)?;
    let tx = db.transaction().map_err(err)?;
    let raw: Option<String> = tx.query_row("SELECT value FROM metadata WHERE key='preferences'", [], |r| r.get(0)).optional().map_err(err)?;
    let mut p: Preferences = raw.map(|v| serde_json::from_str(&v).map_err(err)).transpose()?.unwrap_or_default();
    p.transcription_model = model.id.clone();
    if !supports_language(model, &p.language) { p.language = "auto".into(); }
    if let Some(id) = p.active_mode.as_ref() {
        let raw: Option<String> = tx.query_row("SELECT data FROM modes WHERE id=?1", [id], |r| r.get(0)).optional().map_err(err)?;
        if let Some(mut mode) = raw.map(|v| serde_json::from_str::<Mode>(&v).map_err(err)).transpose()?.filter(|m| m.enabled) {
            mode.model = None;
            if !supports_language(model, &mode.language) { mode.language = "auto".into(); }
            tx.execute("UPDATE modes SET data=?1 WHERE id=?2", params![serde_json::to_string(&mode).map_err(err)?, id]).map_err(err)?;
        }
    }
    p.validate()?;
    tx.execute("INSERT INTO metadata(key,value) VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&p).map_err(err)?]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(p)
}

async fn remove_download(store:&Store,id:&str,legacy_home:Option<std::path::PathBuf>)->Result<(),String> {
    let model=catalog(store)?.into_iter().find(|m|m.id==id&&m.local).ok_or("Local speech model not found")?;
    if model.provider=="whisper" {
        let asset=crate::model_hub::asset(&store.root,id).filter(|a|a.kind==crate::model_hub::Kind::Speech).ok_or("Speech model not found")?;
        crate::providers::unload_whisper()?;
        // Remove both compatible copies so a legacy fallback cannot resurrect a deleted model.
        let mut paths=vec![store.root.join("models").join(&asset.file)];
        if let Some(home)=legacy_home {paths.push(crate::legacy::native_root(&home).join("WhisperModels").join(&asset.file));}
        for path in paths {crate::model_download::discard(&path);match tokio::fs::remove_file(path).await {Ok(())=>{},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>return Err(crate::store::err(e))};}
    } else if model.provider=="sherpa-onnx" {
        crate::sherpa::unload()?;
        let path=store.root.join("models").join(id);
        match tokio::fs::remove_dir_all(path).await {Ok(())=>{},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>return Err(err(e))};
    } else if id==crate::gigaam::ID {
        let mut paths=vec![store.root.join("models").join(crate::gigaam::ID)];
        if let Some(home)=legacy_home {paths.push(crate::legacy::native_root(&home).join("GigaAMModels").join(crate::gigaam::ID));}
        for path in paths {match tokio::fs::remove_dir_all(path).await {Ok(())=>{},Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>return Err(crate::store::err(e))};}
    } else {return Err("This model cannot be removed from the local catalog".into());}
    Ok(())
}
pub async fn remove(app:&AppHandle,store:&Store,id:&str)->Result<(),String> {
    remove_download(store,id,dirs::home_dir()).await?;
    let _=app.emit("model-catalog-changed",crate::model_hub::status(&store.root));
    Ok(())
}

#[cfg(test)]
mod selection_tests {
    use super::*;
    use std::io::Write;
    struct Fixture { store: Store }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("no-tipe-model-selection-{}", uuid::Uuid::new_v4()));
            Self { store: Store::open(&root).unwrap() }
        }
        fn installed(&self, id: &str) {
            let asset = crate::model_hub::asset(&self.store.root, id).unwrap();
            let mut file = std::fs::File::create(self.store.root.join("models").join(asset.file)).unwrap();
            file.write_all(&0x67676d6cu32.to_le_bytes()).unwrap();
            file.set_len(asset.size).unwrap();
        }
        fn ensure_default(&self, preferred: Option<&str>) -> bool {
            // A test directory must not see the developer's compatibility
            // models in ~/Library/Application Support.
            let mut catalog=catalog(&self.store).unwrap();
            for model in &mut catalog {
                if model.local && !model.path.as_deref().is_some_and(|p|Path::new(p).starts_with(&self.store.root)) {model.installed=false;}
            }
            ensure_default_in_catalog(&self.store,&catalog,preferred).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Windows cannot remove the database directory while SQLite still
            // owns its file handle. Close it before disposing of test weights.
            if let (Ok(db), Ok(replacement)) = (self.store.db.get_mut(), rusqlite::Connection::open_in_memory()) {
                drop(std::mem::replace(db,replacement));
            }
            let _ = std::fs::remove_dir_all(&self.store.root);
        }
    }
    #[test]
    fn first_installed_model_replaces_only_an_unavailable_default_and_survives_restart() {
        let f = Fixture::new();
        let mut expected = f.store.update_preferences(|p| { p.translation="english".into();p.typing_wpm=73.;p.audio_device="saved microphone".into();Ok(()) }).unwrap();
        assert!(!f.ensure_default(None));
        f.installed("whisper-tiny");
        assert!(f.ensure_default(Some("whisper-tiny")));
        expected.transcription_model="whisper-tiny".into();
        assert_eq!(serde_json::to_value(f.store.preferences().unwrap()).unwrap(), serde_json::to_value(&expected).unwrap());
        f.installed("whisper-base");
        assert!(!f.ensure_default(Some("whisper-base")));
        let reopened=Store::open(&f.store.root).unwrap();
        assert_eq!(reopened.preferences().unwrap().transcription_model,"whisper-tiny");
        let session=crate::session::RecordingSession::resolve(&reopened,reopened.preferences().unwrap(),None,false).unwrap();
        assert_eq!(session.model.id,"whisper-tiny");
        assert_eq!(session.model.path,crate::model_hub::asset(&f.store.root,"whisper-tiny").map(|a|a.path(&f.store.root).to_string_lossy().into()));
        f.store.update_preferences(|p|{p.transcription_model="base".into();Ok(())}).unwrap();
        assert!(!f.ensure_default(Some("whisper-tiny")));
        assert_eq!(f.store.preferences().unwrap().transcription_model,"base");
    }
    #[test]
    fn activation_updates_the_effective_model_without_disabling_mode_rules_or_other_data() {
        let f=Fixture::new();f.installed("whisper-tiny");f.installed("whisper-base");
        let mode=Mode {id:"notes".into(),name:"Notes".into(),model:Some("whisper-tiny".into()),prompt:"Keep paragraphs".into(),enhance:true,app_patterns:vec!["Editor".into()],..Default::default()};
        let other=Mode {id:"other".into(),model:Some("whisper-tiny".into()),..Default::default()};
        f.store.put("modes",&mode.id,&mode).unwrap();f.store.put("modes",&other.id,&other).unwrap();
        f.store.set_meta("test-preserve",&"keep").unwrap();
        let old=f.store.update_preferences(|p|{p.active_mode=Some(mode.id.clone());p.shorten=true;Ok(())}).unwrap();
        let frozen=crate::session::RecordingSession::resolve(&f.store,old.clone(),Some(&mode),false).unwrap();
        let selected=select(&f.store,"base").unwrap();
        assert_eq!(selected.transcription_model,"whisper-base");assert_eq!(selected.active_mode,old.active_mode);assert!(selected.shorten);
        let modes=f.store.list::<Mode>("modes").unwrap();
        let current=modes.iter().find(|m|m.id==mode.id).unwrap();
        let mut expected=mode.clone();expected.model=None;
        assert_eq!(serde_json::to_value(current).unwrap(),serde_json::to_value(expected).unwrap());
        assert_eq!(serde_json::to_value(modes.iter().find(|m|m.id==other.id).unwrap()).unwrap(),serde_json::to_value(other).unwrap());
        let session=crate::session::RecordingSession::resolve(&f.store,selected,Some(current),false).unwrap();
        assert_eq!(session.model.id,"whisper-base");assert_eq!(frozen.model.id,"whisper-tiny");
        assert_eq!(session.configuration.processing.instructions,"Keep paragraphs");
        assert_eq!(f.store.get_meta::<String>("test-preserve").unwrap().as_deref(),Some("keep"));
    }
    #[test]
    fn incomplete_or_corrupt_downloads_cannot_become_selected() {
        let f=Fixture::new();
        let asset=crate::model_hub::asset(&f.store.root,"whisper-tiny").unwrap();
        let path=f.store.root.join("models").join(&asset.file);
        std::fs::write(path.with_extension("part"),0x67676d6cu32.to_le_bytes()).unwrap();
        assert!(!f.ensure_default(Some("whisper-tiny")));
        f.installed("whisper-tiny");
        std::fs::OpenOptions::new().write(true).open(&path).unwrap().write_all(b"HTML").unwrap();
        let before=serde_json::to_value(f.store.preferences().unwrap()).unwrap();
        assert!(!f.ensure_default(Some("whisper-tiny")));
        assert!(select(&f.store,"whisper-tiny").is_err());assert!(select(&f.store,"unknown").is_err());
        assert_eq!(serde_json::to_value(f.store.preferences().unwrap()).unwrap(),before);
        assert!(path.exists()&&path.with_extension("part").exists());
    }
    #[test]
    fn a_mode_from_another_device_uses_the_ready_default_without_rewriting_saved_choices() {
        let f=Fixture::new();f.installed("whisper-tiny");
        let mode=Mode{id:"old-device".into(),model:Some("macos-only-missing-model".into()),prompt:"Keep my rules".into(),..Default::default()};
        f.store.put("modes",&mode.id,&mode).unwrap();
        let p=f.store.update_preferences(|p|{p.transcription_model="whisper-tiny".into();p.active_mode=Some(mode.id.clone());Ok(())}).unwrap();
        let session=crate::session::RecordingSession::resolve(&f.store,p.clone(),Some(&mode),false).unwrap();
        assert_eq!(session.model.id,"whisper-tiny");
        assert_eq!(serde_json::to_value(f.store.list::<Mode>("modes").unwrap()[0].clone()).unwrap(),serde_json::to_value(&mode).unwrap());
        assert!(crate::session::RecordingSession::resolve(&f.store,p,Some(&mode),true).is_err());
    }
    #[test]
    fn selecting_english_weights_repairs_only_incompatible_language_choices() {
        let f=Fixture::new();f.installed("whisper-tiny");
        let mut model=crate::model_hub::asset(&f.store.root,"whisper-tiny").unwrap().model(&f.store.root);
        model.id="fixture-english".into();model.languages="English".into();
        f.store.put("models",&model.id,&model).unwrap();
        f.store.update_preferences(|p|{p.language="ru".into();Ok(())}).unwrap();
        assert_eq!(select(&f.store,"fixture-english").unwrap().language,"auto");
        f.store.update_preferences(|p|{p.language="en".into();Ok(())}).unwrap();
        assert_eq!(select(&f.store,"fixture-english").unwrap().language,"en");
    }
    #[test]
    fn downloading_local_weights_does_not_replace_a_ready_cloud_selection() {
        let f=Fixture::new();f.installed("whisper-tiny");
        f.store.update_preferences(|p|{p.transcription_model="connected-cloud".into();Ok(())}).unwrap();
        let mut cloud=crate::model_hub::asset(&f.store.root,"whisper-tiny").unwrap().model(&f.store.root);
        cloud.id="connected-cloud".into();cloud.model="cloud-engine".into();cloud.local=false;cloud.installed=true;cloud.has_key=true;
        let mut available=catalog(&f.store).unwrap();available.push(cloud);
        assert!(!ensure_default_in_catalog(&f.store,&available,Some("whisper-tiny")).unwrap());
        assert_eq!(f.store.preferences().unwrap().transcription_model,"connected-cloud");
    }
}

#[cfg(test)]
mod removal_tests {
    use super::*;
    #[tokio::test]
    async fn removing_weights_keeps_the_selection_catalog_and_other_files() {
        let root=std::env::temp_dir().join(format!("no-tipe-remove-test-{}",uuid::Uuid::new_v4()));
        let store=Store::open(&root).unwrap();
        store.update_preferences(|p|{p.transcription_model="whisper-tiny".into();Ok(())}).unwrap();
        let asset=crate::model_hub::asset(&root,"whisper-tiny").unwrap();
        let folder=root.join("models");std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(&asset.file),[0u8;24]).unwrap();
        std::fs::write(folder.join("unrelated.txt"),"keep").unwrap();
        remove_download(&store,"whisper-tiny",None).await.unwrap();
        assert!(!folder.join(&asset.file).exists());
        assert!(folder.join("unrelated.txt").is_file());
        assert_eq!(store.preferences().unwrap().transcription_model,"whisper-tiny");
        assert!(crate::model_hub::asset(&root,"whisper-tiny").is_some());
        assert!(remove_download(&store,"openai:gpt-4o-transcribe",None).await.is_err());
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn removing_gigaam_keeps_it_downloadable_after_restart_and_cache_loss() {
        let root=std::env::temp_dir().join(format!("no-type-gigaam-removal-{}",uuid::Uuid::new_v4()));
        let store=Store::open(&root).unwrap();
        for id in [crate::sherpa::GIGAAM_V3_ID,crate::sherpa::GIGAAM_MULTILINGUAL_ID,crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID] {
            let asset=crate::model_hub::asset(&root,id).unwrap();
            for file in &asset.files {let path=asset.path(&root).join(&file.path);std::fs::create_dir_all(path.parent().unwrap()).unwrap();std::fs::File::create(path).unwrap().set_len(file.size).unwrap();}
            crate::model_hub::remember_install(&root,&asset).unwrap();
            assert!(catalog(&store).unwrap().iter().any(|m|m.id==id&&m.installed));
            remove_download(&store,id,None).await.unwrap();
            assert!(catalog(&store).unwrap().iter().any(|m|m.id==id&&!m.installed&&m.download_url.is_some()));
        }
        drop(store);std::fs::remove_file(root.join("model-hub/catalog-v1.json")).unwrap();
        let store=Store::open(&root).unwrap();
        let result=crate::model_hub::search(&root,crate::model_hub::Search{kind:crate::model_hub::Kind::Speech,query:"giga".into(),quantization:None,max_bytes:None,language:None}).await.unwrap();
        for id in [crate::sherpa::GIGAAM_V3_ID,crate::sherpa::GIGAAM_MULTILINGUAL_ID,crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID] {assert!(result.models.iter().any(|m|m.model.id==id&&!m.model.installed));}
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore="downloads pinned GigaAM ONNX models and a public Russian speech fixture"]
    async fn live_gigaam_download_recognition_and_removal() {
        use sha2::{Digest,Sha256};
        use std::sync::{Arc,atomic::AtomicBool};
        let root=std::env::temp_dir().join(format!("no-type-GigaAM-Русский-{}",uuid::Uuid::new_v4()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {fn drop(&mut self){let _=crate::sherpa::unload();let _=std::fs::remove_dir_all(&self.0);}}
        let _cleanup=Cleanup(root.clone());
        let store=Store::open(&root).unwrap();
        let audio=root.join("speech.wav");
        let bytes=crate::model_download::client().unwrap().get("https://huggingface.co/csukuangfj/sherpa-onnx-nemo-transducer-giga-am-v3-russian-2025-12-16/resolve/0424d62637b37d8b7b1eb0f75a04d78dec55fdcc/test_wavs/example.wav").send().await.unwrap().error_for_status().unwrap().bytes().await.unwrap();
        assert_eq!(format!("{:x}",Sha256::digest(&bytes)),"d8aaaa18a5098d7c6de0595ae7ac1e64cacd0d4022af3595213bdaf23be77e69");
        std::fs::write(&audio,bytes).unwrap();let samples=crate::audio::decode(&audio).unwrap();
        for id in [crate::sherpa::GIGAAM_V3_ID,crate::sherpa::GIGAAM_MULTILINGUAL_ID,crate::sherpa::GIGAAM_MULTILINGUAL_LARGE_ID] {
            let asset=crate::model_hub::asset(&root,id).unwrap();
            crate::speech_bundle::download_files(&root,&asset,|_,_|{}).await.unwrap();assert!(asset.installed(&root));
            for file in &asset.files {let bytes=std::fs::read(asset.path(&root).join(&file.path)).unwrap();assert_eq!(format!("{:x}",Sha256::digest(&bytes)),file.sha256);}
            let preferences=select(&store,id).unwrap();
            let session=crate::session::RecordingSession::resolve(&store,preferences,None,false).unwrap();
            let cancel=Arc::new(AtomicBool::new(false));crate::providers::prepare_local(&session.model,cancel.clone()).await.unwrap();
            let text=crate::providers::transcribe(&session.model,&audio,samples.clone(),"auto",&[],cancel).await.unwrap();
            println!("{id}: {text}");
            let lower=text.to_lowercase();assert!(lower.contains("трепетом")&&lower.contains("лукоморья")&&lower.contains("дуб"),"{id}: {text}");
            assert_eq!(crate::sherpa::transcribe(session.model.clone(),samples.clone(),Arc::new(AtomicBool::new(true)),None).await.unwrap_err(),"Canceled");
            assert_eq!(crate::sherpa::transcribe(session.model,samples.clone(),Arc::new(AtomicBool::new(false)),None).await.unwrap(),text);
            if id==crate::sherpa::GIGAAM_V3_ID {
                let progress=Arc::new(std::sync::Mutex::new(Vec::new()));let updates=progress.clone();
                let model=asset.model(&root);let long=samples.repeat(3);let duration=long.len() as f64/16000.;
                let result=crate::sherpa::transcribe(model,long,Arc::new(AtomicBool::new(false)),Some(Arc::new(move|_,seconds|updates.lock().unwrap().push(seconds)))).await.unwrap();
                assert!(result.to_lowercase().matches("лукоморья").count()>=2,"{result}");
                let positions=progress.lock().unwrap();assert!(positions.len()>=2);assert_eq!(*positions.last().unwrap(),duration);
            }
            remove_download(&store,id,None).await.unwrap();
            assert!(!asset.installed(&root));assert!(catalog(&store).unwrap().iter().any(|m|m.id==id&&!m.installed));
        }
    }
}
