use crate::{model_hub::Asset, model_download::{self, Operation, Status}, store::err};
use std::path::Path;
use tauri::{AppHandle, Emitter};

pub fn status(root:&Path,asset:&Asset)->Option<Status> {
    if asset.files.is_empty() || asset.installed(root) {return None;}
    let directory=root.join("models").join(asset.id());
    let done=asset.files.iter().map(|file|{
        let path=directory.join(&file.path);
        if path.metadata().is_ok_and(|m|m.is_file()&&m.len()==file.size) {file.size}
        else {model_download::partial_status(&asset.id(),&path,&asset.file_url(&file.path),Some(file.size),Some(&file.sha256)).map_or(0,|s|s.done)}
    }).sum();
    (done>0).then(||Status{id:asset.id(),phase:"paused".into(),done,total:asset.size,resumable:true})
}
pub async fn download(app:&AppHandle,root:&Path,asset:&Asset)->Result<(),String> {
    download_files(root,asset,|done,total|{let _=app.emit("model-download",serde_json::json!({"id":asset.id(),"done":done,"total":total}));}).await
}
pub(crate) async fn download_files(root:&Path,asset:&Asset,progress:impl Fn(u64,u64)+Send+Sync)->Result<(),String> {
    asset.validate()?;
    let id=asset.id();let operation=Operation::begin(&id)?;
    let directory=root.join("models").join(&id);
    tokio::fs::create_dir_all(&directory).await.map_err(err)?;
    let saved=status(root,asset).map_or(0,|s|s.done);
    model_download::ensure_space(&directory,asset.size.saturating_sub(saved))?;
    let client=model_download::client()?;
    let mut done=0;
    for file in &asset.files {
        operation.check()?;
        let path=directory.join(&file.path);
        if path.metadata().is_ok_and(|m|m.is_file()&&m.len()==file.size) {done+=file.size;continue;}
        model_download::transfer(&client,&path,&asset.file_url(&file.path),Some(file.size),Some(&file.sha256),&operation,|received,_|{
            let phase=model_download::active().map_or_else(||"downloading".into(),|s|s.phase);
            operation.update(&phase,done+received,asset.size,phase!="verifying");
            progress(done+received,asset.size);
        }).await?;
        operation.check()?;model_download::finish(&path).await?;done+=file.size;
    }
    operation.update("verifying",done,asset.size,false);
    if !asset.installed(root) {return Err("Speech model files are incomplete".into());}
    crate::model_hub::remember_install(root,asset)
}
