use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Logical coordinates inside the same 600 × 400 transparent recorder window.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[repr(C)]
pub struct Geometry {
    pub top: f64,
    pub cutout_width: f64,
    pub maximum_width: f64,
    pub display_id: f64,
    pub scale_factor: f64,
}
impl Default for Geometry {
    fn default() -> Self { Self { top: 0., cutout_width: 0., maximum_width: 560., display_id: 0., scale_factor: 1. } }
}
pub fn publish(window: &tauri::WebviewWindow, geometry: Geometry) {
    let state = window.state::<Arc<crate::engine::AppState>>();
    if let Ok(mut previous) = state.dock_geometry.lock() {
        if *previous != Some(geometry) {
            // Notch reports fresh regions when it receives the new display.
            if state.notch_mode.load(std::sync::atomic::Ordering::Relaxed) {
                if let Ok(mut regions) = state.hit_regions.lock() { regions.clear(); }
            }
            *previous = Some(geometry);
            let _ = window.emit("cloud-dock", geometry);
        }
    };
}

// Leave room for the island's visual overflow above the Windows taskbar.
// These are logical pixels, so the gap follows the destination monitor's DPI.
#[cfg(any(test, not(target_os = "macos")))]
const WINDOWS_ISLAND_BOTTOM_GAP: f64 = 28.;

#[cfg(any(test, not(target_os = "macos")))]
pub fn placement(work: (i32, i32, u32, u32), scale: f64, notch: bool) -> ((i32, i32), Geometry) {
    let bottom_gap = if cfg!(target_os = "windows") { WINDOWS_ISLAND_BOTTOM_GAP } else { 4. };
    placement_with_bottom_gap(work, scale, notch, bottom_gap)
}

// Work areas exclude taskbars on every edge. Only the bottom island needs
// extra clearance; the virtual top dock remains attached to the work area.
#[cfg(any(test, not(target_os = "macos")))]
fn placement_with_bottom_gap(work: (i32, i32, u32, u32), scale: f64, notch: bool, bottom_gap: f64) -> ((i32, i32), Geometry) {
    let (x, y, width, height) = work;
    let scale = if scale.is_finite() && scale > 0. { scale } else { 1. };
    let left = x + ((width as f64 - 600. * scale) / 2.).round() as i32;
    let top = if notch { y } else { y + (height as f64 - (400. + bottom_gap) * scale).round() as i32 };
    ((left, top), Geometry { maximum_width: (width as f64 / scale - 24.).clamp(1., 560.), scale_factor: scale, ..Geometry::default() })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn top_taskbar_is_excluded() {
        assert_eq!(placement((0, 48, 1920, 1032), 1., true).0, (660, 48));
    }
    #[test] fn negative_monitor_origins_and_mixed_dpi() {
        assert_eq!(placement((-2560, -1440, 2560, 1400), 2., true).0, (-1880, -1440));
        assert_eq!(placement((1920, 0, 1920, 1080), 1.5, true).0, (2430, 0));
    }
    #[test] fn side_taskbar_and_narrow_display() {
        let (origin, g) = placement((80, 0, 400, 900), 1., true);
        assert_eq!(origin, (-20, 0));
        assert_eq!(g.maximum_width, 376.);
        assert_eq!(g.top, 0.); // no gap between the dock and the work-area edge
    }
    #[test] fn bottom_island_uses_platform_clearance() {
        let top = if cfg!(target_os = "windows") { 612 } else { 636 };
        assert_eq!(placement((0,24,1920,1016),1.,false).0,(660,top));
    }
    #[test] fn windows_island_clears_taskbars_at_every_display_scale() {
        // Bottom, top, left and auto-hidden taskbars; include a secondary
        // display to the left and above the primary display.
        for work in [(0, 0, 1920, 1032), (0, 48, 1920, 1032),
                     (80, 0, 1840, 1080), (-2560, -1440, 2560, 1392),
                     (1920, 0, 1920, 1080)] {
            for scale in [1., 1.25, 1.5, 2.] {
                let ((left, top), geometry) = placement_with_bottom_gap(work, scale, false, WINDOWS_ISLAND_BOTTOM_GAP);
                let (x, y, width, height) = work;
                let window_bottom = top as f64 + 400. * scale;
                let work_bottom = y as f64 + height as f64;
                assert!((work_bottom - window_bottom - 28. * scale).abs() <= 0.5);
                assert!((left as f64 + 300. * scale - (x as f64 + width as f64 / 2.)).abs() <= 0.5);
                assert_eq!(geometry.scale_factor, scale);
            }
        }
    }
    #[test] fn windows_clearance_keeps_the_top_dock_attached() {
        assert_eq!(placement_with_bottom_gap((0,48,1920,1032),1.5,true,WINDOWS_ISLAND_BOTTOM_GAP).0,(510,48));
    }
}
