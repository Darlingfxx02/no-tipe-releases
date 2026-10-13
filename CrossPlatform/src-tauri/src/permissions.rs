use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub microphone: String,
    pub accessibility: String,
}
#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[repr(C)]
pub struct CloudPointer {
    pub x: f64,
    pub y: f64,
    pub buttons: u64,
    pub valid: bool,
}
#[cfg(target_os = "macos")]
extern "C" {
    fn no_tipe_microphone_status() -> i32;
    fn no_tipe_accessibility_status() -> bool;
    fn no_tipe_request_microphone();
    fn no_tipe_request_accessibility();
    fn no_tipe_present_cloud(window: *mut std::ffi::c_void, notch: bool,
        position: *const crate::recorder_position::Position, regions: *const crate::engine::Rect, count: usize,
        geometry: *mut crate::dock::Geometry);
    fn no_tipe_update_cloud(
        window: *mut std::ffi::c_void,
        regions: *const crate::engine::Rect,
        count: usize,
        notch: bool,
        hide_on_hover: bool,
        dragging: bool,
        position: *const crate::recorder_position::Position,
        geometry: *mut crate::dock::Geometry,
        pointer: *mut CloudPointer,
    ) -> bool;
}
pub fn status() -> Permissions {
    #[cfg(target_os = "macos")]
    unsafe {
        Permissions {
            microphone: match no_tipe_microphone_status() {
                3 => "granted",
                2 => "denied",
                1 => "restricted",
                _ => "notDetermined",
            }
            .into(),
            accessibility: if no_tipe_accessibility_status() {
                "granted"
            } else {
                "notDetermined"
            }
            .into(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    Permissions {
        microphone: "system".into(),
        accessibility: "notRequired".into(),
    }
}
pub fn request(app: &tauri::AppHandle, kind: &str) -> Result<(), String> {
    if !["microphone", "accessibility"].contains(&kind) {
        return Err("Unknown permission".into());
    }
    #[cfg(target_os = "macos")]
    {
        let microphone = kind == "microphone";
        app.run_on_main_thread(move || unsafe {
            if microphone {
                no_tipe_request_microphone();
            } else {
                no_tipe_request_accessibility();
            }
        })
        .map_err(crate::store::err)?;
    }
    #[cfg(target_os = "windows")]
    if kind == "microphone" {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url("ms-settings:privacy-microphone", None::<&str>)
            .map_err(crate::store::err)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn present_cloud(window: &tauri::WebviewWindow, notch: bool) -> Result<(), String> {
    let pointer = window.ns_window().map_err(crate::store::err)? as usize;
    let target = window.clone();
    window
        .run_on_main_thread(move || unsafe {
            use tauri::Manager;
            let state = target.state::<std::sync::Arc<crate::engine::AppState>>();
            let position = state.recorder_position.lock().ok().and_then(|p| *p);
            let regions = state.hit_regions.lock().ok().map(|r| r.clone()).unwrap_or_default();
            let mut geometry = crate::dock::Geometry::default();
            no_tipe_present_cloud(pointer as *mut std::ffi::c_void, notch,
                position.as_ref().map_or(std::ptr::null(), |p| p), regions.as_ptr(), regions.len(), &mut geometry);
            crate::dock::publish(&target, geometry);
        })
        .map_err(crate::store::err)
}

#[cfg(target_os = "macos")]
pub fn update_cloud(
    window: &tauri::WebviewWindow,
    regions: Vec<crate::engine::Rect>,
    notch: bool,
) -> Result<(), String> {
    let pointer = window.ns_window().map_err(crate::store::err)? as usize;
    let target = window.clone();
    window
        .run_on_main_thread(move || unsafe {
            use tauri::{Emitter, Manager};
            let state = target.state::<std::sync::Arc<crate::engine::AppState>>();
            let mut geometry = crate::dock::Geometry::default();
            let mut sample = CloudPointer::default();
            let position = state.recorder_position.lock().ok().and_then(|p| *p);
            let hidden = no_tipe_update_cloud(
                pointer as *mut std::ffi::c_void,
                regions.as_ptr(),
                regions.len(),
                notch,
                state.hover_hiding_enabled(),
                state.recorder_dragging.load(std::sync::atomic::Ordering::Relaxed),
                position.as_ref().map_or(std::ptr::null(), |p| p),
                &mut geometry,
                &mut sample,
            );
            if sample.buttons & 1 == 0 { crate::recorder_position::released(&state); }
            state.publish_cloud_hover(&target, hidden);
            crate::dock::publish(&target, geometry);
            // Cursor observation remains independent of the clickable regions:
            // petting must work while this nonactivating panel is click-through.
            if let Ok(mut previous) = state.cloud_pointer.lock() {
                if *previous != Some(sample) {
                    *previous = Some(sample);
                    let _ = target.emit("cloud-pointer", sample);
                }
            };
        })
        .map_err(crate::store::err)
}
