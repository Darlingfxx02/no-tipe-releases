use crate::store::err;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

pub const ID: &str = "gigaam-v3-e2e-rnnt-coreml";
pub const REPOSITORY: &str = "https://huggingface.co/smkrv/gigaam-v3-e2e-rnnt-coreml/resolve/846833ef075fde2a8e50521d093ddb9ed7b7fd45";
#[derive(Deserialize)]
pub struct Asset {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}
pub fn assets() -> Vec<Asset> {
    serde_json::from_str(include_str!("../gigaam-assets.json")).expect("bundled GigaAM manifest")
}
pub fn installed(directory: &Path) -> bool {
    assets().iter().all(|a| {
        directory
            .join(&a.path)
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == a.size)
    })
}
pub fn model_path(root: &Path, legacy: Option<PathBuf>) -> PathBuf {
    let own = root.join("models").join(ID);
    if installed(&own) {
        return own;
    }
    legacy.filter(|p| installed(p)).unwrap_or(own)
}
pub fn download_status(root: &Path) -> Option<crate::model_download::Status> {
    let directory = root.join("models").join(ID);
    let assets = assets();
    if installed(&directory) {
        return None;
    }
    let total = assets.iter().map(|a| a.size).sum();
    let mut done = 0;
    for asset in assets {
        let path = directory.join(&asset.path);
        if path
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == asset.size)
        {
            done += asset.size;
        } else if let Some(part) = crate::model_download::partial_status(
            ID,
            &path,
            &format!("{REPOSITORY}/{}", asset.path),
            Some(asset.size),
            Some(&asset.sha256),
        ) {
            done += part.done;
        }
    }
    (done > 0).then(|| crate::model_download::Status {
        id: ID.into(),
        phase: "paused".into(),
        done,
        total,
        resumable: true,
    })
}
pub async fn download(app: &AppHandle, root: &Path) -> Result<(), String> {
    let operation = crate::model_download::Operation::begin(ID)?;
    let directory = root.join("models").join(ID);
    let assets = assets();
    tokio::fs::create_dir_all(&directory).await.map_err(err)?;
    let total: u64 = assets.iter().map(|a| a.size).sum();
    let saved = download_status(root).map_or(0, |s| s.done);
    crate::model_download::ensure_space(&directory, total.saturating_sub(saved))?;
    let client = crate::model_download::client()?;
    let mut done = 0;
    for asset in assets {
        operation.check()?;
        let path = directory.join(&asset.path);
        if path
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == asset.size)
        {
            done += asset.size;
            continue;
        }
        crate::model_download::transfer(
            &client,
            &path,
            &format!("{REPOSITORY}/{}", asset.path),
            Some(asset.size),
            Some(&asset.sha256),
            &operation,
            |received, _| {
                let phase = crate::model_download::active()
                    .map(|s| s.phase)
                    .unwrap_or_else(|| "downloading".into());
                operation.update(&phase, done + received, total, phase != "verifying");
                let _ = app.emit(
                    "model-download",
                    serde_json::json!({"id":ID,"done":done+received,"total":total}),
                );
            },
        )
        .await?;
        operation.check()?;
        crate::model_download::finish(&path).await?;
        done += asset.size;
    }
    operation.update("verifying", done, total, false);
    if !installed(&directory) {
        return Err("GigaAM files are incomplete".into());
    }
    let _ = app.emit("model-catalog-changed", crate::model_hub::status(root));
    Ok(())
}
