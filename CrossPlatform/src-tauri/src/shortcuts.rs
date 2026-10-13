use crate::{
    engine::{self, AppState},
    store::err,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
#[cfg(target_os = "windows")]
mod windows;
#[cfg(any(target_os = "windows", test))]
mod right_control;

static APP: OnceLock<AppHandle> = OnceLock::new();
static CAPTURING: AtomicBool = AtomicBool::new(false);
static CAPTURE_GENERATION: AtomicU64 = AtomicU64::new(0);
struct Press {
    started: Instant,
    behavior: String,
    shortcut: String,
}
static PRESSED: Mutex<Option<Press>> = Mutex::new(None);
#[derive(Debug)]
enum ShortcutAction {
    Down(String),
    Finish,
    Cancel,
}
async fn in_order<T, F, Fut>(mut receiver: tokio::sync::mpsc::UnboundedReceiver<T>, mut perform: F)
where
    F: FnMut(T) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    while let Some(event) = receiver.recv().await {
        perform(event).await;
    }
}
// Enqueue synchronously in callback order. A fast release must wait for its
// press to open the recorder, rather than winning a race between spawned tasks.
fn enqueue(app: AppHandle, state: Arc<AppState>, action: ShortcutAction) {
    type Event = (AppHandle, Arc<AppState>, ShortcutAction);
    static EVENTS: OnceLock<tokio::sync::mpsc::UnboundedSender<Event>> = OnceLock::new();
    let sender = EVENTS.get_or_init(|| {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel::<Event>();
        tauri::async_runtime::spawn(in_order(receiver, |(app, state, action)| async move {
            let phase = state.snapshot().map(|s| s.state).unwrap_or_default();
            let action = match action {
                ShortcutAction::Down(_) if phase == "preparing" || phase == "busy" => return,
                ShortcutAction::Down(behavior) if phase == "recording" => {
                    if behavior == "pushToTalk" {
                        return;
                    }
                    "finish"
                }
                ShortcutAction::Down(_) => "record",
                ShortcutAction::Finish => "finish",
                ShortcutAction::Cancel => "cancel",
            };
            if let Err(error) = engine::action(app.clone(), state, action).await {
                let _ = app.emit("app-error", error);
            }
        }));
        sender
    });
    let _ = sender.send((app, state, action));
}
fn release_finishes(behavior: &str, milliseconds: u128) -> bool {
    behavior == "pushToTalk" || (behavior == "hybrid" && milliseconds >= 500)
}
static MODIFIER_DOWN: AtomicBool = AtomicBool::new(false);

pub fn default_shortcut(platform: &str) -> &'static str {
    if platform == "windows" { "ControlRight" } else { "Alt+Space" }
}
pub fn default_shortcut_mode(platform: &str) -> &'static str {
    if platform == "windows" { "pushToTalk" } else { "toggle" }
}
fn windows_system_menu(shortcut: &Shortcut) -> bool {
    shortcut.mods == Modifiers::ALT && shortcut.key == Code::Space
}
pub fn modifier(value: &str) -> Option<(u16, u64)> {
    Some(match value {
        "AltRight" => (61, 1 << 19),
        "AltLeft" => (58, 1 << 19),
        "ControlRight" => (62, 1 << 18),
        "ControlLeft" => (59, 1 << 18),
        "ShiftRight" => (60, 1 << 17),
        "ShiftLeft" => (56, 1 << 17),
        "MetaRight" => (54, 1 << 20),
        "MetaLeft" => (55, 1 << 20),
        "Fn" => (63, 1 << 23),
        _ => return None,
    })
}
pub fn validate_shortcut(value: &str, platform: &str) -> Result<(), String> {
    if platform == "windows" && value == "ControlRight" { return Ok(()); }
    if modifier(value).is_some() {
        return if platform == "macos" { Ok(()) } else {
            Err("Use a modifier with a regular key, such as Ctrl+Alt+D.".into())
        };
    }
    let shortcut: Shortcut = value.parse()
        .map_err(|_| "Press a supported shortcut with a modifier, such as Ctrl+Alt+D.")?;
    let function_key = shortcut.key.to_string().strip_prefix('F')
        .and_then(|number| number.parse::<u8>().ok()).is_some_and(|number| (1..=24).contains(&number));
    if shortcut.mods.is_empty() && !function_key {
        return Err("Use a modifier with a regular key, or a function key.".into());
    }
    let alt = shortcut.mods.contains(Modifiers::ALT);
    let control = shortcut.mods.contains(Modifiers::CONTROL);
    let system = shortcut.mods.contains(Modifiers::SUPER);
    if platform == "windows" && windows_system_menu(&shortcut) {
        return Err(crate::localization::message("native.shortcut.windows_system_menu"));
    }
    let reserved = (alt && shortcut.key == Code::F4)
        || (platform == "macos" && system && matches!(shortcut.key, Code::KeyQ | Code::KeyW | Code::KeyH))
        || (platform == "windows" && (system || shortcut.key == Code::F12
            || (alt && matches!(shortcut.key, Code::Tab | Code::Escape))
            || (control && (shortcut.key == Code::Escape || (alt && shortcut.key == Code::Delete)))));
    if reserved { return Err("This shortcut is reserved by the operating system. Choose another combination.".into()); }
    Ok(())
}
pub fn portable_shortcut(value: &str, platform: &str) -> String {
    // Older releases stored Alt+Space without recording whether it was a
    // default or a manual choice. Preserve it, but refuse OS registration.
    // Only absent preferences use the new default; never guess provenance.
    if value.parse::<Shortcut>().is_ok_and(|shortcut| windows_system_menu(&shortcut)) {
        return value.into();
    }
    if platform == "windows" && validate_shortcut(value, platform).is_err() {
        "Control+Alt+D".into()
    } else {
        value.into()
    }
}
pub fn configure(app: &AppHandle, value: &str) -> Result<(), String> {
    let previous = app.state::<Arc<AppState>>().store.preferences()?.shortcut;
    configure_from(app, value, &previous)
}
pub fn configure_from(app: &AppHandle, value: &str, previous: &str) -> Result<(), String> {
    prepare_from(app, value, previous)?.commit();
    Ok(())
}

trait ShortcutRegistry {
    fn is_registered(&self, shortcut: Shortcut) -> bool;
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String>;
    fn cleanup_error(&self, error: String);
}
struct AppRegistry(AppHandle);
impl ShortcutRegistry for AppRegistry {
    fn is_registered(&self, shortcut: Shortcut) -> bool { self.0.global_shortcut().is_registered(shortcut) }
    fn register(&self, shortcut: Shortcut) -> Result<(), String> { self.0.global_shortcut().register(shortcut).map_err(err) }
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> { self.0.global_shortcut().unregister(shortcut).map_err(err) }
    fn cleanup_error(&self, error: String) { let _ = self.0.emit("app-error", error); }
}
// Until preferences are committed, both the old and the replacement shortcuts
// stay registered. Failed saves remove only the registration this edit added.
struct Registration<R: ShortcutRegistry> {
    registry: R,
    next: Option<Shortcut>,
    previous: Option<Shortcut>,
    created: bool,
    committed: bool,
}
impl<R: ShortcutRegistry> Registration<R> {
    fn prepare(registry: R, value: &str, previous: &str, platform: &str) -> Result<Self, String> {
        validate_shortcut(value, platform)?;
        let next = if modifier(value).is_some() { None } else { Some(value.parse::<Shortcut>().map_err(err)?) };
        let previous = previous.parse::<Shortcut>().ok();
        let created = next.is_some_and(|next| !registry.is_registered(next));
        if let Some(next) = next.filter(|_| created) {
            registry.register(next).map_err(|e| format!("This shortcut could not be registered: {e}. Your previous shortcut is unchanged."))?;
        }
        Ok(Self { registry, next, previous, created, committed: false })
    }
    fn commit(mut self, held: bool) {
        self.committed = true;
        // Spelling aliases may refer to the same native shortcut. A held old
        // key keeps its release handler until handle() receives its key-up.
        if !held {
            if let Some(previous) = self.previous.filter(|old| Some(*old) != self.next) {
                if self.registry.is_registered(previous) {
                    if let Err(error) = self.registry.unregister(previous) { self.registry.cleanup_error(error); }
                }
            }
        }
    }
}
impl<R: ShortcutRegistry> Drop for Registration<R> {
    fn drop(&mut self) {
        if self.created && !self.committed {
            if let Some(next) = self.next {
                if let Err(error) = self.registry.unregister(next) { self.registry.cleanup_error(error); }
            }
        }
    }
}
pub struct ShortcutChange {
    registration: Registration<AppRegistry>,
    previous: String,
    #[cfg(target_os = "windows")]
    right_control: bool,
}
pub fn prepare_from(app: &AppHandle, value: &str, previous: &str) -> Result<ShortcutChange, String> {
    #[cfg(target_os = "windows")]
    if value == "ControlRight" { windows::ensure_modifier_monitor(app)?; }
    Ok(ShortcutChange { registration: Registration::prepare(AppRegistry(app.clone()), value, previous, std::env::consts::OS)?, previous: previous.into(), #[cfg(target_os = "windows")] right_control: value == "ControlRight" })
}
impl ShortcutChange {
    pub fn commit(self) {
        let held = PRESSED.lock().ok().is_some_and(|p| p.as_ref().is_some_and(|p| p.shortcut == self.previous));
        self.registration.commit(held);
        #[cfg(target_os = "windows")]
        windows::set_modifier_enabled(self.right_control);
        if PRESSED.lock().ok().is_none_or(|p| p.is_none()) {
            MODIFIER_DOWN.store(false, Ordering::Relaxed);
        }
    }
}

fn matches_registered_shortcut(shortcut: &Shortcut, expected: &str) -> bool {
    expected
        .parse::<Shortcut>()
        .is_ok_and(|expected| *shortcut == expected)
}
pub fn handle_registered(app: &AppHandle, shortcut: &Shortcut, down: bool) {
    // The plugin invokes this callback while holding its registration mutex.
    // Reading SQLite here can deadlock with a settings save that owns SQLite
    // and waits for that mutex. Unregistering on release re-enters it as well.
    // A single queue keeps press/release order and performs both outside it.
    type Event = (AppHandle, Shortcut, bool, u64);
    static EVENTS: OnceLock<tokio::sync::mpsc::UnboundedSender<Event>> = OnceLock::new();
    let generation = CAPTURE_GENERATION.load(Ordering::Relaxed);
    if CAPTURING.load(Ordering::Relaxed) { return; }
    let sender = EVENTS.get_or_init(|| {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<Event>();
        tauri::async_runtime::spawn(async move {
            while let Some((app, shortcut, down, generation)) = receiver.recv().await {
                if generation == CAPTURE_GENERATION.load(Ordering::Relaxed) {
                    process_registered(&app, &shortcut, down);
                }
            }
        });
        sender
    });
    let _ = sender.send((app.clone(), *shortcut, down, generation));
}
fn process_registered(app: &AppHandle, shortcut: &Shortcut, down: bool) {
    if CAPTURING.load(Ordering::Relaxed) { return; }
    let held = PRESSED
        .lock()
        .ok()
        .and_then(|p| p.as_ref().map(|p| p.shortcut.clone()));
    let expected = if down {
        app.state::<Arc<AppState>>()
            .store
            .preferences()
            .ok()
            .map(|p| p.shortcut)
    } else {
        held
    };
    if expected.is_some_and(|expected| matches_registered_shortcut(shortcut, &expected)) {
        handle(app, down);
    }
}

pub fn handle(app: &AppHandle, down: bool) {
    handle_timed(app, down, Instant::now(), None);
}
fn handle_timed(app: &AppHandle, down: bool, started: Instant, required: Option<&str>) -> bool {
    if CAPTURING.load(Ordering::Relaxed) {
        return false;
    }
    let state = app.state::<Arc<AppState>>().inner().clone();
    let p = state.store.preferences().unwrap_or_default();
    if down && required.is_some_and(|value| value != p.shortcut) { return false; }
    let press = {
        let Ok(mut pressed) = PRESSED.lock() else {
            return false;
        };
        if down {
            if pressed.is_some() {
                return false;
            }
            let behavior = state
                .runtime
                .lock()
                .ok()
                .and_then(|r| {
                    r.session
                        .as_ref()
                        .map(|s| s.preferences.shortcut_mode.clone())
                })
                .unwrap_or_else(|| p.shortcut_mode.clone());
            *pressed = Some(Press {
                started,
                behavior: behavior.clone(),
                shortcut: p.shortcut.clone(),
            });
            enqueue(app.clone(), state, ShortcutAction::Down(behavior));
            return true;
        }
        if required.is_some_and(|value| pressed.as_ref().is_none_or(|p| p.shortcut != value)) { return false; }
        let Some(press) = pressed.take() else {
            return false;
        };
        press
    };
    if press.shortcut != p.shortcut && modifier(&press.shortcut).is_none() {
        if let Ok(old) = press.shortcut.parse::<Shortcut>() {
            if !matches_registered_shortcut(&old, &p.shortcut) {
                let _ = app.global_shortcut().unregister(old);
            }
        }
    }
    if release_finishes(&press.behavior, press.started.elapsed().as_millis()) {
        enqueue(app.clone(), state, ShortcutAction::Finish);
    }
    true
}
#[cfg(target_os = "windows")]
fn cancel_right_control(app: &AppHandle, owns_recording: bool) {
    let removed = PRESSED.lock().ok().is_some_and(|mut p| {
        if p.as_ref().is_some_and(|p| p.shortcut == "ControlRight") { p.take(); true } else { false }
    });
    if removed && owns_recording { enqueue(app.clone(), app.state::<Arc<AppState>>().inner().clone(), ShortcutAction::Cancel); }
}

#[tauri::command]
pub fn shortcut_capture(app: AppHandle, active: bool) -> Result<(), String> {
    if CAPTURING.load(Ordering::Relaxed) == active { return Ok(()); }
    CAPTURE_GENERATION.fetch_add(1, Ordering::Relaxed);
    *PRESSED.lock().map_err(err)? = None;
    MODIFIER_DOWN.store(false, Ordering::Relaxed);
    if active {
        CAPTURING.store(true, Ordering::Relaxed);
        if let Err(error) = app.global_shortcut().unregister_all().map_err(err) {
            CAPTURING.store(false, Ordering::Relaxed);
            return Err(error);
        }
    } else {
        let result = app.state::<Arc<AppState>>().store.preferences()
            .and_then(|p| configure_from(&app, &p.shortcut, &p.shortcut));
        CAPTURING.store(false, Ordering::Relaxed);
        result?;
    }
    Ok(())
}

pub fn initialize(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window("main") {
        let handle = app.clone();
        if let Err(error) = window.with_webview(move |webview| {
            let reserved_app = handle.clone();
            if let Err(error) = windows::attach(&webview.controller(), &CAPTURING, move || {
                let app = reserved_app.clone();
                tauri::async_runtime::spawn(async move { let _ = app.emit("shortcut-reserved", ()); });
            }) {
                let _ = handle.emit("app-error", format!("Could not initialize shortcut capture: {error}"));
            }
        }) {
            let _ = app.emit("app-error", format!("Could not initialize shortcut capture: {error}"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn no_tipe_monitor_modifiers(callback: extern "C" fn(u16, u64, bool) -> bool);
        }
        let _ = app.run_on_main_thread(|| unsafe { no_tipe_monitor_modifiers(modifier_event) });
    }
}
#[cfg(target_os = "macos")]
extern "C" fn modifier_event(code: u16, flags: u64, is_modifier: bool) -> bool {
    let Some(app) = APP.get() else {
        return false;
    };
    let relevant = flags & ((1 << 17) | (1 << 18) | (1 << 19) | (1 << 20) | (1 << 23));
    if CAPTURING.load(Ordering::Relaxed) {
        if !is_modifier && flags & (1 << 20) != 0 && [12, 13, 4].contains(&code) {
            let _ = app.emit("shortcut-reserved", ());
            return true;
        }
        if is_modifier {
            let _ = app.emit(
                "shortcut-modifier",
                serde_json::json!({"code":code,"flags":relevant}),
            );
        }
        return false;
    }
    let Ok(p) = app.state::<Arc<AppState>>().store.preferences() else {
        return false;
    };
    let held = PRESSED
        .lock()
        .ok()
        .and_then(|p| p.as_ref().map(|p| p.shortcut.clone()));
    let shortcut = held.as_deref().unwrap_or(&p.shortcut);
    let Some((key, mask)) = modifier(shortcut) else {
        return false;
    };
    if !is_modifier {
        // Option+letter must not leave an accidental dictation running.
        let accidental = MODIFIER_DOWN.load(Ordering::Relaxed)
            && PRESSED.lock().ok().is_some_and(|mut p| {
                if p.as_ref()
                    .is_some_and(|p| p.started.elapsed().as_secs_f32() < 1.)
                {
                    p.take();
                    true
                } else {
                    false
                }
            });
        if accidental {
            MODIFIER_DOWN.store(false, Ordering::Relaxed);
            let state = app.state::<Arc<AppState>>().inner().clone();
            enqueue(app.clone(), state, ShortcutAction::Cancel);
        }
        return false;
    }
    let was = MODIFIER_DOWN.load(Ordering::Relaxed);
    if was && (code == key || relevant & mask == 0) {
        MODIFIER_DOWN.store(false, Ordering::Relaxed);
        handle(app, false);
    } else if !was && code == key && relevant == mask {
        MODIFIER_DOWN.store(true, Ordering::Relaxed);
        handle(app, true);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct RegistryState {
        registered: Vec<Shortcut>,
        blocked: Option<Shortcut>,
        cleanup_errors: Vec<String>,
    }
    #[derive(Clone, Default)]
    struct TestRegistry(Arc<Mutex<RegistryState>>);
    impl ShortcutRegistry for TestRegistry {
        fn is_registered(&self, shortcut: Shortcut) -> bool { self.0.lock().unwrap().registered.contains(&shortcut) }
        fn register(&self, shortcut: Shortcut) -> Result<(), String> {
            let mut state = self.0.lock().unwrap();
            if state.blocked == Some(shortcut) { return Err("Shortcut is already registered".into()); }
            assert!(!state.registered.contains(&shortcut));
            state.registered.push(shortcut);
            Ok(())
        }
        fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
            let mut state = self.0.lock().unwrap();
            let index = state.registered.iter().position(|old| *old == shortcut).ok_or("Not registered")?;
            state.registered.remove(index);
            Ok(())
        }
        fn cleanup_error(&self, error: String) { self.0.lock().unwrap().cleanup_errors.push(error); }
    }
    impl TestRegistry {
        fn with_previous() -> Self {
            let registry = Self::default();
            registry.register("Control+Space".parse().unwrap()).unwrap();
            registry
        }
        fn has(&self, value: &str) -> bool { self.is_registered(value.parse().unwrap()) }
    }
    fn change_in_store(store: &crate::store::Store, registry: &TestRegistry, shortcut: &str) -> Result<crate::domain::Preferences, String> {
        store.update_preferences_with_commit(|previous| {
            let effect = Registration::prepare(registry.clone(), shortcut, &previous.shortcut, "windows")?;
            previous.shortcut = shortcut.into();
            Ok(effect)
        }, |effect| effect.commit(false))
    }
    #[test]
    fn registration_conflicts_and_reserved_keys_never_discard_the_previous_shortcut() {
        let registry = TestRegistry::with_previous();
        registry.0.lock().unwrap().blocked = Some("Control+Alt+D".parse().unwrap());
        assert!(Registration::prepare(registry.clone(), "Control+Alt+D", "Control+Space", "windows").is_err());
        assert!(Registration::prepare(registry.clone(), "Alt+Space", "Control+Space", "windows").is_err());
        assert!(registry.has("Control+Space"));
        assert_eq!(registry.0.lock().unwrap().registered.len(), 1);
    }
    #[test]
    fn replacement_keeps_old_registration_until_commit_and_rolls_back_only_its_own_registration() {
        let registry = TestRegistry::with_previous();
        let pending = Registration::prepare(registry.clone(), "Control+Alt+D", "Control+Space", "windows").unwrap();
        assert!(registry.has("Control+Space") && registry.has("Control+Alt+D"));
        drop(pending);
        assert!(registry.has("Control+Space") && !registry.has("Control+Alt+D"));
        Registration::prepare(registry.clone(), "Ctrl+Space", "Control+Space", "windows").unwrap().commit(false);
        assert!(registry.has("Control+Space"));
        drop(Registration::prepare(registry.clone(), "Ctrl+Space", "Control+Space", "windows").unwrap());
        assert!(registry.has("Control+Space"));
        Registration::prepare(registry.clone(), "Control+Alt+D", "Control+Space", "windows").unwrap().commit(false);
        assert!(!registry.has("Control+Space") && registry.has("Control+Alt+D"));
        assert!(registry.0.lock().unwrap().cleanup_errors.is_empty());
    }
    #[test]
    fn held_shortcuts_and_mac_modifier_replacements_keep_the_release_handler_until_commit() {
        let registry = TestRegistry::with_previous();
        Registration::prepare(registry.clone(), "Control+Alt+D", "Control+Space", "windows").unwrap().commit(true);
        assert!(registry.has("Control+Space") && registry.has("Control+Alt+D"));
        let pending = Registration::prepare(registry.clone(), "AltRight", "Control+Space", "macos").unwrap();
        drop(pending);
        assert!(registry.has("Control+Space"));
        Registration::prepare(registry.clone(), "AltRight", "Control+Space", "macos").unwrap().commit(false);
        assert!(!registry.has("Control+Space"));
    }
    #[test]
    fn sqlite_write_failure_rolls_back_the_replacement_and_preserves_persisted_choices() {
        let root = std::env::temp_dir().join(format!("no-tipe-shortcut-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        let original = crate::domain::Preferences::default().patched(&serde_json::json!({"shortcut":"Control+Space","shortcutMode":"hybrid"})).unwrap();
        store.set_preferences(&original).unwrap();
        let registry = TestRegistry::with_previous();
        store.db.lock().unwrap().execute_batch("CREATE TRIGGER fail_shortcut_write BEFORE UPDATE ON metadata WHEN NEW.key='preferences' BEGIN SELECT RAISE(ABORT, 'test write failure'); END;").unwrap();
        assert!(change_in_store(&store, &registry, "Control+Alt+D").unwrap_err().contains("test write failure"));
        assert!(registry.has("Control+Space") && !registry.has("Control+Alt+D"));
        assert_eq!(store.preferences().unwrap().shortcut, original.shortcut);
        assert_eq!(store.preferences().unwrap().shortcut_mode, "hybrid");
        store.db.lock().unwrap().execute_batch("DROP TRIGGER fail_shortcut_write;").unwrap();
        change_in_store(&store, &registry, "Control+Alt+D").unwrap();
        assert!(!registry.has("Control+Space") && registry.has("Control+Alt+D"));
        assert_eq!(crate::store::Store::open(&root).unwrap().preferences().unwrap().shortcut, "Control+Alt+D");
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn backup_commit_failure_rolls_back_registration_preferences_and_imported_rows() {
        let root = std::env::temp_dir().join(format!("no-tipe-shortcut-backup-{}", uuid::Uuid::new_v4()));
        let store = crate::store::Store::open(&root).unwrap();
        let original = crate::domain::Preferences::default().patched(&serde_json::json!({"shortcut":"Control+Space"})).unwrap();
        store.set_preferences(&original).unwrap();
        let registry = TestRegistry::with_previous();
        let mut backup = store.backup().unwrap();
        backup.preferences.shortcut = "Control+Alt+D".into();
        backup.dictionary.push(crate::domain::DictionaryEntry { id:"test-import".into(), word:"example".into(), replacement:None, enabled:true });
        // A deferred FK deliberately fails COMMIT after OS registration was
        // prepared, rather than failing a row insert before effects are applied.
        store.db.lock().unwrap().execute_batch("CREATE TABLE shortcut_parent(id INTEGER PRIMARY KEY); CREATE TABLE shortcut_child(parent INTEGER REFERENCES shortcut_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail_shortcut_commit AFTER UPDATE ON metadata WHEN NEW.key='preferences' BEGIN INSERT INTO shortcut_child VALUES(1); END;").unwrap();
        let error = store.import_backup_with_commit(backup, |previous, next| {
            assert_eq!(previous.shortcut, "Control+Space");
            Registration::prepare(registry.clone(), &next.shortcut, &previous.shortcut, "windows")
        }, |effect| effect.commit(false)).unwrap_err();
        assert!(error.contains("FOREIGN KEY"));
        assert!(registry.has("Control+Space") && !registry.has("Control+Alt+D"));
        assert_eq!(store.preferences().unwrap().shortcut, original.shortcut);
        assert!(store.list::<crate::domain::DictionaryEntry>("dictionary").unwrap().is_empty());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn windows_shortcuts_match_the_capture_rules() {
        for value in ["ControlRight", "Control+Alt+Shift+D", "Control+Space", "Ctrl+Space", "Control+Alt+D", "Ctrl+Alt+KeyD", "Control+Alt+Space", "Alt+Shift+Space", "F8", "F24", "Control+Numpad1", "Control+NumpadAdd"] {
            assert!(validate_shortcut(value, "windows").is_ok(), "{value}");
        }
        for value in ["Alt+Space", "alt+space", "Option+Space", "AltRight", "ControlLeft", "ShiftRight", "MetaLeft", "Fn", "A", "Super+D", "F12", "Control+F12", "Alt+F4", "Alt+Tab", "Alt+Escape", "Control+Escape", "Control+Shift+Escape", "Control+Alt+Delete", "F25"] {
            assert!(validate_shortcut(value, "windows").is_err(), "{value}");
        }
        assert!(validate_shortcut("AltRight", "macos").is_ok());
        assert!(validate_shortcut("Fn", "macos").is_ok());
        assert!(validate_shortcut("F12", "macos").is_ok());
        assert!(validate_shortcut("Super+Q", "macos").is_err());
        assert!(validate_shortcut("Alt+Space", "macos").is_ok());
    }
    #[test]
    fn defaults_and_saved_choices_remain_platform_specific() {
        assert_eq!(default_shortcut("windows"), "ControlRight");
        assert_eq!(default_shortcut_mode("windows"), "pushToTalk");
        for platform in ["macos", "linux"] {
            assert_eq!(default_shortcut(platform), "Alt+Space");
            assert_eq!(default_shortcut_mode(platform), "toggle");
        }
        let defaults: crate::domain::Preferences = serde_json::from_str("{}").unwrap();
        assert_eq!(defaults.shortcut, if crate::channel::DEVELOPER { "Control+Alt+Shift+Space" } else { default_shortcut(std::env::consts::OS) });
        assert_eq!(defaults.shortcut_mode, default_shortcut_mode(std::env::consts::OS));
        for (shortcut, behavior) in [("Ctrl+Space", "toggle"), ("Control+Alt+D", "hybrid"), ("Alt+Space", "pushToTalk")] {
            let stored: crate::domain::Preferences = serde_json::from_value(serde_json::json!({"shortcut": shortcut, "shortcutMode": behavior})).unwrap();
            assert_eq!(portable_shortcut(&stored.shortcut, "windows"), shortcut);
            assert_eq!(stored.shortcut_mode, behavior);
        }
    }
    #[test]
    fn mac_backups_adapt_only_incompatible_shortcuts_on_windows() {
        for value in ["AltRight", "Fn", "Super+D", "F12"] {
            assert_eq!(portable_shortcut(value, "windows"), "Control+Alt+D");
            assert_eq!(portable_shortcut(value, "macos"), value);
        }
        assert_eq!(portable_shortcut("Control+Alt+Space", "windows"), "Control+Alt+Space");
    }
    #[test]
    fn release_uses_the_behavior_from_the_press_and_hybrid_threshold() {
        assert!(release_finishes("pushToTalk", 0));
        assert!(release_finishes("pushToTalk", 1));
        assert!(!release_finishes("toggle", 1000));
        assert!(!release_finishes("hybrid", 499));
        assert!(release_finishes("hybrid", 500));
    }
    #[test]
    fn only_the_held_shortcuts_release_can_finish_its_recording() {
        let old: Shortcut = "Alt+Space".parse().unwrap();
        let next: Shortcut = "Control+Space".parse().unwrap();
        assert!(matches_registered_shortcut(&old, "Alt+Space"));
        assert!(matches_registered_shortcut(&old, "alt+space"));
        assert!(matches_registered_shortcut(&"Control+Alt+D".parse().unwrap(), "Ctrl+Alt+KeyD"));
        assert!(!matches_registered_shortcut(&next, "Alt+Space"));
        assert!(!matches_registered_shortcut(&old, "AltRight"));
    }
    #[tokio::test]
    async fn immediate_release_waits_for_slow_start_before_finishing() {
        let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
        let phases = Arc::new(Mutex::new(Vec::new()));
        let observed = phases.clone();
        sender.send("record").unwrap();
        sender.send("finish").unwrap();
        sender.send("record").unwrap();
        sender.send("cancel").unwrap();
        drop(sender);
        in_order(receiver, move |action| {
            let phases = observed.clone();
            async move {
                if action == "record" {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
                let mut phases = phases.lock().unwrap();
                if action == "finish" {
                    assert_eq!(phases.last(), Some(&"record"));
                }
                phases.push(action);
            }
        })
        .await;
        assert_eq!(
            *phases.lock().unwrap(),
            ["record", "finish", "record", "cancel"]
        );
    }
}
