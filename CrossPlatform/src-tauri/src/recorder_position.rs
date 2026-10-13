use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{Manager, WebviewWindow};
use crate::{engine::AppState, store::err};

// Machine-local placement, separate from portable preferences/backups. Screen
// origins identify the display; fractions survive changes to its work area.
// macOS uses AppKit points, other platforms use physical desktop coordinates.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(C)]
pub struct Position {
    pub display_x: f64,
    pub display_y: f64,
    pub x: f64,
    pub y: f64,
}
pub const KEY: &str = "recorderFloatingPosition";
impl Position {
    pub fn valid(&self) -> bool {
        [self.display_x, self.display_y, self.x, self.y].iter().all(|n| n.is_finite())
            && (0.0..=1.0).contains(&self.x) && (0.0..=1.0).contains(&self.y)
    }
}

pub async fn drag(window: WebviewWindow, x: f64, y: f64, end: bool) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || !(0.0..=600.).contains(&x) || !(0.0..=400.).contains(&y) {
        return Err("Invalid recorder drag origin".into());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window.run_on_main_thread(move || {
        let result = (|| {
            let state = target.state::<Arc<AppState>>();
            if state.notch_mode.load(std::sync::atomic::Ordering::Relaxed)
                || state.hover_hiding_enabled() { return Ok(()); }
            let position = sample(&target, x, y)?;
            if !position.valid() { return Err("Invalid recorder position".into()); }
            {
                let mut saved = state.recorder_position.lock().map_err(err)?;
                *saved = Some(position);
                if end { state.store.set_meta(KEY, &*saved)?; }
            }
            state.recorder_dragging.store(!end, std::sync::atomic::Ordering::Relaxed);
            #[cfg(target_os = "macos")]
            crate::permissions::update_cloud(&target, state.hit_regions.lock().map_err(err)?.clone(), false)?;
            #[cfg(not(target_os = "macos"))]
            crate::engine::follow_cloud(&target)?;
            Ok(())
        })();
        let _ = send.send(result);
    }).map_err(err)?;
    receive.await.map_err(err)?
}

pub fn reset(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<Arc<AppState>>();
    let mut saved = state.recorder_position.lock().map_err(err)?;
    state.store.set_meta(KEY, &Option::<Position>::None)?;
    *saved = None;
    state.recorder_dragging.store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

// Mouse capture can end outside the desktop or during a Space change. Native
// button sampling finalizes the last position even if WebKit misses pointerup.
pub fn released(state: &AppState) {
    if state.recorder_dragging.swap(false, std::sync::atomic::Ordering::Relaxed) {
        if let Ok(position) = state.recorder_position.lock() {
            let _ = state.store.set_meta(KEY, &*position);
        }
    }
}

#[cfg(target_os = "macos")]
fn sample(window: &WebviewWindow, x: f64, y: f64) -> Result<Position, String> {
    extern "C" {
        fn no_tipe_cloud_drag_position(window: *mut std::ffi::c_void, x: f64, y: f64, position: *mut Position) -> bool;
    }
    let mut position = Position { display_x: 0., display_y: 0., x: 0., y: 0. };
    if unsafe { no_tipe_cloud_drag_position(window.ns_window().map_err(err)?, x, y, &mut position) } {
        Ok(position)
    } else { Err("No display available for recorder".into()) }
}

#[cfg(not(target_os = "macos"))]
fn sample(window: &WebviewWindow, x: f64, y: f64) -> Result<Position, String> {
    let cursor = window.cursor_position().map_err(err)?;
    let monitor = window.monitor_from_point(cursor.x, cursor.y).map_err(err)?.ok_or("No display available for recorder")?;
    let area = monitor.work_area();
    // Use the destination DPI so the grabbed point stays under the pointer.
    let scale = monitor.scale_factor();
    Ok(Position {
        display_x: monitor.position().x as f64, display_y: monitor.position().y as f64,
        x: ((cursor.x + (300. - x) * scale - area.position.x as f64) / area.size.width as f64).clamp(0., 1.),
        y: ((cursor.y + (348.5 - y) * scale - area.position.y as f64) / area.size.height as f64).clamp(0., 1.),
    })
}

#[cfg(any(test, not(target_os = "macos")))]
pub fn origin(position: Position, work: (i32, i32, u32, u32), scale: f64, regions: &[crate::engine::Rect]) -> (i32, i32) {
    let (wx, wy, ww, wh) = work;
    // Reserve the maximum layout width (520) and full renderer height (400)
    // before dictation/settings open, including detached controls at small
    // scales. Match VICloudFloatingOrigin in Permissions.m.
    // Hit regions only enlarge this minimum for unexpectedly larger content.
    let left = regions.iter().map(|r| r.x).fold(40., f64::min);
    let top = regions.iter().map(|r| r.y).fold(0., f64::min);
    let right = regions.iter().map(|r| r.x + r.width).fold(560., f64::max);
    let bottom = regions.iter().map(|r| r.y + r.height).fold(400., f64::max);
    let fit = |value: f64, low: f64, high: f64| if low <= high { value.clamp(low, high) } else { (low + high) / 2. };
    let x = fit(wx as f64 + position.x * ww as f64 - 300. * scale,
        wx as f64 + (12. - left) * scale, wx as f64 + ww as f64 - (right + 12.) * scale);
    let y = fit(wy as f64 + position.y * wh as f64 - 348.5 * scale,
        wy as f64 + (12. - top) * scale, wy as f64 + wh as f64 - (bottom + 12.) * scale);
    (x.round() as i32, y.round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_and_reset_positions_survive_restart_without_changing_preferences() {
        let root = std::env::temp_dir().join(format!("no-type-position-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        let preferences = serde_json::to_value(store.preferences().unwrap()).unwrap();
        let p = Position { display_x: -1920., display_y: 0., x: 0.3, y: 0.2 };
        store.set_meta(KEY, &p).unwrap();
        let state = AppState::new(crate::store::Store::open(&root).unwrap()).unwrap();
        assert_eq!(*state.recorder_position.lock().unwrap(), Some(p));
        store.set_meta(KEY, &Option::<Position>::None).unwrap();
        let reset = AppState::new(crate::store::Store::open(&root).unwrap()).unwrap();
        assert_eq!(*reset.recorder_position.lock().unwrap(), None);
        assert_eq!(serde_json::to_value(store.preferences().unwrap()).unwrap(), preferences);
        assert!(serde_json::to_value(store.backup().unwrap()).unwrap().get(KEY).is_none());
        drop((state, reset, store));
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn full_expansion_fits_even_when_dragging_compact_on_mixed_dpi_displays() {
        let regions = [crate::engine::Rect { x: 202., y: 317., width: 196., height: 63. }];
        for work in [(0, 24, 1920, 1016), (-2560, -1440, 2560, 1392)] {
            for scale in [1., 1.25, 1.5, 2.] {
                for x in [0., 0.5, 1.] { for y in [0., 0.5, 1.] {
                    let (ox, oy) = origin(Position { display_x: 0., display_y: 0., x, y }, work, scale, &regions);
                    assert!(ox as f64 + 40. * scale >= work.0 as f64 + 12. * scale - 0.5);
                    assert!(oy as f64 >= work.1 as f64 + 12. * scale - 0.5);
                    assert!(ox as f64 + 560. * scale <= work.0 as f64 + work.2 as f64 - 12. * scale + 0.5);
                    assert!(oy as f64 + 400. * scale <= work.1 as f64 + work.3 as f64 - 12. * scale + 0.5);
                }}
            }
        }
    }
    #[test]
    fn opening_and_closing_never_move_the_window_at_any_edge() {
        // Include startup without regions and every intermediate animation
        // size, with the small recorder size setting and the widest panel.
        for work in [(0, 24, 1920, 1016), (-2560, -1440, 2560, 1392), (0, 0, 400, 300)] {
            for scale in [1., 1.25, 1.5, 2.] {
                for x in [0., 0.5, 1.] { for y in [0., 0.5, 1.] {
                    let p = Position { display_x: work.0 as f64, display_y: work.1 as f64, x, y };
                    let idle = origin(p, work, scale, &[]);
                    let detached_controls = [crate::engine::Rect { x: 178., y: 339., width: 44., height: 44. },
                        crate::engine::Rect { x: 378., y: 339., width: 44., height: 44. }];
                    assert_eq!(origin(p, work, scale, &detached_controls), idle);
                    for step in (0..=60).chain((0..60).rev()) {
                        let amount = step as f64 / 60.;
                        let width = 54. + (520. - 54.) * amount;
                        let height = 37.8 + (360. - 37.8) * amount;
                        let regions = [crate::engine::Rect { x: 300. - width / 2., y: 380. - height, width, height }];
                        assert_eq!(origin(p, work, scale, &regions), idle);
                    }
                }}
            }
        }
    }
    #[test]
    fn invalid_saved_positions_are_rejected() {
        let p = Position { display_x: 0., display_y: 0., x: 0., y: 0. };
        assert!(!Position { x: f64::NAN, ..p }.valid());
        assert!(!Position { y: 1.1, ..p }.valid());
    }
}
