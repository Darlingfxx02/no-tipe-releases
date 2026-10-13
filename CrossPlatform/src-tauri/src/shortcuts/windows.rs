use std::sync::{atomic::{AtomicBool, Ordering}, OnceLock};
use std::time::{Duration, Instant};
use webview2_com::{
    AcceleratorKeyPressedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventArgs2, ICoreWebView2Controller,
        COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    },
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetKeyState, VK_CONTROL, VK_SHIFT, VK_LWIN, VK_RWIN, VK_SPACE};
use windows_core::Interface;
use windows::Win32::{
    Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP},
};
use super::right_control::{Action, Gesture, RIGHT_CONTROL};

static MODIFIER_ENABLED: AtomicBool = AtomicBool::new(false);
struct KeyEvent { key: u8, down: bool, at: Instant, generation: u64, fresh: bool }
static KEY_EVENTS: OnceLock<tokio::sync::mpsc::UnboundedSender<KeyEvent>> = OnceLock::new();

pub fn set_modifier_enabled(enabled: bool) { MODIFIER_ENABLED.store(enabled, Ordering::Relaxed); }
pub fn ensure_modifier_monitor(app: &tauri::AppHandle) -> Result<(), String> {
    static MONITOR: OnceLock<Result<(), String>> = OnceLock::new();
    MONITOR.get_or_init(|| {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        let _ = KEY_EVENTS.set(sender);
        tauri::async_runtime::spawn(process_keys(app.clone(), receiver));
        let (ready, result) = std::sync::mpsc::channel();
        std::thread::Builder::new().name("no-tipe-right-control".into()).spawn(move || unsafe {
            // Seed keys already held at startup outside the hook callback.
            // They must never count as a new dictation press after enabling.
            if let Some(sender) = KEY_EVENTS.get() {
                for key in 8..=254 {
                    if [0x10, 0x11, 0x12].contains(&key) { continue; }
                    if GetAsyncKeyState(key) < 0 { let _ = sender.send(KeyEvent { key: key as u8, down: true, at: Instant::now(), generation: super::CAPTURE_GENERATION.load(Ordering::Relaxed), fresh: false }); }
                }
            }
            let install = GetModuleHandleW(None).and_then(|module| SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), Some(HINSTANCE(module.0)), 0));
            let hook = match install {
                Ok(hook) => hook,
                Err(error) => { let _ = ready.send(Err(format!("Could not monitor Right Ctrl: {error}"))); return; }
            };
            let _ = ready.send(Ok(()));
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&message); DispatchMessageW(&message);
            }
            let _ = UnhookWindowsHookEx(hook);
        }).map_err(|error| error.to_string())?;
        result.recv_timeout(Duration::from_secs(2)).map_err(|error| format!("Could not initialize Right Ctrl: {error}"))?
    }).clone()
}

// Never read SQLite, wait, or swallow keyboard input inside the hook. Its
// dedicated message loop only queues physical transitions for the worker.
unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && matches!(wparam.0 as u32, WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP) {
        let data = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if !data.flags.contains(LLKHF_INJECTED) && data.vkCode < 256 {
            let key = match data.vkCode {
                0x11 => if data.flags.contains(LLKHF_EXTENDED) { RIGHT_CONTROL } else { 0xa2 },
                0x10 => if data.scanCode == 0x36 { 0xa1 } else { 0xa0 },
                0x12 => if data.flags.contains(LLKHF_EXTENDED) { 0xa5 } else { 0xa4 },
                key => key as u8,
            };
            if let Some(sender) = KEY_EVENTS.get() {
                let _ = sender.send(KeyEvent { key, down: matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN), at: Instant::now(), generation: super::CAPTURE_GENERATION.load(Ordering::Relaxed), fresh: true });
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

async fn process_keys(app: tauri::AppHandle, mut receiver: tokio::sync::mpsc::UnboundedReceiver<KeyEvent>) {
    use tauri::Manager;
    let mut gesture = Gesture::default();
    let mut generation = super::CAPTURE_GENERATION.load(Ordering::Relaxed);
    let mut owns_recording = false;
    loop {
        let event = if let Some(deadline) = gesture.deadline() {
            tokio::select! {
                biased;
                event = receiver.recv() => { let Some(event) = event else { break }; Some(event) }
                _ = tokio::time::sleep_until(deadline.into()) => None,
            }
        } else { let Some(event) = receiver.recv().await else { break }; Some(event) };
        let current = super::CAPTURE_GENERATION.load(Ordering::Relaxed);
        if current != generation { gesture.reset(); owns_recording = false; generation = current; }
        let enabled = MODIFIER_ENABLED.load(Ordering::Relaxed) && !super::CAPTURING.load(Ordering::Relaxed);
        let action = if let Some(event) = event {
            gesture.key(event.key, event.down, enabled && event.generation == current && event.fresh, event.at)
        } else { gesture.activate(enabled, Instant::now()) };
        let Some(action) = action else { continue };
        if super::CAPTURING.load(Ordering::Relaxed) { continue; }
        match action {
            Action::Down(at) => {
                let phase = app.state::<std::sync::Arc<super::AppState>>().snapshot().map(|s| s.state).unwrap_or_default();
                owns_recording = super::handle_timed(&app, true, at, Some("ControlRight")) && !matches!(phase.as_str(), "recording" | "preparing" | "busy");
            }
            Action::Up => { super::handle_timed(&app, false, Instant::now(), Some("ControlRight")); owns_recording = false; }
            Action::Tap(at) => {
                // A quick tap toggles only modes that promise tap behavior.
                let tap = app.state::<std::sync::Arc<super::AppState>>().store.preferences().is_ok_and(|p| p.shortcut == "ControlRight" && p.shortcut_mode != "pushToTalk");
                if tap { super::handle_timed(&app, true, at, Some("ControlRight")); super::handle_timed(&app, false, Instant::now(), Some("ControlRight")); }
            }
            Action::Cancel => { super::cancel_right_control(&app, owns_recording); owns_recording = false; }
        }
    }
}

pub fn attach(controller: &ICoreWebView2Controller, capturing: &'static AtomicBool, reserved: impl Fn() + 'static) -> windows_core::Result<()> {
    // Let key events reach the DOM while recording. Handled=true would swallow
    // them, while this property skips only WebView2's print/reload/find actions.
    // Outside capture, the browser keeps its normal keyboard behavior.
    unsafe {
        controller.add_AcceleratorKeyPressed(
            &AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                if capturing.load(Ordering::Relaxed) {
                    if let Some(args) = args {
                        let mut key = 0;
                        args.VirtualKey(&mut key)?;
                        if key == u32::from(VK_SPACE.0) {
                            let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                            args.PhysicalKeyStatus(&mut status)?;
                            let mut mods = Modifiers::empty();
                            if status.IsMenuKeyDown.as_bool() { mods |= Modifiers::ALT; }
                            if GetKeyState(i32::from(VK_CONTROL.0)) < 0 { mods |= Modifiers::CONTROL; }
                            if GetKeyState(i32::from(VK_SHIFT.0)) < 0 { mods |= Modifiers::SHIFT; }
                            if GetKeyState(i32::from(VK_LWIN.0)) < 0 || GetKeyState(i32::from(VK_RWIN.0)) < 0 { mods |= Modifiers::SUPER; }
                            if super::windows_system_menu(&Shortcut::new(Some(mods), Code::Space)) {
                                // DOM preventDefault is too late for a native
                                // system accelerator. Swallow it only during
                                // capture and reject the candidate explicitly.
                                args.SetHandled(true)?;
                                if !status.IsKeyReleased.as_bool() && !status.WasKeyDown.as_bool() { reserved(); }
                                return Ok(());
                            }
                        }
                        // Older WebView2 versions may not expose args2. A
                        // missing optional interface must not fail a callback.
                        if let Ok(args) = args.cast::<ICoreWebView2AcceleratorKeyPressedEventArgs2>() {
                            args.SetIsBrowserAcceleratorKeyEnabled(false)?;
                        }
                    }
                }
                Ok(())
            })),
            &mut 0,
        )
    }
}
