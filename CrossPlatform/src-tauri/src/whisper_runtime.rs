//! Windows ships a Vulkan backend and a private loader next to the executable.
//! Discover a usable device before loading weights; incompatible drivers keep
//! working through the CPU backend. Native backend selection is logged without
//! recording speech, prompts or arbitrary native messages.
use std::sync::{atomic::{AtomicBool, Ordering}, OnceLock};
use serde_json::json;

static LOGGING: OnceLock<()> = OnceLock::new();
static GPU_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn initialize_logging() {
    LOGGING.get_or_init(|| unsafe {
        whisper_rs::whisper_rs_sys::whisper_log_set(Some(native_log), std::ptr::null_mut());
    });
}

unsafe extern "C" fn native_log(_level: whisper_rs::whisper_rs_sys::ggml_log_level, message: *const std::ffi::c_char, _data: *mut std::ffi::c_void) {
    if message.is_null() { return; }
    let bytes = unsafe { std::ffi::CStr::from_ptr(message) }.to_bytes();
    // Retain upstream diagnostics for headless verification. A failed stderr
    // write must never unwind across the C callback boundary.
    use std::io::Write;
    let _ = std::io::stderr().write_all(bytes);
    if let Ok(message) = std::str::from_utf8(bytes) {
        if let Some(backend) = selected_backend(message) {
            GPU_ACTIVE.store(backend != "CPU", Ordering::Relaxed);
            crate::diagnostics::record("info", "whisper", "backend.used", json!({"backend":backend}));
        }
    }
}

fn selected_backend(message: &str) -> Option<&str> {
    let line = message.strip_prefix("whisper_backend_init_gpu: ")?;
    if line.starts_with("no GPU found") || line.starts_with("failed to initialize") {
        return Some("CPU");
    }
    let backend = line.strip_prefix("using ")?.trim().strip_suffix(" backend")?;
    if backend.starts_with("Vulkan") || backend == "Metal" { Some(backend) } else { None }
}

pub fn parameters(use_gpu: bool) -> whisper_rs::WhisperContextParameters<'static> {
    let mut parameters = whisper_rs::WhisperContextParameters::default();
    parameters.use_gpu(use_gpu);
    // Vulkan support varies by driver; use the broadly supported attention path.
    parameters.flash_attn(false);
    parameters
}

#[cfg(target_os = "windows")]
pub fn device() -> Option<&'static str> {
    static DEVICE: OnceLock<Option<String>> = OnceLock::new();
    DEVICE.get_or_init(|| unsafe {
        use whisper_rs::whisper_rs_sys as sys;
        // This upstream registration API catches Vulkan initialization errors,
        // including a missing ICD and drivers below Vulkan 1.2, returning null.
        // The direct get_device_count API does not provide that guarantee.
        let registry = sys::ggml_backend_vk_reg();
        if registry.is_null() { return None; }
        for index in 0..sys::ggml_backend_reg_dev_count(registry) {
            let device = sys::ggml_backend_reg_dev_get(registry, index);
            if device.is_null() { continue; }
            let kind = sys::ggml_backend_dev_type(device);
            if kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU || kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU {
                let description = sys::ggml_backend_dev_description(device);
                if !description.is_null() {
                    return Some(std::ffi::CStr::from_ptr(description).to_string_lossy().into_owned());
                }
            }
        }
        None
    }).as_deref()
}

#[cfg(not(target_os = "windows"))]
pub fn device() -> Option<&'static str> { None }

pub fn prefer_gpu() -> bool { !cfg!(target_os = "windows") || device().is_some() }
pub fn gpu_active() -> bool { GPU_ACTIVE.load(Ordering::Relaxed) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn driver_failure_changes_the_reported_backend_to_cpu() {
        assert_eq!(selected_backend("whisper_backend_init_gpu: using Vulkan0 backend\n"), Some("Vulkan0"));
        assert_eq!(selected_backend("whisper_backend_init_gpu: failed to initialize Vulkan0 backend\n"), Some("CPU"));
        assert_eq!(selected_backend("whisper_backend_init_gpu: no GPU found\n"), Some("CPU"));
        assert_eq!(selected_backend("whisper_model_load: arbitrary dictated content"), None);
    }
}
