//! Downloads stay separate from installed weights until size, digest and format checks pass.
use crate::{
    model_hub::{self, Asset, Kind},
    store::err,
};
use futures_util::StreamExt;
use reqwest::{header, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const RESERVE: u64 = 64 * 1024 * 1024;
const MAX_SIZE: u64 = 100_000_000_000;
const MAX_ATTEMPTS: usize = 5;
static DOWNLOAD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ACTIVE: Mutex<Option<(Status, tokio::sync::watch::Sender<bool>)>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub id: String,
    pub phase: String,
    pub done: u64,
    pub total: u64,
    pub resumable: bool,
}
pub struct Operation {
    id: String,
    cancel: tokio::sync::watch::Receiver<bool>,
    _lock: tokio::sync::MutexGuard<'static, ()>,
}
impl Operation {
    pub fn begin(id: &str) -> Result<Self, String> {
        let lock = DOWNLOAD
            .try_lock()
            .map_err(|_| "Another model is downloading. Wait or cancel it first.")?;
        let (sender, cancel) = tokio::sync::watch::channel(false);
        *ACTIVE.lock().map_err(err)? = Some((
            Status {
                id: id.into(),
                phase: "preparing".into(),
                done: 0,
                total: 0,
                resumable: false,
            },
            sender,
        ));
        Ok(Self {
            id: id.into(),
            cancel,
            _lock: lock,
        })
    }
    pub fn update(&self, phase: &str, done: u64, total: u64, resumable: bool) {
        if let Ok(mut active) = ACTIVE.lock() {
            if let Some((status, _)) = active.as_mut().filter(|(s, _)| s.id == self.id) {
                *status = Status {
                    id: self.id.clone(),
                    phase: phase.into(),
                    done,
                    total,
                    resumable,
                };
            }
        }
    }
    pub fn check(&self) -> Result<(), String> {
        if *self.cancel.borrow() {
            Err("Model download canceled".into())
        } else {
            Ok(())
        }
    }
    async fn canceled(&self) {
        let mut receiver = self.cancel.clone();
        while !*receiver.borrow() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            if active.as_ref().is_some_and(|(s, _)| s.id == self.id) {
                *active = None;
            }
        }
    }
}
pub fn cancel(id: &str) -> Result<(), String> {
    if let Some((_, sender)) = ACTIVE
        .lock()
        .map_err(err)?
        .as_ref()
        .filter(|(s, _)| s.id == id)
    {
        let _ = sender.send(true);
    }
    Ok(())
}
pub fn active() -> Option<Status> {
    ACTIVE
        .lock()
        .ok()
        .and_then(|a| a.as_ref().map(|(s, _)| s.clone()))
}

#[derive(Clone, Serialize, Deserialize)]
struct Partial {
    source: String,
    size: Option<u64>,
    sha256: Option<String>,
    etag: Option<String>,
    total: u64,
}
fn source_identity(url: &str) -> String {
    format!("{:x}", Sha256::digest(url.as_bytes()))
}
fn pending(path: &Path) -> PathBuf {
    path.with_extension("part")
}
fn metadata(path: &Path) -> PathBuf {
    path.with_extension("part.json")
}
pub fn discard(path: &Path) {
    let _ = std::fs::remove_file(pending(path));
    let _ = std::fs::remove_file(metadata(path));
}
fn read_partial(
    path: &Path,
    url: &str,
    size: Option<u64>,
    sha256: Option<&str>,
) -> Option<(Partial, u64)> {
    if std::fs::metadata(metadata(path)).ok()?.len() > 16 * 1024 {
        return None;
    }
    let info: Partial = serde_json::from_slice(&std::fs::read(metadata(path)).ok()?).ok()?;
    let bytes = std::fs::metadata(pending(path)).ok()?.len();
    if info.source != source_identity(url)
        || info.size != size
        || info.sha256.as_deref() != sha256
        || bytes == 0
        || bytes > MAX_SIZE
        || info.total > 0 && bytes > info.total
    {
        return None;
    }
    if sha256.is_none() && info.etag.as_deref().is_none_or(|e| !strong_etag(e)) {
        return None;
    }
    Some((info, bytes))
}
fn strong_etag(value: &str) -> bool {
    value.len() >= 2
        && value.starts_with('"')
        && value.ends_with('"')
        && value.as_bytes()[1..value.len() - 1]
            .iter()
            .all(|c| *c == 0x21 || (0x23..=0x7e).contains(c) || *c >= 0x80)
}
pub fn partial_status(
    id: &str,
    path: &Path,
    url: &str,
    size: Option<u64>,
    sha256: Option<&str>,
) -> Option<Status> {
    read_partial(path, url, size, sha256).map(|(p, done)| Status {
        id: id.into(),
        phase: "paused".into(),
        done,
        total: p.total,
        resumable: true,
    })
}

#[cfg(unix)]
pub fn available_space(path: &Path) -> Result<u64, String> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(err)?;
    let mut info = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    if unsafe { libc::statvfs(path.as_ptr(), info.as_mut_ptr()) } != 0 {
        return Err(err(std::io::Error::last_os_error()));
    }
    let info = unsafe { info.assume_init() };
    Ok((info.f_bavail as u64).saturating_mul(info.f_frsize as u64))
}
#[cfg(windows)]
pub fn available_space(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            path: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0;
    if unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(err(std::io::Error::last_os_error()));
    }
    Ok(available)
}
fn check_space(free: u64, remaining: u64) -> Result<(), String> {
    let required = remaining.saturating_add(RESERVE);
    if free < required {
        return Err(format!("Not enough disk space: {:.2} GB available, {:.2} GB needed including a 64 MiB safety reserve. Free space and retry.",free as f64/1e9,required as f64/1e9));
    }
    Ok(())
}
pub fn ensure_space(path: &Path, remaining: u64) -> Result<(), String> {
    check_space(available_space(path)?, remaining)
}
fn range(value: &str) -> Option<(u64, u64, u64)> {
    let (bounds, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = bounds.split_once('-')?;
    let (start, end, total) = (start.parse().ok()?, end.parse().ok()?, total.parse().ok()?);
    if start > end || end >= total {
        None
    } else {
        Some((start, end, total))
    }
}
fn checksum(size: u64, sha256: &str, done: u64, sha: &str) -> Result<(), String> {
    if done != size || !sha.eq_ignore_ascii_case(sha256) {
        return Err("Model checksum mismatch; the download was not installed. Retry to download a fresh copy.".into());
    }
    Ok(())
}

// Network interruptions can be retried, while validation and local I/O errors
// must stop immediately. Keeping this distinction avoids redownloading corrupt
// weights or repeatedly trying to write to a full/read-only disk.
#[derive(Debug)]
struct Failure {
    message: String,
    retryable: bool,
}
impl From<String> for Failure {
    fn from(message: String) -> Self {
        Self {
            message,
            retryable: false,
        }
    }
}
impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        message.to_owned().into()
    }
}
fn network_failure(error: reqwest::Error) -> Failure {
    let status = error.status();
    let transient = status.map_or_else(
        || {
            error.is_connect()
                || error.is_timeout()
                || error.is_body()
                || error.is_decode()
                || error.is_request()
        },
        |status| matches!(status.as_u16(), 408 | 429 | 500 | 502 | 503 | 504),
    );
    let error = error.without_url();
    let mut reason: &dyn std::error::Error = &error;
    let mut parts = vec![reason.to_string()];
    while let Some(source) = reason.source() {
        let detail = source.to_string();
        if parts.last() != Some(&detail) {
            parts.push(detail);
        }
        reason = source;
    }
    // Redirects can contain signed CDN URLs. Preserve the TLS/HTTP cause, never
    // authentication parameters, in the UI and diagnostic log.
    let detail = regex::Regex::new(r#"https?://[^\s<>\"']+"#)
        .unwrap()
        .replace_all(&parts.join(": "), "[download source]")
        .into_owned();
    let certificate_error = detail.to_ascii_lowercase().contains("certificate");
    Failure {
        message: crate::localization::message_with_values(
            "native.model_download_network",
            serde_json::json!({"detail": detail}),
        ),
        retryable: transient && !certificate_error,
    }
}
// Pinned catalog files can be resumed with their final SHA-256 as the validator.
// Other links require a strong ETag and If-Range. A 200 response restarts safely.
pub async fn transfer(
    client: &reqwest::Client,
    path: &Path,
    url: &str,
    size: Option<u64>,
    sha256: Option<&str>,
    operation: &Operation,
    progress: impl Fn(u64, u64) + Send + Sync,
) -> Result<u64, String> {
    for attempt in 0..MAX_ATTEMPTS {
        operation.check()?;
        let failure =
            match transfer_inner(client, path, url, size, sha256, operation, &progress).await {
                Ok(done) => return Ok(done),
                Err(failure) => failure,
            };
        let partial = read_partial(path, url, size, sha256);
        if partial.is_none() {
            discard(path);
        }
        if !failure.retryable || attempt + 1 == MAX_ATTEMPTS {
            return Err(failure.message);
        }
        let (done, total) = partial
            .as_ref()
            .map_or((0, size.unwrap_or(0)), |(p, n)| (*n, p.total));
        operation.update("preparing", done, total, partial.is_some());
        progress(done, total);
        let delay = Duration::from_millis(500 * (1 << attempt));
        tokio::select! {
            _ = tokio::time::sleep(delay) => {},
            _ = operation.canceled() => return Err("Model download canceled".into()),
        }
    }
    unreachable!("download attempts are bounded")
}
async fn transfer_inner(
    client: &reqwest::Client,
    path: &Path,
    url: &str,
    size: Option<u64>,
    sha256: Option<&str>,
    operation: &Operation,
    progress: impl Fn(u64, u64) + Send + Sync,
) -> Result<u64, Failure> {
    let folder = path.parent().ok_or("Invalid model path")?;
    tokio::fs::create_dir_all(folder).await.map_err(err)?;
    let saved = read_partial(path, url, size, sha256);
    if saved.is_none() {
        discard(path);
    }
    let mut done = saved.as_ref().map_or(0, |(_, n)| *n);
    operation.update(
        "preparing",
        done,
        size.unwrap_or_else(|| saved.as_ref().map_or(0, |(p, _)| p.total)),
        saved.is_some(),
    );
    if let Some(size) = size {
        ensure_space(folder, size.saturating_sub(done))?;
    }
    operation.check()?;
    // Complete pinned partial files can proceed directly to digest verification.
    if !(sha256.is_some() && size == Some(done)) {
        let mut request = client.get(url).header(header::ACCEPT_ENCODING, "identity");
        if done > 0 {
            request = request.header(header::RANGE, format!("bytes={done}-"));
            if let Some(etag) = saved.as_ref().and_then(|(p, _)| p.etag.as_ref()) {
                request = request.header(header::IF_RANGE, etag);
            }
        }
        let response = tokio::select! { result=request.send()=>result.map_err(network_failure)?, _=operation.canceled()=>return Err("Model download canceled".into()) };
        if response.url().scheme() != "https"
            && !(cfg!(test) && response.url().host_str() == Some("127.0.0.1"))
        {
            return Err("The model download redirected to an insecure link".into());
        }
        if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            discard(path);
            return Err(
                "The source no longer accepts this partial download. Retry to start again.".into(),
            );
        }
        let response = response.error_for_status().map_err(network_failure)?;
        if response
            .headers()
            .get(header::CONTENT_ENCODING)
            .is_some_and(|v| v != "identity")
        {
            discard(path);
            return Err(
                "The source returned an encoded model file. Use a direct download link.".into(),
            );
        }
        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
            .filter(|v| strong_etag(v))
            .map(str::to_owned);
        let total = if response.status() == StatusCode::PARTIAL_CONTENT {
            let received = response
                .headers()
                .get(header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(range);
            let valid = received.is_some_and(|(start, end, total)| {
                start == done
                    && end + 1 == total
                    && saved
                        .as_ref()
                        .is_none_or(|(p, _)| p.total == 0 || p.total == total)
                    && size.is_none_or(|s| s == total)
                    && response
                        .content_length()
                        .is_none_or(|len| len == total - done)
            });
            let validator = sha256.is_some()
                || saved
                    .as_ref()
                    .is_some_and(|(p, _)| p.etag == etag && etag.is_some());
            if done == 0 || !valid || !validator {
                discard(path);
                return Err(
                    "Invalid download range or changed source. Retry to download a fresh copy."
                        .into(),
                );
            }
            received.unwrap().2
        } else if response.status() == StatusCode::OK {
            done = 0;
            let length = response.content_length().unwrap_or(0);
            if size.is_some_and(|s| length > 0 && s != length) {
                discard(path);
                return Err("The source size differs from the verified model metadata".into());
            }
            size.unwrap_or(length)
        } else {
            return Err("The source did not return a model file".into());
        };
        if total > MAX_SIZE {
            discard(path);
            return Err("The model file exceeds the supported 100 GB limit".into());
        }
        ensure_space(folder, total.saturating_sub(done))?;
        // A restarted response must not attach new metadata to an old prefix.
        if done == 0 {
            discard(path);
        }
        let info = Partial {
            source: source_identity(url),
            size,
            sha256: sha256.map(str::to_owned),
            etag,
            total,
        };
        tokio::fs::write(metadata(path), serde_json::to_vec(&info).map_err(err)?)
            .await
            .map_err(err)?;
        let resumable = sha256.is_some() || info.etag.is_some();
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(done == 0)
            .append(done > 0)
            .open(pending(path))
            .await
            .map_err(err)?;
        operation.update("downloading", done, total, resumable);
        progress(done, total);
        let mut stream = response.bytes_stream();
        let mut last = Instant::now();
        let mut space_at = done;
        loop {
            let next = tokio::select! {result=stream.next()=>result, _=operation.canceled()=>{file.sync_all().await.map_err(err)?;return Err("Model download canceled".into());}};
            let Some(chunk) = next else { break };
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = file.sync_all().await;
                    return Err(network_failure(error));
                }
            };
            let next = done.saturating_add(chunk.len() as u64);
            if next > MAX_SIZE || total > 0 && next > total {
                let _ = file.sync_all().await;
                drop(file);
                discard(path);
                return Err("The downloaded model is larger than its metadata".into());
            }
            if done == 0 || done - space_at >= 8 * 1024 * 1024 {
                if let Err(error) =
                    ensure_space(folder, (chunk.len() as u64).max(total.saturating_sub(done)))
                {
                    let _ = file.sync_all().await;
                    return Err(error.into());
                }
                space_at = done;
            }
            if let Err(error) = file.write_all(&chunk).await {
                let _ = file.sync_all().await;
                return Err(err(error).into());
            }
            done = next;
            if last.elapsed().as_millis() > 150 {
                operation.update("downloading", done, total, resumable);
                progress(done, total);
                last = Instant::now();
            }
        }
        file.sync_all().await.map_err(err)?;
        drop(file);
        if total > 0 && done != total {
            return Err(Failure {
                message: crate::localization::message("native.model_download_incomplete"),
                retryable: true,
            });
        }
    }
    operation.update("verifying", done, done, false);
    progress(done, done);
    operation.check()?;
    if let (Some(size), Some(expected)) = (size, sha256) {
        let mut file = tokio::fs::File::open(pending(path)).await.map_err(err)?;
        let mut hash = Sha256::new();
        let mut buffer = vec![0; 1024 * 1024];
        loop {
            operation.check()?;
            let n = file.read(&mut buffer).await.map_err(err)?;
            if n == 0 {
                break;
            }
            hash.update(&buffer[..n]);
        }
        if let Err(e) = checksum(size, expected, done, &format!("{:x}", hash.finalize())) {
            discard(path);
            return Err(e.into());
        }
    }
    Ok(done)
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent("NoType-ModelDownload/1")
        .timeout(Duration::from_secs(7200))
        .build()
        .map_err(err)
}
pub async fn finish(path: &Path) -> Result<(), String> {
    if path.exists() {
        tokio::fs::remove_file(path).await.map_err(err)?;
    }
    tokio::fs::rename(pending(path), path).await.map_err(err)?;
    let _ = tokio::fs::remove_file(metadata(path)).await;
    Ok(())
}
pub async fn install(
    root: &Path,
    asset: &Asset,
    progress: impl Fn(u64, u64) + Send + Sync,
) -> Result<(), String> {
    asset.validate()?;
    if asset.installed(root) {
        return Ok(());
    }
    let operation = Operation::begin(&asset.id())?;
    let path = match asset.kind {
        Kind::Speech => root.join("models").join(&asset.file),
        Kind::Text => crate::text_models::model_path(root, &asset.id())?,
    };
    transfer(
        &client()?,
        &path,
        &asset.url(),
        Some(asset.size),
        Some(&asset.sha256),
        &operation,
        progress,
    )
    .await?;
    let valid = match asset.kind {
        Kind::Speech => model_hub::whisper_file(&pending(&path)),
        Kind::Text => crate::text_models::gguf(&pending(&path)),
    };
    if let Err(e) = valid {
        discard(&path);
        return Err(e);
    }
    operation.check()?;
    finish(&path).await?;
    model_hub::remember_install(root, asset)?;
    Ok(())
}
pub fn statuses(store: &crate::store::Store) -> Result<Vec<Status>, String> {
    let mut states = Vec::new();
    for asset in model_hub::assets(&store.root, Kind::Speech)
        .into_iter()
        .chain(model_hub::assets(&store.root, Kind::Text))
    {
        if !asset.files.is_empty() {
            if asset.id() != crate::gigaam::ID {
                if let Some(state) = crate::speech_bundle::status(&store.root, &asset) {
                    states.push(state);
                }
            }
            continue;
        }
        let path = match asset.kind {
            Kind::Speech => store.root.join("models").join(&asset.file),
            Kind::Text => crate::text_models::model_path(&store.root, &asset.id())?,
        };
        if let Some(state) = partial_status(
            &asset.id(),
            &path,
            &asset.url(),
            Some(asset.size),
            Some(&asset.sha256),
        ) {
            states.push(state);
        }
    }
    for model in store
        .list::<crate::domain::Model>("models")?
        .into_iter()
        .filter(|m| m.provider == crate::text_models::PROVIDER)
    {
        if let Some(url) = model.download_url {
            if let Some(state) = partial_status(
                &model.id,
                &crate::text_models::model_path(&store.root, &model.id)?,
                &url,
                None,
                None,
            ) {
                states.push(state);
            }
        }
    }
    if let Some(gigaam) = crate::gigaam::download_status(&store.root) {
        states.push(gigaam);
    }
    if let Some(active) = active() {
        states.retain(|s| s.id != active.id);
        states.push(active);
    }
    Ok(states)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    #[tokio::test]
    #[ignore = "downloads and verifies the public Whisper Turbo model; keeps installed user weights"]
    async fn live_whisper_turbo_download_is_verified() {
        let root = PathBuf::from(
            std::env::var_os("NO_TYPE_DOWNLOAD_SMOKE_ROOT")
                .expect("Set NO_TYPE_DOWNLOAD_SMOKE_ROOT to the application data directory"),
        );
        let asset = model_hub::asset(&root, "whisper-large-v3-turbo").unwrap();
        install(&root, &asset, |done, total| {
            if done == total {
                println!("Downloaded {done}/{total} bytes; verifying model");
            }
        })
        .await
        .unwrap();
        assert!(asset.installed(&root));
        let mut file = tokio::fs::File::open(root.join("models").join(&asset.file))
            .await
            .unwrap();
        let mut hash = Sha256::new();
        let mut buffer = vec![0; 1024 * 1024];
        loop {
            let count = file.read(&mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        assert_eq!(format!("{:x}", hash.finalize()), asset.sha256);
        println!("Whisper Turbo is installed with its pinned SHA-256");
    }
    #[test]
    fn integrity_ranges_and_space_are_checked() {
        assert!(checksum(64, &"a".repeat(64), 63, &"a".repeat(64)).is_err());
        assert!(checksum(64, &"a".repeat(64), 64, &"b".repeat(64)).is_err());
        assert!(checksum(64, &"a".repeat(64), 64, &"A".repeat(64)).is_ok());
        assert_eq!(range("bytes 32-63/64"), Some((32, 63, 64)));
        for value in [
            "bytes 64-63/64",
            "bytes 0-64/64",
            "bytes 0-63/*",
            "items 0-63/64",
        ] {
            assert!(range(value).is_none());
        }
        assert!(strong_etag("\"abc\""));
        assert!(!strong_etag("W/\"abc\""));
        assert!(check_space(RESERVE + 99, 100).is_err());
        assert!(check_space(RESERVE + 100, 100).is_ok());
        assert!(available_space(&std::env::temp_dir()).unwrap() > 0);
        assert!(!crate::gigaam::REPOSITORY.ends_with("main"));
        assert!(crate::gigaam::assets()
            .iter()
            .all(|a| a.sha256.len() == 64 && a.sha256.bytes().all(|b| b.is_ascii_hexdigit())));
    }
    fn server(
        responses: Vec<(String, Vec<u8>, Duration)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (headers, body, delay) in responses {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                requests.push(String::from_utf8(request).unwrap().to_lowercase());
                socket.write_all(headers.as_bytes()).unwrap();
                socket.write_all(&body).unwrap();
                if !delay.is_zero() {
                    std::thread::sleep(delay);
                }
            }
            requests
        });
        (url, worker)
    }
    fn headers(status: &str, length: usize, extra: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Length: {length}\r\nConnection: close\r\n{extra}\r\n")
    }
    fn save_partial(
        path: &Path,
        url: &str,
        body: &[u8],
        size: Option<u64>,
        sha: Option<&str>,
        etag: Option<&str>,
        total: u64,
    ) {
        std::fs::write(pending(path), body).unwrap();
        std::fs::write(
            metadata(path),
            serde_json::to_vec(&Partial {
                source: source_identity(url),
                size,
                sha256: sha.map(str::to_owned),
                etag: etag.map(str::to_owned),
                total,
            })
            .unwrap(),
        )
        .unwrap();
    }
    #[tokio::test]
    async fn small_http_fixtures_cover_resume_restart_cancel_and_corruption() {
        let root =
            std::env::temp_dir().join(format!("no-tipe-resume-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("test.bin");
        let body = vec![42; 8192];
        let sha = format!("{:x}", Sha256::digest(&body));
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        let (url, worker) = server(vec![
            (
                headers("200 OK", body.len(), "ETag: \"v1\"\r\n"),
                body[..4096].to_vec(),
                Duration::ZERO,
            ),
            (
                headers(
                    "206 Partial Content",
                    4096,
                    "Content-Range: bytes 4096-8191/8192\r\nETag: \"v1\"\r\n",
                ),
                body[4096..].to_vec(),
                Duration::ZERO,
            ),
        ]);
        let op = Operation::begin("fixture").unwrap();
        assert!(Operation::begin("second").is_err());
        assert_eq!(
            transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {})
                .await
                .unwrap(),
            8192
        );
        finish(&path).await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), body);
        assert!(!metadata(&path).exists());
        let requests = worker.join().unwrap();
        assert!(requests[1].contains("range: bytes=4096-"));
        assert!(requests[1].contains("if-range: \"v1\""));
        drop(op);
        assert!(active().is_none());
        // Transient HTTP failures are retried, and all successful bytes still
        // pass the same digest verification before installation.
        let (url, worker) = server(vec![
            (
                headers("503 Service Unavailable", 0, ""),
                vec![],
                Duration::ZERO,
            ),
            (
                headers("200 OK", body.len(), ""),
                body.clone(),
                Duration::ZERO,
            ),
        ]);
        let op = Operation::begin("fixture").unwrap();
        assert_eq!(
            transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {})
                .await
                .unwrap(),
            8192
        );
        assert_eq!(worker.join().unwrap().len(), 2);
        drop(op);
        discard(&path);
        // A missing/forbidden source is permanent: do not hide it behind retries.
        let (url, worker) = server(vec![(
            headers("404 Not Found", 0, ""),
            vec![],
            Duration::ZERO,
        )]);
        let op = Operation::begin("fixture").unwrap();
        let started = Instant::now();
        let failure = transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {})
            .await
            .unwrap_err();
        assert!(failure.contains("native.model_download_network") && failure.contains("404"));
        assert!(!failure.contains(&url));
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(worker.join().unwrap().len(), 1);
        drop(op);
        // Cancellation during retry backoff must stop without another request.
        let (url, worker) = server(vec![(
            headers("503 Service Unavailable", 0, ""),
            vec![],
            Duration::ZERO,
        )]);
        let op = Operation::begin("fixture").unwrap();
        let started = Instant::now();
        assert_eq!(
            transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {
                if active().is_some_and(|s| s.phase == "preparing") {
                    cancel("fixture").unwrap();
                }
            })
            .await
            .unwrap_err(),
            "Model download canceled"
        );
        assert!(started.elapsed() < Duration::from_millis(500));
        assert_eq!(worker.join().unwrap().len(), 1);
        drop(op);
        // After bounded retries, preserve a validated prefix for the user's
        // next attempt and include the underlying connection cause.
        let mut responses = vec![(
            headers("200 OK", 8192, ""),
            body[..32].to_vec(),
            Duration::ZERO,
        )];
        responses.extend((1..MAX_ATTEMPTS).map(|_| {
            (
                headers("503 Service Unavailable", 0, ""),
                vec![],
                Duration::ZERO,
            )
        }));
        let (url, worker) = server(responses);
        let op = Operation::begin("fixture").unwrap();
        let failure = transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {})
            .await
            .unwrap_err();
        assert!(failure.contains("native.model_download_network") && failure.contains("503"));
        assert_eq!(
            read_partial(&path, &url, Some(8192), Some(&sha)).unwrap().1,
            32
        );
        assert_eq!(worker.join().unwrap().len(), MAX_ATTEMPTS);
        assert!(!path.exists() || std::fs::read(&path).unwrap() == body);
        drop(op);
        discard(&path);
        // Source changed or ignores Range: replace the prefix, never append a full response.
        let (url, worker) = server(vec![(
            headers("200 OK", body.len(), "ETag: \"v2\"\r\n"),
            body.clone(),
            Duration::ZERO,
        )]);
        save_partial(&path, &url, &[0; 32], None, None, Some("\"v1\""), 8192);
        let op = Operation::begin("fixture").unwrap();
        transfer(&client, &path, &url, None, None, &op, |_, _| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(pending(&path)).unwrap(), body);
        worker.join().unwrap();
        drop(op);
        discard(&path);
        // Unpinned links can resume only with an unchanged strong ETag.
        let (url, worker) = server(vec![(
            headers(
                "206 Partial Content",
                8160,
                "Content-Range: bytes 32-8191/8192\r\nETag: \"v1\"\r\n",
            ),
            body[32..].to_vec(),
            Duration::ZERO,
        )]);
        save_partial(&path, &url, &body[..32], None, None, Some("\"v1\""), 8192);
        let op = Operation::begin("fixture").unwrap();
        transfer(&client, &path, &url, None, None, &op, |_, _| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(pending(&path)).unwrap(), body);
        worker.join().unwrap();
        drop(op);
        discard(&path);
        // Interrupted links without a validator are cleaned up rather than offered as resumable.
        let (url, worker) = server(vec![(
            headers("200 OK", 8192, ""),
            body[..32].to_vec(),
            Duration::ZERO,
        )]);
        let op = Operation::begin("fixture").unwrap();
        assert!(transfer(&client, &path, &url, None, None, &op, |_, _| {})
            .await
            .is_err());
        assert!(!pending(&path).exists());
        assert!(!metadata(&path).exists());
        worker.join().unwrap();
        drop(op);
        // Invalid ranges are discarded before any mixed weights can be installed.
        let (url, worker) = server(vec![(
            headers(
                "206 Partial Content",
                8160,
                "Content-Range: bytes 31-8190/8192\r\n",
            ),
            body[32..].to_vec(),
            Duration::ZERO,
        )]);
        save_partial(&path, &url, &body[..32], Some(8192), Some(&sha), None, 8192);
        let op = Operation::begin("fixture").unwrap();
        assert!(
            transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {})
                .await
                .is_err()
        );
        assert!(!pending(&path).exists());
        worker.join().unwrap();
        drop(op);
        // Unpinned ranges must keep both the validator and the known total.
        for (total, etag) in [(9000, "v1"), (8192, "v2")] {
            let extra = format!(
                "Content-Range: bytes 32-{}/{total}\r\nETag: \"{etag}\"\r\n",
                total - 1
            );
            let (url, worker) = server(vec![(
                headers("206 Partial Content", total - 32, &extra),
                vec![42; total - 32],
                Duration::ZERO,
            )]);
            save_partial(&path, &url, &body[..32], None, None, Some("\"v1\""), 8192);
            let op = Operation::begin("fixture").unwrap();
            assert!(transfer(&client, &path, &url, None, None, &op, |_, _| {})
                .await
                .is_err());
            assert!(!pending(&path).exists());
            worker.join().unwrap();
            drop(op);
        }
        // Digest verification includes the saved prefix; corrupt weights are removed.
        save_partial(
            &path,
            "https://example.test/model",
            &vec![0; 8192],
            Some(8192),
            Some(&sha),
            None,
            8192,
        );
        let op = Operation::begin("fixture").unwrap();
        assert!(transfer(
            &client,
            &path,
            "https://example.test/model",
            Some(8192),
            Some(&sha),
            &op,
            |_, _| {}
        )
        .await
        .unwrap_err()
        .contains("checksum"));
        assert!(!pending(&path).exists());
        drop(op);
        // Cancellation works while the server stalls, and leaves only a resumable partial.
        let (url, worker) = server(vec![(
            headers("200 OK", 8192, "ETag: \"v1\"\r\n"),
            body[..4096].to_vec(),
            Duration::from_millis(400),
        )]);
        let op = Operation::begin("fixture").unwrap();
        let cancel_task = tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(40)).await;
            cancel("fixture").unwrap();
        });
        assert_eq!(
            transfer(&client, &path, &url, Some(8192), Some(&sha), &op, |_, _| {})
                .await
                .unwrap_err(),
            "Model download canceled"
        );
        cancel_task.await.unwrap();
        assert_eq!(
            read_partial(&path, &url, Some(8192), Some(&sha)).unwrap().1,
            4096
        );
        worker.join().unwrap();
        drop(op);
        // A catalog revision/checksum change or weak validator prevents resuming old bytes.
        assert!(read_partial(&path, &url, Some(8192), Some(&"f".repeat(64))).is_none());
        save_partial(&path, &url, &body[..32], None, None, Some("W/\"v1\""), 8192);
        assert!(read_partial(&path, &url, None, None).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    #[ignore = "downloads Tiny/Base and a public speech sample; exercises production recognition and removes test files"]
    async fn live_whisper_download_is_verified_and_survives_cache_loss() {
        let root =
            std::env::temp_dir().join(format!("no-tipe-Whisper-Русский-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        // Optional verified fixtures avoid repeated network downloads while
        // debugging. Copy only weights into this disposable test directory.
        if let Some(cache) = std::env::var_os("NO_TIPE_WHISPER_TEST_CACHE") {
            for id in ["whisper-tiny", "whisper-base"] {
                let asset = model_hub::asset(&root, id).unwrap();
                let source = PathBuf::from(&cache).join(&asset.file);
                let bytes = std::fs::read(&source).unwrap();
                assert_eq!(bytes.len() as u64, asset.size);
                assert_eq!(format!("{:x}", Sha256::digest(&bytes)), asset.sha256);
                std::fs::copy(source, root.join("models").join(&asset.file)).unwrap();
                model_hub::remember_install(&root, &asset).unwrap();
            }
        }
        let asset = model_hub::asset(&root, "whisper-tiny").unwrap();
        install(&root, &asset, |_, _| {}).await.unwrap();
        assert!(asset.installed(&root));
        crate::models::ensure_default(&store, Some(&asset.id())).unwrap();
        // Public-domain JFK speech used by whisper.cpp's own example. Pin the
        // release and checksum so this is reproducible without private audio.
        let sample = client()
            .unwrap()
            .get("https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.3/samples/jfk.wav")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(&sample)),
            "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e"
        );
        let audio = root.join("speech.wav");
        std::fs::write(&audio, &sample).unwrap();
        let samples = crate::audio::decode(&audio).unwrap();
        let base = model_hub::asset(&root, "whisper-base").unwrap();
        install(&root, &base, |_, _| {}).await.unwrap();
        // Use the production context/cache, recognition parameters and model
        // switch, rather than merely checking that a context can be created.
        for id in ["whisper-tiny", "whisper-base", "whisper-tiny"] {
            let preferences = crate::models::select(&store, id).unwrap();
            let session =
                crate::session::RecordingSession::resolve(&store, preferences, None, false)
                    .unwrap();
            let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            crate::providers::prepare_local(&session.model, cancel.clone())
                .await
                .unwrap();
            let text = crate::providers::transcribe(
                &session.model,
                &audio,
                samples.clone(),
                "auto",
                &[],
                cancel,
            )
            .await
            .unwrap()
            .to_lowercase();
            assert!(
                text.contains("ask") && text.contains("country"),
                "{id} returned an unexpected transcript"
            );
        }
        let preferences = store.preferences().unwrap();
        let session =
            crate::session::RecordingSession::resolve(&store, preferences, None, false).unwrap();
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let abort = cancel.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(40)).await;
            abort.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        let error = crate::providers::transcribe(
            &session.model,
            &audio,
            samples.repeat(4),
            "auto",
            &[],
            cancel,
        )
        .await
        .unwrap_err();
        task.await.unwrap();
        assert_eq!(error, "Canceled");
        // A genuine abort must not leave a canceled callback in the reused
        // engine. This also exercises the progressive file-recognition path.
        let partial = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = partial.clone();
        let progress: crate::providers::SpeechProgress =
            std::sync::Arc::new(move |text, _| captured.lock().unwrap().push(text));
        let text = crate::providers::transcribe_progress(
            &session.model,
            &audio,
            samples,
            "en",
            &[],
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            Some(progress),
        )
        .await
        .unwrap();
        assert!(text.to_lowercase().contains("country"));
        assert!(partial
            .lock()
            .unwrap()
            .last()
            .is_some_and(|p| p.contains("country")));
        crate::providers::unload_whisper().unwrap();
        std::fs::remove_file(root.join("model-hub/catalog-v1.json")).unwrap();
        assert!(model_hub::asset(&root, &asset.id())
            .unwrap()
            .installed(&root));
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
}
