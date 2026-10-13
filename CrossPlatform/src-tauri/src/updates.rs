use crate::{engine::AppState, store::err};
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::channel::RELEASE_REPOSITORY;
const TOKEN_ACCOUNT: &str = "github-updates";
#[derive(Default)]
pub struct Updates(pub tokio::sync::Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    version: String,
    current_version: String,
    notes: String,
}
#[derive(Deserialize)]
struct Release { assets: Vec<Asset> }
#[derive(Deserialize)]
struct Asset { name: String, url: String }

fn main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err(crate::localization::message("native.updates.main_window")); }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo { developer: bool, repository: &'static str, token_configured: bool }

#[tauri::command]
pub fn update_channel(window: WebviewWindow) -> Result<ChannelInfo, String> {
    main_window(&window)?;
    Ok(ChannelInfo { developer: crate::channel::DEVELOPER, repository: RELEASE_REPOSITORY,
        token_configured: crate::channel::DEVELOPER && crate::credentials::has(TOKEN_ACCOUNT) })
}

fn authorization(token: &str) -> Result<reqwest::header::HeaderValue, String> {
    if token.trim().is_empty() || token.len() > 1024 || token.bytes().any(|b| b.is_ascii_whitespace()) {
        return Err(crate::localization::message("native.updates.invalid_token"));
    }
    let mut value = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| crate::localization::message("native.updates.invalid_token"))?;
    value.set_sensitive(true);
    Ok(value)
}

#[tauri::command]
pub async fn save_update_token(window: WebviewWindow, updates: State<'_, Updates>, token: String) -> Result<(), String> {
    main_window(&window)?;
    if !crate::channel::DEVELOPER { return Err(crate::localization::message("native.updates.dev_only")); }
    let mut pending = updates.0.try_lock().map_err(|_| crate::localization::message("native.updates.already_running"))?;
    let token = token.trim();
    crate::diagnostics::remember_secret(token);
    if !token.is_empty() {
        let client = reqwest::Client::builder().user_agent("NoTypeDev")
            .timeout(Duration::from_secs(20)).build().map_err(err)?;
        let response = client.get(format!("https://api.github.com/repos/{RELEASE_REPOSITORY}/releases?per_page=1"))
            .header(reqwest::header::AUTHORIZATION, authorization(token)?)
            .send().await.map_err(|_| crate::localization::message("native.updates.connection"))?;
        if !response.status().is_success() { return Err(crate::localization::message("native.updates.access_required")); }
    }
    crate::credentials::save(TOKEN_ACCOUNT, token)?;
    *pending = None;
    Ok(())
}

fn asset_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(err)?;
    let prefix = format!("/repos/{RELEASE_REPOSITORY}/releases/assets/");
    let path = parsed.path();
    let id = if path.len() >= prefix.len() && path[..prefix.len()].eq_ignore_ascii_case(&prefix) { &path[prefix.len()..] } else { "" };
    if parsed.scheme() != "https" || parsed.host_str() != Some("api.github.com") || parsed.port().is_some() || !parsed.username().is_empty() || parsed.password().is_some() || parsed.query().is_some() || parsed.fragment().is_some() || id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(crate::localization::message("native.updates.asset_location"));
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn check_updates(app: AppHandle, window: WebviewWindow, updates: State<'_, Updates>) -> Result<Option<Available>, String> {
    main_window(&window)?;
    let mut pending = updates.0.lock().await;
    // A failed new check must not leave an earlier package ready to install.
    *pending = None;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::ACCEPT, "application/vnd.github+json".parse().map_err(err)?);
    if crate::channel::DEVELOPER {
        let token = crate::credentials::get(TOKEN_ACCOUNT).map_err(|_| crate::localization::message("native.updates.access_required"))?;
        headers.insert(reqwest::header::AUTHORIZATION, authorization(&token)?);
    }
    let client = reqwest::Client::builder().user_agent(format!("NoType/{}", app.package_info().version)).default_headers(headers.clone()).timeout(Duration::from_secs(20)).build().map_err(err)?;
    let api = format!("https://api.github.com/repos/{RELEASE_REPOSITORY}");
    let response = client.get(format!("{api}/releases/latest")).send().await.map_err(|_| crate::localization::message("native.updates.connection"))?;
    if crate::channel::DEVELOPER && matches!(response.status().as_u16(), 401 | 403) {
        return Err(crate::localization::message("native.updates.access_required"));
    }
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        // An existing repository with no published releases is up to date.
        let repo = client.get(&api).send().await.map_err(err)?;
        if repo.status().is_success() { *pending = None; return Ok(None); }
        return Err(crate::localization::message(if crate::channel::DEVELOPER { "native.updates.access_required" } else { "native.updates.repository_missing" }));
    }
    if !response.status().is_success() { return Err(crate::localization::message_with_values("native.updates.http",serde_json::json!({"status":response.status().to_string()}))); }
    let release: Release = response.json().await.map_err(|_| crate::localization::message("native.updates.invalid_metadata"))?;
    let asset = release.assets.into_iter().find(|a| a.name == "latest.json").ok_or_else(|| crate::localization::message("native.updates.missing_manifest"))?;
    let endpoint = asset_url(&asset.url)?;
    headers.insert(reqwest::header::ACCEPT, "application/octet-stream".parse().map_err(err)?);
    let checked = app.updater_builder().endpoints(vec![endpoint]).map_err(err)?.headers(headers).timeout(Duration::from_secs(20)).build().map_err(err)?.check().await;
    let mut update = match checked {
        Ok(value) => value,
        // A release may be available for another OS while this one is still on
        // its current version. This is a normal channel state, not a failure.
        Err(tauri_plugin_updater::Error::TargetNotFound(_)) => return Ok(None),
        Err(_) => return Err(crate::localization::message("native.updates.manifest_read")),
    };
    if let Some(value) = &mut update {
        // Only install signed assets from this build's own release repository.
        asset_url(value.download_url.as_str())?;
        value.timeout = Some(Duration::from_secs(600));
    }
    let available = update.as_ref().map(|value| Available { version: value.version.clone(), current_version: value.current_version.clone(), notes: value.body.clone().unwrap_or_default() });
    *pending = update;
    Ok(available)
}

#[tauri::command]
pub async fn install_update(app: AppHandle, window: WebviewWindow, updates: State<'_, Updates>) -> Result<(), String> {
    main_window(&window)?;
    let mut pending = updates.0.try_lock().map_err(|_| crate::localization::message("native.updates.already_running"))?;
    let update = pending.as_ref().ok_or_else(|| crate::localization::message("native.updates.check_first"))?.clone();
    let state = app.state::<Arc<AppState>>();
    let mut downloaded = 0_u64;
    let bytes = update.download(|chunk, total| {
        downloaded += chunk as u64;
        let _ = app.emit_to("main", "update-progress", serde_json::json!({"stage":"downloading","downloaded":downloaded,"total":total}));
    }, || { let _ = app.emit_to("main", "update-progress", serde_json::json!({"stage":"verifying"})); }).await.map_err(|_| crate::localization::message("native.updates.download_verification"))?;
    // Poll both gates together: queuing a lifecycle writer while dictation
    // holds operation and waits for a reader would deadlock. Keep the app
    // usable until existing work finishes, then hold both gates until restart.
    let _ = app.emit_to("main", "update-progress", serde_json::json!({"stage":"waiting"}));
    let (_work, _operation) = installation_guards(&state.lifecycle, &state.operation).await;
    let _ = app.emit_to("main", "update-progress", serde_json::json!({"stage":"installing"}));
    update.install(&bytes).map_err(|_| crate::localization::message("native.updates.replace_failed"))?;
    *pending = None;
    let _ = app.emit_to("main", "update-progress", serde_json::json!({"stage":"restarting"}));
    // Let the renderer display 100% before the process exits.
    tokio::time::sleep(Duration::from_millis(250)).await;
    app.restart();
}

async fn installation_guards<'a>(lifecycle: &'a tokio::sync::RwLock<()>, operation: &'a tokio::sync::Mutex<()>) -> (tokio::sync::RwLockWriteGuard<'a, ()>, tokio::sync::MutexGuard<'a, ()>) {
    loop {
        if let Ok(work) = lifecycle.try_write() {
            if let Ok(recording) = operation.try_lock() { return (work, recording); }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[tokio::test]
    async fn installation_waits_for_existing_work_without_blocking_readers() {
        let lifecycle = tokio::sync::RwLock::new(());
        let operation = tokio::sync::Mutex::new(());
        let session = lifecycle.read().await;
        let install = installation_guards(&lifecycle, &operation);
        tokio::pin!(install);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut install).await.is_err());
        // Navigation and new work are still allowed while waiting.
        assert!(lifecycle.try_read().is_ok());
        assert!(operation.try_lock().is_ok());
        drop(session);
        let guards = tokio::time::timeout(Duration::from_secs(1), install).await.unwrap();
        assert!(lifecycle.try_read().is_err());
        assert!(operation.try_lock().is_err());
        drop(guards);
    }

    #[tokio::test]
    async fn installation_does_not_deadlock_dictation_preparation() {
        let lifecycle = tokio::sync::RwLock::new(());
        let operation = tokio::sync::Mutex::new(());
        // Dictation takes operation before it acquires a lifecycle reader.
        let preparing = operation.lock().await;
        let install = installation_guards(&lifecycle, &operation);
        tokio::pin!(install);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut install).await.is_err());
        let session = tokio::time::timeout(Duration::from_millis(20), lifecycle.read()).await.unwrap();
        drop(preparing);
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut install).await.is_err());
        drop(session);
        assert!(tokio::time::timeout(Duration::from_secs(1), install).await.is_ok());
    }

    #[test]
    fn tauri_resolves_windows_and_macos_distribution_configs() {
        use tauri::utils::{config::parse::read_from, platform::Target};
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let (windows, _) = read_from(Target::Windows, root).unwrap();
        let _: tauri::Config = serde_json::from_value(windows.clone()).unwrap();
        assert_eq!(windows["bundle"]["targets"], serde_json::json!(["nsis"]));
        assert_eq!(windows["bundle"]["windows"]["nsis"]["installMode"], "currentUser");
        assert_eq!(windows["plugins"]["updater"]["windows"]["installMode"], "passive");
        for resource in ["../../LICENSE", "../../THIRD-PARTY-NOTICES.md", "local-text/no-tipe-text.exe", "local-text/llama.cpp-LICENSE.txt"] {
            assert!(windows["bundle"]["resources"][resource].is_string(), "{resource}");
        }
        let (macos, _) = read_from(Target::MacOS, root).unwrap();
        let _: tauri::Config = serde_json::from_value(macos.clone()).unwrap();
        for resource in ["local-text/no-tipe-text", "local-text/llama.cpp-LICENSE.txt", "../../LICENSE", "../../THIRD-PARTY-NOTICES.md", "platform/no-tipe-platform", "platform/libno-tipe-media.dylib", "platform/mediaremote-run.pl", "platform/MediaRemote-NOTICE.txt"] {
            assert!(macos["bundle"]["resources"][resource].is_string(), "{resource}");
        }
    }
    #[test]
    fn updater_reads_each_platform_from_the_shared_manifest() {
        let signature = include_str!("../tests/fixtures/update-signing.txt.sig").trim();
        let release: tauri_plugin_updater::RemoteRelease = serde_json::from_value(serde_json::json!({
            "version": "0.1.1", "notes": "New version", "pub_date": "2026-10-02T18:00:00+00:00",
            "platforms": {
                "windows-x86_64": {"signature": signature, "url": format!("https://api.github.com/repos/{RELEASE_REPOSITORY}/releases/assets/123")},
                "darwin-aarch64": {"signature": signature, "url": format!("https://api.github.com/repos/{RELEASE_REPOSITORY}/releases/assets/124")}
            }
        })).unwrap();
        assert_eq!(release.version.to_string(), "0.1.1");
        for target in ["windows-x86_64", "darwin-aarch64"] {
            assert_eq!(release.signature(target).unwrap(), signature);
            assert!(asset_url(release.download_url(target).unwrap().as_str()).is_ok());
        }
        assert!(matches!(release.download_url("darwin-x86_64"), Err(tauri_plugin_updater::Error::TargetNotFound(_))));
    }
    #[test]
    fn release_signing_key_matches_the_app_and_rejects_modified_bytes() {
        let decode = |value: &str| String::from_utf8(base64::engine::general_purpose::STANDARD.decode(value.trim()).unwrap()).unwrap();
        let key = minisign_verify::PublicKey::decode(&decode(include_str!("../../updater.pub"))).unwrap();
        let signature = minisign_verify::Signature::decode(&decode(include_str!("../tests/fixtures/update-signing.txt.sig"))).unwrap();
        let bytes = include_bytes!("../tests/fixtures/update-signing.txt");
        assert!(key.verify(bytes, &signature, true).is_ok());
        let mut tampered = bytes.to_vec(); tampered[0] ^= 1;
        assert!(key.verify(&tampered, &signature, true).is_err());
        assert!(signature.trusted_comment().contains("0.1.1"));
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config["plugins"]["updater"]["pubkey"], include_str!("../../updater.pub").trim());
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], true);
    }
    #[test]
    fn auth_header_is_sensitive_and_rejects_injection() {
        assert!(authorization("github_test_only").unwrap().is_sensitive());
        for invalid in ["", " ", "token\r\nX-Evil: value", "token with spaces"] {
            assert!(authorization(invalid).is_err());
        }
    }
    #[test]
    fn developer_key_cannot_verify_a_stable_update() {
        let decode = |value: &str| String::from_utf8(base64::engine::general_purpose::STANDARD.decode(value.trim()).unwrap()).unwrap();
        let key = minisign_verify::PublicKey::decode(&decode(include_str!("../../updater-dev.pub"))).unwrap();
        let signature = minisign_verify::Signature::decode(&decode(include_str!("../tests/fixtures/update-signing.txt.sig"))).unwrap();
        assert!(key.verify(include_bytes!("../tests/fixtures/update-signing.txt"), &signature, true).is_err());
    }
    #[test]
    fn update_assets_are_locked_to_the_compiled_channel() {
        let url = format!("https://api.github.com/repos/{RELEASE_REPOSITORY}/releases/assets/123");
        assert!(asset_url(&url).is_ok());
        assert!(asset_url(&url.replace(RELEASE_REPOSITORY, &RELEASE_REPOSITORY.to_uppercase())).is_ok());
        let other = if crate::channel::DEVELOPER { "no-tipe-releases" } else { "no-tipe-dev-releases" };
        assert!(asset_url(&format!("https://api.github.com/repos/Darlingfxx02/{other}/releases/assets/123")).is_err());
        for value in [
            "https://api.github.com/repos/Darlingfxx02/no-tipe/releases/assets/123",
            "https://api.github.com/repos/other/app/releases/assets/123",
            "https://evil.test/repos/Darlingfxx02/no-tipe-releases/releases/assets/123",
            "http://api.github.com/repos/Darlingfxx02/no-tipe-releases/releases/assets/123",
            "https://api.github.com/repos/Darlingfxx02/no-tipe-releases/releases/assets/123?redirect=x",
            "https://user@api.github.com/repos/Darlingfxx02/no-tipe-releases/releases/assets/123",
            "https://api.github.com:444/repos/Darlingfxx02/no-tipe-releases/releases/assets/123",
            "https://api.github.com/repos/Darlingfxx02/no-tipe-releases/releases/assets/123#redirect",
            "https://api.github.com/repos/Darlingfxx02/no-tipe-releases/releases/assets/",
        ] { assert!(asset_url(value).is_err(), "{value}"); }
    }
}
