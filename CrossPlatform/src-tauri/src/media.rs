//! Own a media pause only for the lifetime of a recording. Explicit commands
//! and session identity keep already-paused or newly selected players untouched.
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
static NEXT: AtomicU64 = AtomicU64::new(1);
static ACTIVE: AtomicU64 = AtomicU64::new(0);
static PAUSED: Mutex<Option<Playback>> = Mutex::new(None);
#[derive(Clone, Debug, PartialEq)]
struct Playback { application: String, track: String, playing: bool }
impl Playback {
    fn same_item(&self, other: &Self) -> bool { self.application == other.application && self.track == other.track }
}
pub struct MediaSession(u64);
impl Drop for MediaSession {
    fn drop(&mut self) {
        if ACTIVE.compare_exchange(self.0, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok() { reconcile_async(); }
    }
}
pub fn pause_on_start(enabled: bool) -> Option<MediaSession> {
    if !enabled { return None; }
    let id = NEXT.fetch_add(1, Ordering::SeqCst);
    ACTIVE.store(id, Ordering::SeqCst);
    reconcile_async();
    Some(MediaSession(id))
}
fn reconcile_async() {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(mut owned) = PAUSED.lock() else { return; };
        let result: Result<(), String> = (|| {
            if ACTIVE.load(Ordering::SeqCst) != 0 {
                if owned.is_none() {
                    if let Some(current) = playback()? {
                        if current.playing && ACTIVE.load(Ordering::SeqCst) != 0 && command(false)? {
                            *owned = Some(current);
                        }
                    }
                }
            } else if let Some(previous) = owned.take() {
                if let Some(current) = playback()? {
                    if previous.same_item(&current) && !current.playing && ACTIVE.load(Ordering::SeqCst) == 0 {
                        command(true)?;
                    } else if ACTIVE.load(Ordering::SeqCst) != 0 { *owned = Some(previous); }
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            crate::diagnostics::record("warn", "media", "control.unavailable", serde_json::json!({"error":error}));
            eprintln!("Media control unavailable: {error}");
        }
    });
}
#[cfg(target_os = "macos")]
fn playback() -> Result<Option<Playback>, String> {
    use std::process::{Command, Stdio};
    use crate::store::err;
    let mut child = Command::new("/usr/bin/perl")
        .arg(crate::platform::resource_path("platform/mediaremote-run.pl"))
        .arg(crate::platform::resource_path("platform/libno-tipe-media.dylib"))
        .arg("get").stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(err)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while child.try_wait().map_err(err)?.is_none() {
        if std::time::Instant::now() > deadline { let _ = child.kill(); let _ = child.wait(); return Ok(None); }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let output = child.wait_with_output().map_err(err)?;
    // The bundled adapter exports only identity and state (no artwork/history).
    let value: serde_json::Value = match serde_json::from_slice(&output.stdout) { Ok(v)=>v, Err(_)=>return Ok(None) };
    let p = &value["payload"];
    let Some(application) = p["bundleIdentifier"].as_str().filter(|s|!s.is_empty()) else { return Ok(None); };
    let track = ["uniqueIdentifier", "contentItemIdentifier", "title"].iter()
        .find_map(|key|p[*key].as_str()).unwrap_or_default();
    Ok(Some(Playback {application:application.into(),track:track.into(),playing:p["isPlaying"].as_bool().unwrap_or(false)}))
}
#[cfg(target_os = "macos")]
fn command(play: bool) -> Result<bool, String> {
    unsafe extern "C" { fn no_tipe_media_command(play: bool) -> bool; }
    Ok(unsafe { no_tipe_media_command(play) })
}
#[cfg(target_os = "windows")]
fn with_session<T>(f: impl FnOnce(Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession>)->Result<T,String>) -> Result<T,String> {
    use windows::{Media::Control::GlobalSystemMediaTransportControlsSessionManager as Manager,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED}};
    use crate::store::err;
    unsafe { RoInitialize(RO_INIT_MULTITHREADED).map_err(err)?; }
    struct Apartment; impl Drop for Apartment { fn drop(&mut self) { unsafe { RoUninitialize(); } } }
    let _apartment=Apartment;
    let manager=Manager::RequestAsync().map_err(err)?.get().map_err(err)?;
    f(manager.GetCurrentSession().ok())
}
#[cfg(target_os = "windows")]
fn playback() -> Result<Option<Playback>,String> {
    use crate::store::err;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status;
    with_session(|session| {let Some(s)=session else{return Ok(None)};
        let properties=s.TryGetMediaPropertiesAsync().map_err(err)?.get().map_err(err)?;
        Ok(Some(Playback {application:s.SourceAppUserModelId().map_err(err)?.to_string(),track:properties.Title().map_err(err)?.to_string(),playing:s.GetPlaybackInfo().map_err(err)?.PlaybackStatus().map_err(err)?==Status::Playing}))
    })
}
#[cfg(target_os = "windows")]
fn command(play:bool)->Result<bool,String>{
    use crate::store::err;
    with_session(|session|{let Some(s)=session else{return Ok(false)}; if play{s.TryPlayAsync().map_err(err)?.get().map_err(err)}else{s.TryPauseAsync().map_err(err)?.get().map_err(err)}})
}
#[cfg(not(any(target_os = "macos",target_os = "windows")))]
fn playback()->Result<Option<Playback>,String>{Ok(None)}
#[cfg(not(any(target_os = "macos",target_os = "windows")))]
fn command(_:bool)->Result<bool,String>{Ok(false)}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn ownership_requires_same_player_and_item(){
        let playing=Playback{application:"player".into(),track:"first".into(),playing:true};
        assert!(playing.same_item(&Playback{playing:false,..playing.clone()}));
        assert!(!playing.same_item(&Playback{application:"other".into(),..playing.clone()}));
        assert!(!playing.same_item(&Playback{track:"second".into(),..playing.clone()}));
    }
}
