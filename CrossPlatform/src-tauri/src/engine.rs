use crate::{
    audio::{Captured, Recorder},
    domain::*,
    platform, providers,
    session::{ProcessingChange, RecordingSession},
    store::{err, Store},
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

pub struct Runtime {
    pub snapshot: Snapshot,
    pub recorder: Option<Recorder>,
    pub generation: u64,
    pub cancel: Arc<AtomicBool>,
    pub started: Option<Instant>,
    pub media: Option<crate::media::MediaSession>,
    pub insight_application: Option<String>,
    pub session: Option<Arc<RecordingSession>>,
}
impl Runtime {
    fn synchronize(&mut self, p: &Preferences) {
        let s = &mut self.snapshot;
        s.ui_language = crate::localization::resolve(&p.ui_language).into();
        if self.session.is_none() {
            s.show_transcript = p.show_transcript;
            s.enhance = p.enhance;
            s.shorten = p.shorten;
            s.translation = p.translation.clone();
        }
        // General settings cannot alter an active session. Only explicit
        // recorder controls change its processing choices while recording.
        s.hidden_style = p.hidden_style.clone();
        s.palette = p.palette.clone();
        s.recorder_style = p.recorder_style.clone();
        s.pixel_emotion = p.pixel_emotion.clone();
        s.chromatic = p.chromatic;
        s.light_intensity = p.light_intensity;
        s.wave_brightness = p.wave_brightness;
        s.recorder_scale = p.recorder_scale;
        s.show_dictation_waves = p.show_dictation_waves;
    }
    fn change_processing(&mut self, change: &ProcessingChange) {
        if self.snapshot.state != "recording" { return; }
        if let Some(session) = &self.session {
            let session = Arc::new(session.with_processing(change));
            let processing = &session.configuration.processing;
            self.snapshot.enhance = processing.enhance;
            self.snapshot.shorten = processing.shorten;
            self.snapshot.translation = processing.translation.clone();
            self.session = Some(session);
        }
    }
    fn reset(&mut self, p: &Preferences) {
        self.cancel.store(true, Ordering::Relaxed);
        self.generation += 1;
        if let Some(recorder) = self.recorder.take() { recorder.cancel(); }
        let empowerment = self.snapshot.empowerment.take();
        self.snapshot = Snapshot::idle(p);
        self.snapshot.empowerment = empowerment;
        self.started = None;
        self.session.take();
        self.insight_application.take();
        self.media.take();
    }
    fn reset_completed(&mut self, generation: u64, p: &Preferences) -> bool {
        if self.generation != generation || !["result", "copied", "failed"].contains(&self.snapshot.state.as_str()) { return false; }
        self.reset(p);
        true
    }
    fn consume_empowerment(&mut self, session: &Arc<RecordingSession>) -> bool {
        if session.configuration.processing.empowerment.is_none()
            || !self.session.as_ref().is_some_and(|current| Arc::ptr_eq(current, session)) { return false; }
        self.snapshot.empowerment = None;
        true
    }
    fn begin_recording(&mut self, p: &Preferences) -> u64 {
        self.reset(p);
        self.cancel = Arc::new(AtomicBool::new(false));
        self.snapshot.state = "preparing".into();
        self.generation
    }
    fn begin_text_processing(&mut self, session: &Arc<RecordingSession>) -> bool {
        if self.snapshot.state != "preparing" || self.cancel.load(Ordering::Relaxed)
            || !self.session.as_ref().is_some_and(|current| Arc::ptr_eq(current, session)) { return false; }
        self.snapshot.state = "busy".into();
        true
    }
    fn complete(&mut self, generation: u64, status: &str, error: Option<String>) -> bool {
        if self.generation != generation || self.cancel.load(Ordering::Relaxed) { return false; }
        self.snapshot.state = status.into();
        self.snapshot.error = error;
        self.snapshot.transcript.clear();
        self.snapshot.paused = false;
        true
    }
}
pub struct AppState {
    pub store: Store,
    pub runtime: Mutex<Runtime>,
    pub operation: tokio::sync::Mutex<()>,
    pub lifecycle: Arc<tokio::sync::RwLock<()>>,
    pub hit_regions: Mutex<Vec<Rect>>,
    pub dashboard_active: AtomicBool,
    pub notch_mode: AtomicBool,
    pub hide_recorder_on_hover: AtomicBool,
    pub cloud_hover_hidden: AtomicBool,
    pub dock_geometry: Mutex<Option<crate::dock::Geometry>>,
    pub recorder_position: Mutex<Option<crate::recorder_position::Position>>,
    pub recorder_dragging: AtomicBool,
    #[cfg(target_os = "macos")]
    pub cloud_pointer: Mutex<Option<crate::permissions::CloudPointer>>,
}
#[derive(Clone, serde::Deserialize)]
#[repr(C)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl AppState {
    pub fn new(store: Store) -> Result<Self, String> {
        let p = store.preferences()?;
        let recorder_position = store.get_meta::<Option<crate::recorder_position::Position>>(crate::recorder_position::KEY)?.flatten().filter(|p| p.valid());
        Ok(Self {
            store,
            runtime: Mutex::new(Runtime {
                snapshot: Snapshot::idle(&p),
                recorder: None,
                generation: 0,
                cancel: Arc::new(AtomicBool::new(false)),
                started: None,
                media: None,
                insight_application: None,
                session: None,
            }),
            operation: tokio::sync::Mutex::new(()),
            lifecycle: Arc::new(tokio::sync::RwLock::new(())),
            hit_regions: Mutex::new(vec![]),
            dashboard_active: AtomicBool::new(true),
            notch_mode: AtomicBool::new(p.recorder_placement == "notch"),
            hide_recorder_on_hover: AtomicBool::new(p.hide_recorder_on_hover),
            cloud_hover_hidden: AtomicBool::new(false),
            dock_geometry: Mutex::new(None),
            recorder_position: Mutex::new(recorder_position),
            recorder_dragging: AtomicBool::new(false),
            #[cfg(target_os = "macos")]
            cloud_pointer: Mutex::new(None),
        })
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let (mut snapshot, selected) = {
            let runtime = self.runtime.lock().map_err(err)?;
            (runtime.snapshot.clone(), runtime.session.as_ref().and_then(|session| session.configuration.processing.empowerment.clone()))
        };
        snapshot.empowerments = crate::empowerment::catalog(&self.store, &self.store.preferences()?)?;
        snapshot.empowerment_color = selected.filter(|item| Some(&item.id) == snapshot.empowerment.as_ref()).map(|item| item.color)
            .or_else(|| snapshot.empowerments.iter().find(|item| Some(&item.id) == snapshot.empowerment.as_ref()).map(|item| item.color.clone()));
        Ok(snapshot)
    }
    pub fn emit(&self, app: &AppHandle) {
        if let Ok(snapshot) = self.snapshot() {
            let _ = app.emit("cloud-state", snapshot);
        }
        let _ = sync_cloud_visibility(app);
    }
    pub fn update_processing(&self, change: ProcessingChange) -> Result<(), String> {
        // Serialize the saved choice and session replacement with finish/cancel.
        // A click accepted while recording must reach that recording's result.
        let mut r = self.runtime.lock().map_err(err)?;
        let modes = self.store.list::<Mode>("modes")?;
        let p = self.store.update_preferences(|p| {
            change.apply(p);
            let enabling = match &change {
                ProcessingChange::Enhance(enabled) | ProcessingChange::Shorten(enabled) => *enabled,
                ProcessingChange::Translation(language) => language != "off",
            };
            if enabling {
                // While recording the model is frozen in the session, even if
                // settings for the next dictation have already changed.
                let configured = r.session.as_ref().filter(|_| r.snapshot.state == "recording")
                    .map(|session| session.preferences.clone())
                    .unwrap_or_else(|| processing_preferences(p, modes.iter().find(|mode| mode.enabled && Some(&mode.id) == p.active_mode.as_ref())));
                crate::text_models::require_processing_model(&self.store.root, &configured)?;
            }
            Ok(())
        })?;
        r.change_processing(&change);
        r.synchronize(&p);
        Ok(())
    }
    pub fn update_empowerment(&self, id: Option<&str>) -> Result<(), String> {
        let mut r = self.runtime.lock().map_err(err)?;
        if !["idle", "recording"].contains(&r.snapshot.state.as_str()) { return Ok(()); }
        let selected = crate::empowerment::Empowerment::resolve_saved(id, &self.store, &self.store.preferences()?)?;
        if let Some(session) = &r.session {
            r.session = Some(Arc::new(session.with_modifier(selected.clone())));
        }
        r.snapshot.empowerment = selected.map(|modifier| modifier.id);
        Ok(())
    }
    pub fn remove_empowerment(&self, id: &str) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(err)?;
        if runtime.snapshot.empowerment.as_deref() == Some(id) {
            runtime.snapshot.empowerment = None;
            if ["idle", "recording"].contains(&runtime.snapshot.state.as_str()) {
                if let Some(session) = &runtime.session { runtime.session = Some(Arc::new(session.with_modifier(None))); }
            }
        }
        Ok(())
    }
    pub fn synchronize_preferences(&self, app: &AppHandle) -> Result<(), String> {
        let p = self.store.preferences()?;
        self.hide_recorder_on_hover.store(p.hide_recorder_on_hover, Ordering::Relaxed);
        crate::diagnostics::synchronize(app, p.developer_mode);
        {
            let mut r = self.runtime.lock().map_err(err)?;
            r.synchronize(&p);
        }
        let notch = p.recorder_placement == "notch";
        if self.notch_mode.swap(notch, Ordering::Relaxed) != notch {
            if let Some(window) = app.get_webview_window("cloud") {
                self.hit_regions.lock().map_err(err)?.clear();
                *self.dock_geometry.lock().map_err(err)? = None;
                window.set_ignore_cursor_events(true).map_err(err)?;
                let page = if notch { "notch.html" } else { "cloud.html" };
                let url = window.url().map_err(err)?.join(page).map_err(err)?;
                window.navigate(url).map_err(err)?;
            }
        }
        crate::localization::update_menu(app, &p.ui_language)?;
        self.emit(app);
        Ok(())
    }
    pub fn hover_hiding_enabled(&self) -> bool {
        self.hide_recorder_on_hover.load(Ordering::Relaxed)
            && self.runtime.lock().is_ok_and(|runtime| runtime.snapshot.state == "idle")
    }
    pub fn publish_cloud_hover(&self, window: &tauri::WebviewWindow, hidden: bool) {
        if self.cloud_hover_hidden.swap(hidden, Ordering::Relaxed) != hidden {
            let _ = window.emit("cloud-hover-hidden", hidden);
        }
    }
}
pub fn show_cloud(app: &AppHandle) -> Result<(), String> {
    let _window = if let Some(window) = app.get_webview_window("cloud") {
        window
    } else {
        tauri::WebviewWindowBuilder::new(app, "cloud", tauri::WebviewUrl::App(if app.state::<Arc<AppState>>().notch_mode.load(Ordering::Relaxed) { "notch.html" } else { "cloud.html" }.into()))
            .title("No Type Recorder")
            .inner_size(600., 400.)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .accept_first_mouse(true)
            .resizable(false)
            .visible_on_all_workspaces(true)
            .visible(false)
            .devtools(cfg!(debug_assertions))
            .build()
            .map_err(err)?
    };
    sync_cloud_visibility(app)
}

fn cloud_should_show(dashboard_foreground: bool, always_show: bool, phase: &str) -> bool {
    !dashboard_foreground && (always_show || phase != "idle")
}

// Keep a single recorder window alive. Hiding for Dashboard preserves the
// backend session; revealing it restores the current snapshot to the renderer.
pub fn sync_cloud_visibility(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window("cloud") else { return; };
        let state = handle.state::<Arc<AppState>>();
        let foreground = state.dashboard_active.load(Ordering::Relaxed)
            && handle.get_webview_window("main").is_some_and(|main| {
                main.is_focused().unwrap_or(false)
                    && main.is_visible().unwrap_or(false)
                    && !main.is_minimized().unwrap_or(false)
            });
        let (Ok(p), Ok(snapshot)) = (state.store.preferences(), state.snapshot()) else { return; };
        let show = cloud_should_show(foreground, p.always_show_cloud, &snapshot.state);
        if show == window.is_visible().unwrap_or(false) { return; }
        if !show {
            let _ = window.hide();
            let _ = window.emit("cloud-active", false);
        } else {
            // Refresh the hidden renderer before presenting the retained window.
            let _ = window.emit("cloud-state", &snapshot);
            let _ = window.emit("cloud-active", true);
            #[cfg(target_os = "macos")]
            let _ = crate::permissions::present_cloud(&window, state.notch_mode.load(Ordering::Relaxed));
            #[cfg(not(target_os = "macos"))]
            {
                let _ = follow_cloud(&window);
                let _ = window.show();
            }
        }
    }).map_err(err)
}

#[cfg(test)]
mod presentation_tests {
    use super::cloud_should_show;
    #[test]
    fn dashboard_replaces_cloud_in_every_phase() {
        for phase in ["idle", "recording", "preparing", "busy", "result", "copied", "failed"] {
            assert!(!cloud_should_show(true, true, phase));
            assert!(!cloud_should_show(true, false, phase));
        }
    }
    #[test]
    fn leaving_dashboard_or_app_restores_cloud_without_changing_the_session() {
        for phase in ["recording", "preparing", "busy", "result", "copied", "failed"] {
            assert!(cloud_should_show(false, false, phase));
        }
        assert!(cloud_should_show(false, true, "idle"));
        assert!(!cloud_should_show(false, false, "idle"));
    }
}
// Cursor and monitor work areas are both physical desktop coordinates. Using
// the destination scale avoids a jump when crossing Retina/non-Retina displays.
#[cfg(not(target_os = "macos"))]
pub fn follow_cloud(window: &tauri::WebviewWindow) -> Result<(), String> {
    let state = window.state::<Arc<AppState>>();
    let notch = state.notch_mode.load(Ordering::Relaxed);
    let floating = if notch { None } else { *state.recorder_position.lock().map_err(err)? };
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        if floating.is_none() && (GetAsyncKeyState(1) < 0 || GetAsyncKeyState(2) < 0) { return Ok(()); }
    }
    let cursor = window.cursor_position().map_err(err)?;
    let pinned = floating.and_then(|p| window.available_monitors().ok()?.into_iter()
        .find(|m| m.position().x as f64 == p.display_x && m.position().y as f64 == p.display_y));
    let fallback = if floating.is_some() { window.primary_monitor().map_err(err)? }
        else { window.monitor_from_point(cursor.x, cursor.y).map_err(err)? };
    if let Some(monitor) = pinned.or(fallback) {
        let area = monitor.work_area();
        let (mut position, geometry) = crate::dock::placement(
            (area.position.x, area.position.y, area.size.width, area.size.height),
            monitor.scale_factor(), notch);
        if let Some(p) = floating {
            position = crate::recorder_position::origin(p,
                (area.position.x, area.position.y, area.size.width, area.size.height),
                monitor.scale_factor(), state.hit_regions.lock().map_err(err)?.as_slice());
        }
        crate::dock::publish(window, geometry);
        let (x, y) = position;
        let next = tauri::PhysicalPosition::new(x, y);
        if window.outer_position().map_err(err)? != next {
            window.set_position(next).map_err(err)?;
        }
    }
    Ok(())
}
pub async fn action(app: AppHandle, state: Arc<AppState>, action: &str) -> Result<(), String> {
    crate::diagnostics::record("info", "recorder", "action", serde_json::json!({"action":action}));
    match action {
        "record" => start(app, state).await,
        "finish" => finish(app, state).await,
        "pause" => {
            let mut r = state.runtime.lock().map_err(err)?;
            if let Some(recorder) = &r.recorder {
                let paused = !recorder.paused.load(Ordering::Relaxed);
                recorder.paused.store(paused, Ordering::Relaxed);
                r.snapshot.paused = paused;
            }
            drop(r);
            state.emit(&app);
            Ok(())
        }
        "cancel" | "close" => {
            cancel(&app, &state)?;
            Ok(())
        }
        _ => Err("Unknown recorder action".into()),
    }
}
fn cancel(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let p = state.store.preferences()?;
    {
        let mut r = state.runtime.lock().map_err(err)?;
        r.reset(&p);
    }
    // Keep the renderer's springs alive while the visible completion state
    // returns to idle. Deactivating it resets the checkmark and tint instantly.
    state.emit(app);
    Ok(())
}
fn cancel_completed(app: &AppHandle, state: &AppState, generation: u64) -> Result<(), String> {
    let p = state.store.preferences()?;
    {
        let mut r = state.runtime.lock().map_err(err)?;
        if !r.reset_completed(generation, &p) { return Ok(()); }
    }
    state.emit(app);
    Ok(())
}
async fn start(app: AppHandle, state: Arc<AppState>) -> Result<(), String> {
    let _guard = state.operation.lock().await;
    if ["recording", "preparing", "busy"].contains(&state.snapshot()?.state.as_str()) {
        return Ok(());
    }
    let initial = state.store.preferences()?;
    let generation = {
        let mut r = state.runtime.lock().map_err(err)?;
        // Preparation is a real phase: device/model failures must not leave
        // Windows displaying the same idle surface as an untouched recorder.
        r.begin_recording(&initial)
    };
    state.emit(&app);
    let result = start_prepared(app.clone(), state.clone(), generation).await;
    drop(_guard);
    if let Err(error) = &result {
        let _ = crate::telemetry::record_setup_error(&state.store, error);
        complete(app, state, generation, "failed", Some(error.clone())).await;
    }
    result
}
async fn start_prepared(app: AppHandle, state: Arc<AppState>, generation: u64) -> Result<(), String> {
    show_cloud(&app)?;
    #[cfg(target_os = "macos")]
    if crate::permissions::status().microphone != "granted" {
        let _ = app.emit("permissions-needed", ());
        return Err(crate::localization::message("native.microphone_permission"));
    }
    let lifecycle = state.lifecycle.clone().read_owned().await;
    let foreground = platform::capture().await.unwrap_or_default();
    let mut p = state.store.preferences()?;
    let modes = state.store.list::<Mode>("modes")?;
    if let Some(mode) = modes.iter().find(|m| {
        m.enabled
            && m.app_patterns
                .iter()
                .any(|pattern| !pattern.is_empty() && foreground.contains(pattern))
    }) {
        p = state.store.update_preferences(|current| {
            if current.active_mode.as_deref() != Some(mode.id.as_str()) {
                current.enhance = mode.enhance;
                current.shorten = mode.shorten;
                current.translation = mode.translation.clone();
            }
            current.active_mode = Some(mode.id.clone());
            Ok(())
        })?;
    }
    let mode = modes.iter().find(|m| m.enabled && Some(&m.id) == p.active_mode.as_ref());
    let mut session = RecordingSession::resolve(&state.store, p.clone(), mode, false)?;
    session.lifecycle = Some(Arc::new(lifecycle));
    if session.configuration.clipboard_context {
        session.clipboard = Some(platform::clipboard().unwrap_or_default());
    }
    let mut session = Arc::new(session);
    let path = state
        .store
        .root
        .join("audio")
        .join(format!("{}.wav", uuid::Uuid::new_v4()));
    let device = p.audio_device.clone();
    let app2 = app.clone();
    let recorder = tokio::task::spawn_blocking(move || Recorder::start(app2, device, path))
        .await
        .map_err(err)??;
    let live_buffer = recorder.buffer.clone();
    let live_rate = recorder.rate;
    {
        let mut r = state.runtime.lock().map_err(err)?;
        if r.generation != generation || r.cancel.load(Ordering::Relaxed) {
            recorder.cancel();
            return Ok(());
        }
        r.cancel = Arc::new(AtomicBool::new(false));
        let empowerment = r.snapshot.empowerment.clone();
        session = Arc::new(session.with_modifier(crate::empowerment::Empowerment::resolve_saved(empowerment.as_deref(), &state.store, &session.preferences)?));
        r.snapshot = Snapshot::idle(&p);
        r.snapshot.empowerment = empowerment;
        r.snapshot.state = "recording".into();
        r.recorder = Some(recorder);
        r.session = Some(session.clone());
        r.started = Some(Instant::now());
        r.insight_application = if cfg!(target_os = "macos") && !foreground.is_empty() { Some(foreground) } else { None };
        r.media = crate::media::pause_on_start(p.pause_media);
    }
    show_cloud(&app)?;
    state.emit(&app);
    let cancel = state.runtime.lock().map_err(err)?.cancel.clone();
    crate::live::start(app, state.clone(), generation, session, live_buffer, live_rate, cancel);
    Ok(())
}
async fn finish(app: AppHandle, state: Arc<AppState>) -> Result<(), String> {
    let _guard = state.operation.lock().await;
    let (recorder, generation, cancel, media, application, session) = {
        let mut r = state.runtime.lock().map_err(err)?;
        let Some(recorder) = r.recorder.take() else {
            return Ok(());
        };
        let session = r.session.clone().ok_or("Recording configuration is missing")?;
        r.cancel.store(true, Ordering::Relaxed);
        r.cancel = Arc::new(AtomicBool::new(false));
        r.snapshot.state = "preparing".into();
        r.snapshot.transcript.clear();
        r.snapshot.paused = false;
        (recorder, r.generation, r.cancel.clone(), r.media.take(), r.insight_application.take(), session)
    };
    state.emit(&app);
    let captured = match tokio::task::spawn_blocking(move || { let result=recorder.stop(); drop(media); result })
        .await
        .map_err(err)
        .and_then(|r| r)
    {
        Ok(c) => c,
        Err(error) => {
            complete(
                app,
                state.clone(),
                generation,
                "failed",
                Some(error.clone()),
            )
            .await;
            return Err(error);
        }
    };
    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&captured.path);
        return Ok(());
    }
    let Some(captured) = captured.into_dictation() else {
        self::cancel(&app, &state)?;
        return Ok(());
    };
    let state2 = state.clone();
    tauri::async_runtime::spawn(async move {
        let result = process_configured(&app, &state2, captured, session.clone(), cancel.clone(), None, application, "dictation", None).await;
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        match result {
            Ok(mut transcript) => {
                let delivery_config = &session.configuration.delivery;
                let output = delivery_config.output.as_str();
                let delivery = if output == "customCommand" {
                    run_custom(
                        &delivery_config.command,
                        transcript.delivered_text(),
                    )
                    .await
                    .map(|_| "inserted".into())
                } else if output == "respond" {
                    let _ = app.emit("navigate", "History");
                    Ok("inserted".into())
                } else if output == "clipboard" {
                    platform::copy_formatted(transcript.delivered_text(), transcript.formatted_snippet.as_deref()).await.map(|_| "clipboardOnly".into())
                } else {
                    let text = format!(
                        "{}{}",
                        transcript.delivered_text(),
                        if delivery_config.append_space { " " } else { "" }
                    );
                    let html = transcript.formatted_snippet.as_ref().map(|html| {
                        if delivery_config.append_space { format!("{} </div>", html.strip_suffix("</div>").unwrap_or(html)) }
                        else { html.clone() }
                    });
                    platform::paste(
                        &text,
                        delivery_config.restore_clipboard,
                        delivery_config.clipboard_restore_delay,
                        &delivery_config.auto_send,
                        html.as_deref(),
                    )
                    .await
                };
                // Retain only the last delivery's reason and platform metadata.
                // No transcript, selected text, clipboard content or window title.
                let evidence = match &delivery {
                    Ok(outcome) => serde_json::json!({"result":outcome.result,"reason":outcome.reason,"platform":outcome.diagnostics}),
                    Err(_) => serde_json::json!({"result":"failed","reason":"adapterError"}),
                };
                let _ = state2.store.set_meta("lastDelivery", &serde_json::json!({
                    "timestamp":chrono::Utc::now().timestamp_millis(),
                    "output":output,"evidence":evidence
                }));
                crate::diagnostics::record(if delivery.is_err() { "error" } else { "info" }, "delivery", "completed", evidence);
                if let Ok(outcome) = &delivery {
                    if outcome.reason.as_deref() == Some("accessibilityDenied") {
                        let _ = app.emit("delivery-notice", crate::localization::message("native.clipboard_delivery"));
                    }
                }
                let final_state = match delivery {
                    Ok(ref v) if v.result == "inserted" => "result",
                    Ok(ref v) if v.result == "clipboardOnly" => "copied",
                    _ => {
                        transcript.delivery_error =
                            Some("Text could not be delivered. It is saved in History.".into());
                        "failed"
                    }
                };
                let error = transcript.processing_error.clone().or(transcript.delivery_error.clone());
                let has_error = error.is_some();
                // A history retry may already be running. Delivery owns only
                // this field and must not overwrite newer processing results.
                let _ = state2.store.record_delivery_error(&transcript.id, transcript.delivery_error);
                let _ = app.emit("data-changed", ());
                complete(
                    app,
                    state2,
                    generation,
                    if has_error { "failed" } else { final_state },
                    error,
                )
                .await;
            }
            Err(error) => complete(app, state2, generation, "failed", Some(error)).await,
        }
    });
    Ok(())
}
async fn complete(
    app: AppHandle,
    state: Arc<AppState>,
    generation: u64,
    status: &str,
    error: Option<String>,
) {
    {
        let Ok(mut r) = state.runtime.lock() else {
            return;
        };
        if !r.complete(generation, status, error.clone()) { return; }
    }
    state.emit(&app);
    if let Some(error) = error {
        let _ = app.emit("app-error", error);
    }
    tokio::time::sleep(Duration::from_millis(if status == "failed" {
        2400
    } else {
        800
    }))
    .await;
    let _ = cancel_completed(&app, &state, generation);
}
pub async fn process(
    app: &AppHandle,
    state: &AppState,
    captured: Captured,
    p: Preferences,
    cancel: Arc<AtomicBool>,
) -> Result<Transcript, String> {
    let modes = state.store.list::<Mode>("modes")?;
    let mode = modes.into_iter().find(|m| m.enabled && Some(&m.id) == p.active_mode.as_ref());
    let mut session = RecordingSession::resolve(&state.store, p, mode.as_ref(), true)?;
    if session.configuration.clipboard_context {
        session.clipboard = Some(platform::clipboard().unwrap_or_default());
    }
    process_configured(app, state, captured, Arc::new(session), cancel, None, None, "file", None).await
}
async fn process_configured(
    app: &AppHandle, state: &AppState, mut captured: Captured, session: Arc<RecordingSession>,
    cancel: Arc<AtomicBool>, job: Option<&crate::file_jobs::FileJob>, application: Option<String>, source: &str,
    previous: Option<Transcript>,
) -> Result<Transcript, String> {
    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&captured.path);
        return Err("Canceled".into());
    }
    let model = &session.model;
    let dictionary = &session.dictionary;
    let vocabulary = &session.vocabulary;
    let language = session.configuration.language.as_str();
    let mut t = Transcript {
        id: uuid::Uuid::new_v4().to_string(),
        text: String::new(),
        enhanced_text: None,
        formatted_snippet: None,
        processing_source: None,
        manual_correction: None,
        processing_error: None,
        timestamp: chrono::Utc::now().timestamp_millis() as f64 / 1000.,
        duration: captured.duration,
        audio_file: Some(captured.path.to_string_lossy().into()),
        model: Some(model.name.clone()),
        processing_model: None,
        mode: session.configuration.mode_name.clone(),
        status: "pending".into(),
        transcription_duration: None,
        enhancement_duration: None,
        insights: Some(SessionInsights { source: Some(source.into()), application, words_corrected: Some(0), dictionary_fixes: Some(0) }),
        session_config: Some(session.configuration.clone()),
        recognition_error: None,
        delivery_error: None,
        processing_state: crate::domain::ProcessingState::Idle,
        processing_config: None,
    };
    let id = previous.as_ref().map(|t| t.id.as_str()).unwrap_or(&t.id);
    let _processing = crate::result_edit::processing_guard(id)?;
    if previous.is_some() {
        let mut existing = state.store.begin_transcript_recognition(id)?;
        existing.model = t.model;
        existing.mode = t.mode;
        existing.session_config = t.session_config;
        existing.audio_file = t.audio_file;
        t = existing;
        captured.discard_on_drop();
    }
    state.store.save_transcript(&t)?;
    if previous.is_some() { let _ = app.emit("data-changed", ()); }
    let start = Instant::now();
    let recognition = if let Some(job) = job {
        job.update("transcribing", None, None, Some(0.), Some(captured.duration), None);
        crate::file_jobs::recognize(job, &model, &captured.path, std::mem::take(&mut captured.samples), language, &vocabulary, &session.preferences).await
    } else {
        crate::file_jobs::cancellable(cancel.clone(), providers::transcribe(model, &captured.path, std::mem::take(&mut captured.samples), language, vocabulary, cancel.clone())).await
    };
    if cancel.load(Ordering::Relaxed) {
        t.status = "canceled".into();
        if let Some(job) = job { t.text = job.partial(); }
        state.store.save_transcript(&t)?;
        let _ = app.emit("data-changed", ());
        return Err("Canceled".into());
    }
    match recognition {
        Ok(text) if !text.trim().is_empty() => {
            t.text = text;
            t.enhanced_text = None;
            t.formatted_snippet = None;
            t.processing_source = None;
            t.manual_correction = None;
            t.recognition_error = None;
            t.delivery_error = None;
            t.processing_error = None;
            t.processing_config = None;
            t.processing_model = None;
            t.enhancement_duration = None;
        },
        Ok(_) => {
            t.status = "failed".into();
            t.recognition_error = Some(crate::localization::message("native.no_speech"));
            state.store.save_transcript(&t)?;
            let _ = app.emit("data-changed", ());
            return Err(crate::localization::message("native.no_speech"));
        },
        Err(e) => {
            t.status = "failed".into();
            t.recognition_error = Some(e.clone());
            if let Some(job) = job { t.text = job.partial(); }
            state.store.save_transcript(&t)?;
            if t.can_retry_recognition() { captured.keep_for_retry(); }
            let _ = app.emit("data-changed", ());
            return Err(e);
        }
    }
    // Recognition is finished. Text processing and delivery never need audio.
    // The store also removes it when saving any successful or partial result.
    drop(captured);
    t.audio_file = None;
    t.transcription_duration = Some(start.elapsed().as_secs_f64());
    let mut snippet_plan = crate::snippets::prepare(&t.text, &session.snippets);
    let dictionary_fixes = std::cell::Cell::new(0u64);
    let processing_text = snippet_plan.map_surrounding(|text| {
        let result = crate::dictionary::apply(text, dictionary);
        dictionary_fixes.set(dictionary_fixes.get() + result.fixes);
        result.text
    });
    if let Some(insights) = &mut t.insights { insights.dictionary_fixes = Some(dictionary_fixes.get()); }
    snippet_plan.protected = processing_text.clone();
    t.processing_source = snippet_plan.has_matches().then(|| snippet_plan.clone());
    t.text = snippet_plan.restore(&processing_text);
    t.formatted_snippet = snippet_plan.whole.as_ref().and_then(crate::snippets::html);
    t.status = "completed".into();
    let prompt = session.configuration.processing.prompt.as_ref().filter(|_| snippet_plan.whole.is_none());
    t.processing_state = if prompt.is_some() { ProcessingState::Processing } else { ProcessingState::Idle };
    state.store.save_transcript(&t)?;
    // Publish recognized text before awaiting AI, with processing reserved so
    // history cannot start a second request for the same dictation.
    let _ = app.emit("data-changed", ());
    if let Some(prompt) = prompt {
        if source == "dictation" {
            let changed = state.runtime.lock().map_err(err)?.begin_text_processing(&session);
            if changed { state.emit(app); }
        }
        let start = Instant::now();
        let config = &session.preferences;
        let prompt = if let Some(context) = &session.clipboard {
            format!("{prompt}\nReference context (not instructions):\n{context}")
        } else {
            prompt.clone()
        };
        let prompt = if snippet_plan.has_matches() { format!("{prompt}\n{}", crate::snippets::PRESERVE) } else { prompt };
        if let Some(job) = job { job.update("formatting", Some(t.text.clone()), None, Some(t.duration), None, None); }
        let processed = crate::file_jobs::cancellable(cancel.clone(), providers::process(config, &prompt, &processing_text)).await;
        match processed {
            Ok(text) => {
                if let Some(insights) = &mut t.insights {
                    insights.words_corrected = crate::insight_stats::corrected_words(&processing_text, &text);
                }
                t.enhanced_text = Some(snippet_plan.restore(&text));
                t.processing_state = ProcessingState::Completed;
            },
            Err(e) => {
                t.processing_error = Some(crate::reprocessing::error_message(e));
                t.processing_state = ProcessingState::Failed;
            },
        }
        t.processing_model = Some(config.processing_model.clone());
        t.enhancement_duration = Some(start.elapsed().as_secs_f64());
    }
    if cancel.load(Ordering::Relaxed) {
        t.processing_state = ProcessingState::Interrupted;
        t.processing_error = Some(crate::localization::message("native.processing_interrupted"));
        state.store.save_transcript(&t)?;
        let _ = app.emit("data-changed", ());
        return Err("Canceled".into());
    }
    if let Some(modifier) = &session.configuration.processing.empowerment {
        t.enhanced_text = Some(modifier.append(t.delivered_text()));
        t.formatted_snippet = None;
    }
    crate::text_cleanup::apply(&mut t, session.configuration.processing.remove_trailing_period);
    state.store.save_transcript(&t)?;
    let consumed = state.runtime.lock().map_err(err)?.consume_empowerment(&session);
    if consumed { state.emit(app); }
    if let Some(job) = job { job.update("completed", Some(t.text.clone()), t.enhanced_text.clone(), Some(t.duration), None, t.processing_error.clone()); }
    let _ = app.emit("data-changed", ());
    Ok(t)
}
pub async fn file(
    app: AppHandle, state: Arc<AppState>, path: PathBuf,
    options: Option<crate::file_jobs::FileOptions>,
) -> Result<Transcript, String> {
    let _work = state.lifecycle.read().await;
    let mut baseline = state.store.preferences()?;
    baseline.remove_trailing_period = false;
    let resolved = options.as_ref().map(|options| crate::file_jobs::resolve(options, &baseline, &state.store.list::<Mode>("modes")?)).transpose()?;
    let registered = options.as_ref().map(|options| crate::file_jobs::FileJob::register(options).map(|(job, guard)| (job.attach(&app), guard))).transpose()?;
    let job = registered.as_ref().map(|(job, _)| job);
    if let Some(job) = job { job.update("preparing", None, None, None, None, None); }
    let result = async {
        let copy = state.store.root.join("audio").join(format!("{}.wav", uuid::Uuid::new_v4()));
        let cancel = job.map(|job| job.cancel.clone()).unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let decode_cancel = cancel.clone();
        let captured = tokio::task::spawn_blocking(move || {
            let samples = crate::audio::decode(&path)?;
            if decode_cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
            let duration = samples.len() as f64 / 16000.;
            let captured = Captured::new(samples, copy, duration);
            crate::audio::write_wav(&captured.path, &captured.samples)?;
            Ok::<_, String>(captured)
        }).await.map_err(err)??;
        if let Some((p, mode)) = resolved {
            let session = Arc::new(RecordingSession::resolve(&state.store, p, mode.as_ref(), true)?);
            process_configured(&app, &state, captured, session, cancel, job, None, "file", None).await
        } else {
            process(&app, &state, captured, baseline, cancel).await
        }
    }.await;
    if let (Some(job), Err(error)) = (job, &result) {
        job.update(if error == "Canceled" { "canceled" } else { "failed" }, None, None, None, None, if error == "Canceled" { None } else { Some(error.clone()) });
    }
    result
}
pub async fn retry_recognition(app: AppHandle, state: Arc<AppState>, id: &str) -> Result<Option<Transcript>, String> {
    let _work = state.lifecycle.read().await;
    let previous = state.store.transcript(id)?;
    if !previous.can_retry_recognition() { return Err("Only failed recognition without text can be retried".into()); }
    let path = previous.audio_file.as_deref().map(PathBuf::from)
        .filter(|path| path.is_file())
        .ok_or_else(|| crate::localization::message("native.audio_unavailable"))?;
    let mut p = state.store.preferences()?;
    if previous.insights.as_ref().and_then(|i| i.source.as_deref()) == Some("file") { p.remove_trailing_period = false; }
    let modes = state.store.list::<Mode>("modes")?;
    let mode = modes.iter().find(|m| m.enabled && Some(&m.id) == p.active_mode.as_ref());
    let session = Arc::new(RecordingSession::resolve(&state.store, p, mode, true)?);
    let samples = crate::audio::decode(&path)?;
    let captured = if path.parent() == Some(state.store.root.join("audio").as_path()) {
        let mut captured = Captured::new(samples, path, previous.duration);
        // A concurrent retry can fail to reserve the row. Until reservation
        // succeeds, the existing recording still belongs to History.
        captured.keep_for_retry();
        captured
    } else {
        // Compatibility imports can refer to an external source recording.
        // Work on an owned copy so success never deletes the user's input.
        let copy = state.store.root.join("audio").join(format!("{}.wav", uuid::Uuid::new_v4()));
        let captured = Captured::new(samples, copy, previous.duration);
        crate::audio::write_wav(&captured.path, &captured.samples)?;
        captured
    };
    let source = previous.insights.as_ref().and_then(|i| i.source.clone()).unwrap_or("dictation".into());
    let application = previous.insights.as_ref().and_then(|i| i.application.clone());
    let result = process_configured(&app, &state, captured, session, Arc::new(AtomicBool::new(false)), None, application, &source, Some(previous)).await;
    match result {
        Ok(t) => Ok(Some(t)),
        Err(error) if crate::localization::is_no_speech(&error) && state.store.transcript(id).is_err() => Ok(None),
        Err(error) => Err(error),
    }
}
async fn run_custom(command: &str, text: &str) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    if command.trim().is_empty() {
        return Err("No custom command configured".into());
    }
    #[cfg(target_os = "windows")]
    let mut process = {
        let mut p = tokio::process::Command::new("cmd");
        p.args(["/C", command]);
        p
    };
    #[cfg(not(target_os = "windows"))]
    let mut process = {
        let mut p = tokio::process::Command::new("/bin/sh");
        p.args(["-c", command]);
        p
    };
    let mut child = process
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(err)?;
    if let Some(mut input) = child.stdin.take() {
        input.write_all(text.as_bytes()).await.map_err(err)?;
    }
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
        .await
        .map_err(|_| "Custom command timed out")?
        .map_err(err)?;
    if status.success() {
        Ok(())
    } else {
        Err("Custom command failed".into())
    }
}

#[cfg(test)]
mod session_lifecycle_tests {
    use super::*;
    #[test]
    fn missing_processing_model_rejects_activation_without_changing_saved_or_recording_state() {
        let root = std::env::temp_dir().join(format!("no-type-processing-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        for change in [ProcessingChange::Enhance(true), ProcessingChange::Shorten(true), ProcessingChange::Translation("english".into())] {
            assert_eq!(state.update_processing(change).unwrap_err(), crate::localization::message("native.download_text_model"));
            let saved = state.store.preferences().unwrap();
            let snapshot = state.snapshot().unwrap();
            assert!(!saved.enhance && !saved.shorten && saved.translation == "off");
            assert!(!snapshot.enhance && !snapshot.shorten && snapshot.translation == "off");
        }
        // Settings for the next dictation must not override the frozen model.
        let mut session = crate::session::tests::fixture();
        session.preferences.processing_provider = crate::text_models::PROVIDER.into();
        session.preferences.processing_model = "missing-local".into();
        session.preferences.enhance = false;
        let session = Arc::new(session);
        {
            let mut runtime = state.runtime.lock().unwrap();
            runtime.snapshot = Snapshot::idle(&session.preferences);
            runtime.snapshot.state = "recording".into();
            runtime.session = Some(session.clone());
        }
        state.store.update_preferences(|p| { p.processing_provider = "ollama".into(); p.processing_endpoint = "http://127.0.0.1:11434/v1".into(); Ok(()) }).unwrap();
        assert!(state.update_processing(ProcessingChange::Enhance(true)).is_err());
        assert!(Arc::ptr_eq(state.runtime.lock().unwrap().session.as_ref().unwrap(), &session));
        assert!(!state.store.preferences().unwrap().enhance && !state.snapshot().unwrap().enhance);
        assert!(state.update_processing(ProcessingChange::Enhance(false)).is_ok());
        // A ready session can still be changed when next-session settings are missing.
        state.runtime.lock().unwrap().session = Some(Arc::new(crate::session::tests::fixture()));
        state.store.set_preferences(&Preferences::default()).unwrap();
        assert!(state.update_processing(ProcessingChange::Enhance(true)).is_ok());
        assert!(state.snapshot().unwrap().enhance);
        drop(state); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn setup_failure_and_cancellation_cannot_leave_idle_or_revive_an_old_session() {
        let root = std::env::temp_dir().join(format!("no-tipe-preparation-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let p = Preferences::default();
        {
            let mut r = state.runtime.lock().unwrap();
            let first = r.begin_recording(&p);
            assert_eq!(r.snapshot.state, "preparing");
            assert!(!r.cancel.load(Ordering::Relaxed));
            assert!(r.complete(first, "failed", Some("Microphone unavailable".into())));
            assert_eq!(r.snapshot.state, "failed");
            assert_eq!(r.snapshot.error.as_deref(), Some("Microphone unavailable"));
            let second = r.begin_recording(&p);
            assert!(r.snapshot.error.is_none());
            assert!(!r.reset_completed(first, &p));
            assert!(!r.complete(first, "failed", Some("Old setup error".into())));
            assert_eq!(r.snapshot.state, "preparing");
            r.reset(&p);
            assert!(!r.complete(second, "result", None));
            assert_eq!(r.snapshot.state, "idle");
        }
        drop(state); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn only_the_finishing_dictation_can_publish_text_processing() {
        let root = std::env::temp_dir().join(format!("no-tipe-busy-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let session = Arc::new(crate::session::tests::fixture());
        let other = Arc::new(crate::session::tests::fixture());
        {
            let mut r = state.runtime.lock().unwrap();
            let generation = r.begin_recording(&session.preferences);
            r.session = Some(session.clone());
            r.snapshot.state = "recording".into();
            assert!(!r.begin_text_processing(&session));
            r.snapshot.state = "preparing".into();
            assert!(!r.begin_text_processing(&other));
            assert!(r.begin_text_processing(&session));
            assert_eq!(r.snapshot.state, "busy");
            assert!(r.complete(generation, "copied", None));
            assert!(!r.begin_text_processing(&session));
            assert!(r.reset_completed(generation, &session.preferences));
            assert_eq!(r.snapshot.state, "idle");
            assert!(!r.begin_text_processing(&session));
        }
        drop(state); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn empowerments_are_one_message_only_and_cancellation_keeps_the_selection() {
        let root = std::env::temp_dir().join(format!("no-type-empowerment-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let original = serde_json::to_value(state.store.preferences().unwrap()).unwrap();
        state.update_empowerment(Some("brief")).unwrap();
        assert!(state.update_empowerment(Some("unknown")).is_err());
        assert_eq!(serde_json::to_value(state.store.preferences().unwrap()).unwrap(), original);
        {
            let mut runtime = state.runtime.lock().unwrap();
            runtime.reset(&Preferences::default());
            assert_eq!(runtime.snapshot.empowerment.as_deref(), Some("brief"));
            runtime.snapshot.state = "recording".into();
            runtime.session = Some(Arc::new(crate::session::tests::fixture()));
        }
        state.update_empowerment(Some("brief")).unwrap();
        let session = state.runtime.lock().unwrap().session.clone().unwrap();
        assert_eq!(session.configuration.processing.empowerment.as_ref().unwrap().id, "brief");
        {
            let mut runtime = state.runtime.lock().unwrap();
            runtime.snapshot.state = "busy".into();
        }
        state.update_empowerment(None).unwrap();
        assert_eq!(state.snapshot().unwrap().empowerment.as_deref(), Some("brief"));
        {
            let mut runtime = state.runtime.lock().unwrap();
            let unrelated = Arc::new(crate::session::tests::fixture().with_empowerment(Some("brief")).unwrap());
            assert!(!runtime.consume_empowerment(&unrelated));
            assert!(runtime.consume_empowerment(&session));
            runtime.reset(&Preferences::default());
            assert!(runtime.snapshot.empowerment.is_none());
        }
        assert!(crate::session::tests::fixture().configuration.processing.empowerment.is_none());
        drop(state); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn deleting_a_custom_empowerment_clears_the_pending_choice_even_during_processing() {
        let root = std::env::temp_dir().join(format!("no-type-delete-empowerment-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let item = crate::empowerment::Definition { id: uuid::Uuid::new_v4().to_string(), name: "Test".into(), instruction: "Ask questions".into(), color: "#62C5CF".into(), builtin: false };
        state.store.put("empowerments", &item.id, &item).unwrap();
        {
            let mut runtime = state.runtime.lock().unwrap();
            runtime.snapshot.state = "recording".into();runtime.session = Some(Arc::new(crate::session::tests::fixture()));
        }
        state.update_empowerment(Some(&item.id)).unwrap();
        let session = state.runtime.lock().unwrap().session.clone().unwrap();
        assert_eq!(session.configuration.processing.empowerment.as_ref().unwrap().color, item.color);
        state.runtime.lock().unwrap().snapshot.state = "busy".into();
        state.remove_empowerment(&item.id).unwrap();
        state.store.delete("empowerments", &item.id).unwrap();
        assert!(state.snapshot().unwrap().empowerment.is_none());
        assert_eq!(session.configuration.processing.empowerment.as_ref().unwrap().append("Text"), "Text\n\nAsk questions");
        state.runtime.lock().unwrap().reset(&Preferences::default());
        assert!(state.snapshot().unwrap().empowerment.is_none());
        drop(state);std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn repeated_recording_clears_previous_result_and_ignores_its_completion_timer() {
        let root = std::env::temp_dir().join(format!("no-tipe-repeat-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let p = Preferences { enhance: true, translation: "english".into(), ..Default::default() };
        for phase in ["result", "copied", "failed"] {
            let mut r = state.runtime.lock().unwrap();
            r.snapshot.state = phase.into();
            r.snapshot.transcript = "Previous dictation".into();
            r.snapshot.error = Some("Previous error".into());
            r.snapshot.paused = true;
            r.session = Some(Arc::new(crate::session::tests::fixture()));
            r.insight_application = Some("previous.app".into());
            let previous_generation = r.generation;
            let previous_cancel = r.cancel.clone();
            // start resets before opening the microphone or capturing focus.
            r.reset(&p);
            assert_eq!(r.snapshot.state, "idle");
            assert!(r.snapshot.transcript.is_empty() && r.snapshot.error.is_none() && !r.snapshot.paused);
            assert!(r.session.is_none() && r.insight_application.is_none());
            assert!(r.snapshot.enhance);
            assert_eq!(r.snapshot.translation, "english");
            assert!(r.generation > previous_generation && previous_cancel.load(Ordering::Relaxed));
            r.cancel = Arc::new(AtomicBool::new(false));
            r.snapshot.state = "recording".into();
            r.session = Some(Arc::new(crate::session::tests::fixture()));
            let session = r.session.clone().unwrap();
            assert!(!r.reset_completed(previous_generation, &p));
            let generation = r.generation;
            assert!(!r.reset_completed(generation, &p));
            assert_eq!(r.snapshot.state, "recording");
            assert!(!r.cancel.load(Ordering::Relaxed));
            assert!(Arc::ptr_eq(r.session.as_ref().unwrap(), &session));
            r.snapshot.state = "copied".into();
            assert!(r.reset_completed(generation, &p));
            assert_eq!(r.snapshot.state, "idle");
        }
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn recorder_processing_controls_update_current_session_until_finish() {
        let root = std::env::temp_dir().join(format!("no-tipe-controls-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let mut session = crate::session::tests::fixture();
        session.lifecycle = Some(Arc::new(state.lifecycle.clone().read_owned().await));
        session.clipboard = Some("Original context".into());
        state.store.set_preferences(&session.preferences).unwrap();
        {
            let mut r = state.runtime.lock().unwrap();
            r.snapshot = Snapshot::idle(&session.preferences);
            r.snapshot.state = "recording".into();
            r.snapshot.paused = true;
            r.snapshot.transcript = "Live source text".into();
            r.session = Some(Arc::new(session));
        }
        // Settings elsewhere affect the next session. A recorder click changes
        // only the requested option in the current session, even on pause.
        let next = state.store.update_preferences(|p| {
            p.enhance = false;
            p.translation = "russian".into();
            p.language = "en".into();
            p.processing_provider = "openai".into();
            p.processing_model = "text-new".into();
            p.processing_endpoint = "https://example.com/v1".into();
            Ok(())
        }).unwrap();
        state.runtime.lock().unwrap().synchronize(&next);
        state.update_processing(ProcessingChange::Shorten(true)).unwrap();
        {
            let r = state.runtime.lock().unwrap();
            let session = r.session.as_ref().unwrap();
            let prompt = session.configuration.processing.prompt.as_ref().unwrap();
            assert!(r.snapshot.enhance && r.snapshot.shorten && r.snapshot.paused);
            assert_eq!(r.snapshot.translation, "off");
            assert_eq!(r.snapshot.transcript, "Live source text");
            assert!(prompt.contains("Improve grammar") && prompt.contains("Make the text concise"));
            assert!(prompt.contains("Keep my paragraphs."));
            assert_eq!(session.preferences.processing_provider, "ollama");
            assert_eq!(session.configuration.processing.model, "text-old");
            assert_eq!(session.configuration.language, "ru");
            assert_eq!(session.model.id, "speech-old");
            assert_eq!(session.configuration.delivery.output, "clipboard");
            assert_eq!(session.clipboard.as_deref(), Some("Original context"));
            assert_eq!(session.dictionary.len(), 1);
            assert_eq!(session.snippets[0].expansion, "Original signature");
        }
        assert_eq!(state.store.preferences().unwrap().translation, "russian");
        state.update_processing(ProcessingChange::Enhance(false)).unwrap();
        state.update_processing(ProcessingChange::Translation("english".into())).unwrap();
        state.update_processing(ProcessingChange::Shorten(false)).unwrap();
        {
            let r = state.runtime.lock().unwrap();
            let prompt = r.session.as_ref().unwrap().configuration.processing.prompt.as_ref().unwrap();
            assert!(!r.snapshot.enhance && !r.snapshot.shorten);
            assert_eq!(r.snapshot.translation, "english");
            assert!(prompt.contains("translate into natural English"));
            assert!(!prompt.contains("Keep my paragraphs.") && !prompt.contains("Improve grammar"));
        }
        state.update_processing(ProcessingChange::Translation("off".into())).unwrap();
        assert!(state.runtime.lock().unwrap().session.as_ref().unwrap().configuration.processing.prompt.is_none());
        assert!(state.update_processing(ProcessingChange::Translation("invalid".into())).is_err());
        assert_eq!(state.snapshot().unwrap().translation, "off");
        assert_eq!(state.store.preferences().unwrap().translation, "off");
        state.update_processing(ProcessingChange::Enhance(true)).unwrap();
        state.update_processing(ProcessingChange::Translation("russian".into())).unwrap();
        let finished = {
            let mut r = state.runtime.lock().unwrap();
            // finish clones this same Arc under the runtime lock.
            let session = r.session.clone().unwrap();
            r.snapshot.state = "preparing".into();
            r.snapshot.paused = false;
            session
        };
        for phase in ["preparing", "result", "copied", "failed"] {
            state.runtime.lock().unwrap().snapshot.state = phase.into();
            state.update_processing(ProcessingChange::Enhance(false)).unwrap();
            state.update_processing(ProcessingChange::Shorten(true)).unwrap();
            state.update_processing(ProcessingChange::Translation("off".into())).unwrap();
            let snapshot = state.snapshot().unwrap();
            assert!(snapshot.enhance && !snapshot.shorten);
            assert_eq!(snapshot.translation, "russian");
            assert!(Arc::ptr_eq(state.runtime.lock().unwrap().session.as_ref().unwrap(), &finished));
        }
        let processing = &finished.configuration.processing;
        assert!(processing.enhance && !processing.shorten);
        assert_eq!(processing.translation, "russian");
        assert!(processing.prompt.as_ref().unwrap().contains("translate into natural Russian"));
        let saved = serde_json::to_value(&finished.configuration).unwrap();
        assert_eq!(saved["processing"]["translation"], "russian");
        assert_eq!(saved["processing"]["enhance"], true);
        let p = state.store.preferences().unwrap();
        state.runtime.lock().unwrap().reset(&p);
        assert!(!state.snapshot().unwrap().enhance && state.snapshot().unwrap().shorten);
        assert!(state.lifecycle.try_write().is_err());
        drop(finished);
        assert!(state.lifecycle.try_write().is_ok());
        state.update_processing(ProcessingChange::Translation("english".into())).unwrap();
        assert_eq!(state.snapshot().unwrap().translation, "english");
        drop(state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn pause_settings_changes_and_cancel_keep_session_isolated() {
        let root = std::env::temp_dir().join(format!("no-tipe-session-{}", uuid::Uuid::new_v4()));
        let state = AppState::new(Store::open(&root).unwrap()).unwrap();
        let mut session = crate::session::tests::fixture();
        session.lifecycle = Some(Arc::new(state.lifecycle.clone().read_owned().await));
        let original = session.preferences.clone();
        let session = Arc::new(session);
        let old_cancel = {
            let mut r = state.runtime.lock().unwrap();
            r.session = Some(session.clone());
            r.snapshot = Snapshot::idle(&original);
            r.snapshot.state = "recording".into();
            r.snapshot.paused = true;
            let next = Preferences { enhance: false, shorten: true, language: "en".into(), translation: "english".into(), show_transcript: false, ..Default::default() };
            r.synchronize(&next);
            assert!(r.snapshot.paused); assert!(r.snapshot.show_transcript); assert!(r.snapshot.enhance); assert!(!r.snapshot.shorten); assert_eq!(r.snapshot.translation, "off");
            assert_eq!(r.session.as_ref().unwrap().configuration.language, "ru");
            r.snapshot.paused = false;
            assert_eq!(r.session.as_ref().unwrap().configuration.processing.model, "text-old");
            r.cancel.clone()
        };
        assert!(state.lifecycle.try_write().is_err(), "Weights cannot be removed during this session");
        drop(session);
        let mut r = state.runtime.lock().unwrap();
        let generation = r.generation;
        r.insight_application = Some("example.app".into());
        r.reset(&Preferences::default());
        assert!(old_cancel.load(Ordering::Relaxed)); assert!(r.generation > generation); assert!(r.session.is_none()); assert!(r.insight_application.is_none()); assert!(!r.snapshot.paused); assert_eq!(r.snapshot.state, "idle");
        assert!(state.lifecycle.try_write().is_ok());
        let next = Preferences { shorten: true, translation: "english".into(), ..Default::default() };
        r.synchronize(&next);
        assert!(r.snapshot.shorten); assert_eq!(r.snapshot.translation, "english");
        drop(r); drop(state); std::fs::remove_dir_all(root).unwrap();
    }
}
