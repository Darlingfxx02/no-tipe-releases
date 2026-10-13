// Keep the running Dock tile in sync with the bundled icon, even when macOS
// retains the previous image for this application's path and version.
#[cfg(not(feature = "dev-channel"))]
static ICON: &[u8] = include_bytes!("../icons/icon.icns");

#[cfg(feature = "dev-channel")]
static ICON: &[u8] = include_bytes!("../icons-dev/icon.icns");

extern "C" {
    fn no_tipe_set_application_icon(bytes: *const u8, length: usize) -> bool;
}

pub fn apply() {
    // RunEvent::Ready is delivered on the AppKit main thread.
    if !unsafe { no_tipe_set_application_icon(ICON.as_ptr(), ICON.len()) } {
        crate::diagnostics::record("warn", "app", "dock-icon.unavailable", serde_json::Value::Null);
        eprintln!("No Type could not apply its Dock icon");
    }
}
