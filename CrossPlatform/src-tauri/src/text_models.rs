use crate::{domain::Model, store::{err, Store}};
use std::{io::Read, path::{Path, PathBuf}};
use tauri::{AppHandle, Emitter};

pub const PROVIDER: &str = "local";
pub const DEFAULT_MODEL: &str = "qwen3.5-4b";
static FILE_OPERATIONS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn model_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 100 || !id.bytes().all(|c|c.is_ascii_alphanumeric() || matches!(c,b'-'|b'_'|b'.')) || id.contains("..") {
        return Err("Invalid local text model identifier".into());
    }
    Ok(root.join("text-models").join(format!("{id}.gguf")))
}
pub fn gguf(path: &Path) -> Result<(), String> {
    let mut file = std::fs::File::open(path).map_err(err)?;
    let mut header = [0u8; 24];
    file.read_exact(&mut header).map_err(|_| "The model file is incomplete")?;
    if &header[..4] != b"GGUF" || ![2,3].contains(&u32::from_le_bytes(header[4..8].try_into().unwrap())) || u64::from_le_bytes(header[8..16].try_into().unwrap())==0 {
        return Err("Choose a GGUF model (version 2 or 3) compatible with llama.cpp".into());
    }
    Ok(())
}
pub fn require_installed(root:&Path,id:&str)->Result<PathBuf,String> {
    let path=model_path(root,id)?;
    if !path.is_file() || crate::model_hub::asset(root,id).is_some_and(|a|std::fs::metadata(&path).map_or(true,|m|m.len()!=a.size)) {
        return Err(crate::localization::message("native.download_text_model"));
    }
    gguf(&path)?;
    Ok(path)
}
pub fn require_processing_model(root: &Path, p: &crate::domain::Preferences) -> Result<(), String> {
    if p.processing_provider == PROVIDER {
        require_installed(root, &p.processing_model)?;
    }
    Ok(())
}

pub fn validate_activation(root: &Path, previous: &crate::domain::Preferences, next: &crate::domain::Preferences, modes: &[crate::domain::Mode]) -> Result<(), String> {
    let configured = |p: &crate::domain::Preferences| crate::domain::processing_preferences(p,
        modes.iter().find(|mode| mode.enabled && Some(&mode.id) == p.active_mode.as_ref()));
    let before = configured(previous);
    let after = configured(next);
    let enabled = next.enhance || next.shorten || next.translation != "off";
    let activated = !previous.enhance && next.enhance || !previous.shorten && next.shorten
        || previous.translation != next.translation && next.translation != "off";
    let changed_model = before.processing_provider != after.processing_provider || before.processing_model != after.processing_model;
    if activated || enabled && changed_model { require_processing_model(root, &after)?; }
    Ok(())
}
pub fn catalog(store: &Store) -> Result<Vec<Model>, String> {
    let mut models:Vec<Model> = crate::model_hub::assets(&store.root,crate::model_hub::Kind::Text).into_iter().map(|asset|asset.model(&store.root)).collect();
    for mut model in store.list::<Model>("models")?.into_iter().filter(|m|m.provider==PROVIDER) {
        let path = model_path(&store.root,&model.id)?;
        model.path=Some(path.to_string_lossy().into());
        model.model=model.id.clone();
        model.installed=gguf(&path).is_ok();
        model.has_key=true;
        if !models.iter().any(|m|m.id==model.id) {models.push(model);}
    }
    Ok(models)
}
// Preserve the selected Qwen size when upgrading an existing local Ollama setup.
// Run once; choosing Ollama explicitly afterwards remains the user's choice.
fn ollama_replacement(p:&crate::domain::Preferences,installed:&[Model])->Option<String> {
    if p.processing_provider!="ollama" || !url::Url::parse(&p.processing_endpoint).is_ok_and(|u|matches!(u.host_str(),Some("127.0.0.1"|"localhost"|"[::1]")) && u.username().is_empty() && u.password().is_none()) {return None;}
    let id=p.processing_model.to_lowercase().replace(':',"-");
    if !installed.iter().any(|a|a.id==id) {return None;}
    installed.iter().find(|m|m.id==id && m.installed).map(|m|m.id.clone())
}
pub fn migrate_ollama(store:&Store)->Result<(),String> {
    use crate::domain::{Mode, Preferences, processing_preferences};
    if store.get_meta::<bool>("localTextMigration")?.unwrap_or(false) {return Ok(());}
    let installed=catalog(store)?;
    let baseline=store.preferences()?;
    let replacement=|p:&Preferences|ollama_replacement(p,&installed);
    if let Some(id)=replacement(&baseline) {
        store.update_preferences(|p| {p.processing_provider=PROVIDER.into();p.processing_model=id;p.processing_endpoint.clear();Ok(())})?;
    }
    for mut mode in store.list::<Mode>("modes")? {
        let explicit=mode.processing_provider.as_deref()==Some("ollama") || mode.processing_provider.is_none() && mode.legacy.as_ref().is_some_and(|v|v["selectedAIProvider"].as_str().is_some_and(|p|p.eq_ignore_ascii_case("ollama")));
        if explicit {
            if let Some(id)=replacement(&processing_preferences(&baseline,Some(&mode))) {
                mode.processing_provider=Some(PROVIDER.into());mode.processing_model=Some(id);mode.processing_endpoint=None;
                store.put("modes",&mode.id,&mode)?;
            }
        }
    }
    store.set_meta("localTextMigration",&true)
}

// A temporary file never appears as installed, and interrupted writes are removed.
struct PendingFile(PathBuf);
impl Drop for PendingFile { fn drop(&mut self) { let _=std::fs::remove_file(&self.0); } }

pub async fn download(app: &AppHandle, store: &Store, id: &str) -> Result<(),String> {
    let _operation=FILE_OPERATIONS.try_lock().map_err(|_|"Another text model is being installed or removed. Wait for it to finish.")?;
    if let Some(asset)=crate::model_hub::asset(&store.root,id).filter(|a|a.kind==crate::model_hub::Kind::Text) {
        crate::model_download::install(&store.root,&asset,|done,total|{let _=app.emit("model-download",serde_json::json!({"id":id,"done":done,"total":total}));}).await?;
        let _=app.emit("text-models-changed",());
        let _=app.emit("model-catalog-changed",crate::model_hub::status(&store.root));
        return Ok(());
    }
    let model=catalog(store)?.into_iter().find(|m|m.id==id).ok_or("Text model not found")?;
    if model.installed { return Ok(()); }
    let url=model.download_url.ok_or("Import a GGUF file for this model")?;
    crate::domain::validate_endpoint(&url)?;
    if !url.starts_with("https://") { return Err("Use an HTTPS download link".into()); }
    let path=model_path(&store.root,id)?;
    tokio::fs::create_dir_all(path.parent().unwrap()).await.map_err(err)?;
    let operation=crate::model_download::Operation::begin(id)?;
    let done=crate::model_download::transfer(&crate::model_download::client()?,&path,&url,None,None,&operation,|done,total|{
        let _=app.emit("model-download",serde_json::json!({"id":id,"done":done,"total":total}));
    }).await?;
    if let Err(error)=gguf(&path.with_extension("part")) {crate::model_download::discard(&path);return Err(error);}
    operation.check()?;
    crate::model_download::finish(&path).await?;
    if crate::model_hub::asset(&store.root,id).is_none() {
        let mut saved=store.list::<Model>("models")?.into_iter().find(|m|m.id==id).ok_or("Text model not found")?;
        saved.size=done;
        store.put("models",id,&saved)?;
    }
    let _=app.emit("model-download",serde_json::json!({"id":id,"done":done,"total":done}));
    let _=app.emit("text-models-changed",());
    Ok(())
}
pub async fn add(app: &AppHandle, store: &Store, name: String, path: Option<PathBuf>, url: Option<String>) -> Result<String,String> {
    let _operation=FILE_OPERATIONS.try_lock().map_err(|_|"Another text model operation is in progress")?;
    if name.trim().is_empty() || name.len()>200 { return Err("Enter a model name (up to 200 characters)".into()); }
    if path.is_some()==url.is_some() { return Err("Choose a GGUF file or a download link".into()); }
    if let Some(url)=&url {
        crate::domain::validate_endpoint(url)?;
        if !url.starts_with("https://") { return Err("Use a direct HTTPS link to a GGUF model file".into()); }
    }
    let id=format!("gguf-{}",uuid::Uuid::new_v4());
    let destination=model_path(&store.root,&id)?;
    let size=if let Some(source)=path {
        gguf(&source)?;
        tokio::fs::create_dir_all(destination.parent().unwrap()).await.map_err(err)?;
        crate::model_download::ensure_space(destination.parent().unwrap(),std::fs::metadata(&source).map_err(err)?.len())?;
        let pending=PendingFile(destination.with_extension("part"));
        let size=tokio::fs::copy(&source,&pending.0).await.map_err(err)?;
        gguf(&pending.0)?;
        tokio::fs::rename(&pending.0,&destination).await.map_err(err)?;
        size
    } else { 0 };
    let model=Model { id:id.clone(),name:name.trim().into(),provider:PROVIDER.into(),model:id.clone(),endpoint:String::new(),local:true,
        path:Some(destination.to_string_lossy().into()), download_url:url, size, installed:size>0,has_key:true,languages:"Multilingual".into(),description:"Custom GGUF · runs on this device".into() };
    if let Err(error)=store.put("models",&id,&model) { let _=tokio::fs::remove_file(destination).await; return Err(error); }
    let _=app.emit("text-models-changed",());
    Ok(id)
}
pub async fn remove(app: &AppHandle, store: &Store, id: &str) -> Result<(),String> {
    let _operation=FILE_OPERATIONS.try_lock().map_err(|_|"Another text model operation is in progress")?;
    if !catalog(store)?.iter().any(|m|m.id==id) { return Err("Text model not found".into()); }
    crate::local_text::unload(id).await?;
    let path=model_path(&store.root,id)?;
    crate::model_download::discard(&path);
    match tokio::fs::remove_file(path).await { Ok(())=>{}, Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{}, Err(e)=>return Err(err(e)) }
    if crate::model_hub::asset(&store.root,id).is_none() { store.delete("models",id)?; }
    let _=app.emit("text-models-changed",());
    let _=app.emit("model-catalog-changed",crate::model_hub::status(&store.root));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activation_requires_the_selected_local_model_but_allows_disabling_and_unrelated_edits() {
        use crate::domain::{Mode, Preferences};
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let previous = Preferences::default();
        for next in [Preferences { enhance: true, ..previous.clone() }, Preferences { shorten: true, ..previous.clone() }, Preferences { translation: "english".into(), ..previous.clone() }] {
            assert_eq!(validate_activation(&root, &previous, &next, &[]).unwrap_err(), crate::localization::message("native.download_text_model"));
            assert!(validate_activation(&root, &next, &previous, &[]).is_ok());
            assert!(validate_activation(&root, &next, &Preferences { sounds: !next.sounds, ..next.clone() }, &[]).is_ok());
        }
        let cloud = Preferences { enhance: true, processing_provider: "openai".into(), ..previous.clone() };
        assert!(validate_activation(&root, &previous, &cloud, &[]).is_ok());
        let local = Preferences { processing_provider: PROVIDER.into(), ..cloud.clone() };
        assert!(validate_activation(&root, &cloud, &local, &[]).is_err());
        let mode = Mode { id: "local-mode".into(), processing_provider: Some(PROVIDER.into()), processing_model: Some(DEFAULT_MODEL.into()), ..Default::default() };
        let selected = Preferences { active_mode: Some(mode.id.clone()), ..cloud.clone() };
        assert!(validate_activation(&root, &cloud, &selected, &[mode]).is_err());
        let mode = Mode { id: "cloud-mode".into(), processing_provider: Some("openai".into()), ..Default::default() };
        let selected = Preferences { enhance: true, active_mode: Some(mode.id.clone()), ..previous.clone() };
        assert!(validate_activation(&root, &previous, &selected, &[mode]).is_ok());
        let path = model_path(&root, "custom-installed").unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"GGUF\x03\0\0\0\x01\0\0\0\0\0\0\0\x01\0\0\0\0\0\0\0").unwrap();
        let installed = Preferences { enhance: true, processing_model: "custom-installed".into(), ..previous.clone() };
        assert!(validate_activation(&root, &previous, &installed, &[]).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn paths_cannot_escape_app_storage() {
        for id in ["../model","/tmp/model","a/b","a\\b","..","", "a..b"] { assert!(model_path(Path::new("/data"),id).is_err()); }
        assert_eq!(model_path(Path::new("/data"),"qwen3.5-9b").unwrap(),Path::new("/data/text-models/qwen3.5-9b.gguf"));
    }
    #[test]
    fn upgrade_preserves_the_model_size_and_does_not_switch_remote_providers() {
        use crate::domain::Preferences;
        let root=std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let store=Store::open(&root).unwrap();
        let mut available=catalog(&store).unwrap();
        available.iter_mut().for_each(|m|m.installed=true);
        let mut p=Preferences {processing_provider:"ollama".into(),processing_model:"qwen3.5:9b".into(),processing_endpoint:"http://127.0.0.1:11434/v1".into(),..Default::default()};
        assert_eq!(ollama_replacement(&p,&available),Some("qwen3.5-9b".into()));
        for endpoint in ["https://models.example.com","http://user:password@localhost/v1","https://localhost.example.com"] {
            p.processing_endpoint=endpoint.into();assert!(ollama_replacement(&p,&available).is_none());
        }
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn catalog_requires_complete_files_and_excludes_custom_speech_models() {
        let root=std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let store=Store::open(&root).unwrap();
        assert_eq!(catalog(&store).unwrap().len(),4);
        let path=model_path(&root,DEFAULT_MODEL).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut header=b"GGUF\x03\0\0\0\x01\0\0\0\0\0\0\0\x01\0\0\0\0\0\0\0".to_vec();
        header.resize(32,0);
        std::fs::write(&path,header).unwrap();
        assert!(!catalog(&store).unwrap().into_iter().find(|m|m.id==DEFAULT_MODEL).unwrap().installed);
        assert!(gguf(&path).is_ok());
        std::fs::write(&path,b"<html>not a model").unwrap();
        assert!(gguf(&path).is_err());
        drop(store); std::fs::remove_dir_all(root).unwrap();
    }
}
