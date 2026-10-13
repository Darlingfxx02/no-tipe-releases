//! Shared UI catalogs also supply native menus and application-owned errors.
//! Error markers stay language-neutral in storage; the view translates them.
use std::{collections::HashMap, sync::LazyLock};
use tauri::{menu::{Menu, MenuItem}, AppHandle};

static EN: LazyLock<HashMap<String, String>> = LazyLock::new(|| serde_json::from_str(include_str!("../../src/locales/en.json")).expect("English catalog"));
static RU: LazyLock<HashMap<String, String>> = LazyLock::new(|| serde_json::from_str(include_str!("../../src/locales/ru.json")).expect("Russian catalog"));

pub fn resolve(preference: &str) -> &'static str {
    if preference == "ru" { return "ru"; }
    if preference == "en" { return "en"; }
    let system = sys_locale::get_locale().unwrap_or_default();
    if system.split(['-', '_']).next().is_some_and(|code| code.eq_ignore_ascii_case("ru")) { "ru" } else { "en" }
}
pub fn text<'a>(preference: &str, key: &'a str) -> &'a str {
    let catalog = if resolve(preference) == "ru" { &*RU } else { &*EN };
    catalog.get(key).or_else(|| EN.get(key)).map(String::as_str).unwrap_or(key)
}
pub fn message(key: &str) -> String { format!("no-tipe-i18n:{key}") }
pub fn message_with_values(key: &str, values: serde_json::Value) -> String {
    format!("no-tipe-i18n:{}", serde_json::json!({"key":key,"values":values}))
}
pub fn is_no_speech(error: &str) -> bool {
    matches!(error.trim().to_ascii_lowercase().as_str(),
        "no speech detected" | "no speech text was returned" |
        "no-tipe-i18n:native.no_speech" | "no-tipe-i18n:native.no_speech_text")
}
pub fn menu(app: &AppHandle, preference: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let open = MenuItem::with_id(app, "open", text(preference,"native.open"), true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", text(preference,"native.record"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", text(preference,"native.quit"), true, None::<&str>)?;
    Menu::with_items(app, &[&open, &record, &quit])
}
pub fn update_menu(app: &AppHandle, preference: &str) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu(app, preference).map_err(crate::store::err)?)).map_err(crate::store::err)?;
    }
    #[cfg(target_os = "macos")]
    app.set_menu(application_menu(app,preference).map_err(crate::store::err)?).map_err(crate::store::err)?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn application_menu(app:&AppHandle,preference:&str)->tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata,PredefinedMenuItem,Submenu,HELP_SUBMENU_ID,WINDOW_SUBMENU_ID};
    macro_rules! item {
        ($kind:ident,$key:literal)=>{PredefinedMenuItem::$kind(app,Some(text(preference,$key)))?};
    }
    let about=AboutMetadata {name:Some(crate::channel::NAME.into()),version:Some(app.package_info().version.to_string()),copyright:app.config().bundle.copyright.clone(),..Default::default()};
    let application=Submenu::with_items(app,crate::channel::NAME,true,&[
        &PredefinedMenuItem::about(app,Some(text(preference,"native.menu_about")),Some(about))?,
        &PredefinedMenuItem::separator(app)?,&item!(services,"native.menu_services"),
        &PredefinedMenuItem::separator(app)?,&item!(hide,"native.menu_hide"),&item!(hide_others,"native.menu_hide_others"),&item!(show_all,"native.menu_show_all"),
        &PredefinedMenuItem::separator(app)?,&item!(quit,"native.menu_quit"),
    ])?;
    let file=Submenu::with_items(app,text(preference,"native.menu_file"),true,&[&item!(close_window,"native.menu_close")])?;
    let edit=Submenu::with_items(app,text(preference,"native.menu_edit"),true,&[
        &item!(undo,"native.menu_undo"),&item!(redo,"native.menu_redo"),&PredefinedMenuItem::separator(app)?,
        &item!(cut,"native.menu_cut"),&item!(copy,"native.menu_copy"),&item!(paste,"native.menu_paste"),&item!(select_all,"native.menu_select_all"),
    ])?;
    let view=Submenu::with_items(app,text(preference,"native.menu_view"),true,&[&item!(fullscreen,"native.menu_fullscreen")])?;
    let window=Submenu::with_id_and_items(app,WINDOW_SUBMENU_ID,text(preference,"native.menu_window"),true,&[
        &item!(minimize,"native.menu_minimize"),&item!(maximize,"native.menu_zoom"),&PredefinedMenuItem::separator(app)?,&item!(close_window,"native.menu_close"),
    ])?;
    let help=Submenu::with_id_and_items(app,HELP_SUBMENU_ID,text(preference,"native.menu_help"),true,&[])?;
    Menu::with_items(app,&[&application,&file,&edit,&view,&window,&help])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_catalogs_and_explicit_languages() {
        assert_eq!(resolve("en"), "en"); assert_eq!(resolve("ru"), "ru");
        assert_eq!(text("ru", "native.quit"), "Выйти");
        assert_eq!(text("en", "native.quit"), "Quit");
        assert!(EN.keys().all(|key| RU.contains_key(key)));
    }
    #[test]
    fn old_preferences_default_to_system_without_changing_dictation_language() {
        let p: crate::domain::Preferences = serde_json::from_str(r#"{"language":"ru"}"#).unwrap();
        assert_eq!(p.ui_language, "system"); assert_eq!(p.language, "ru");
        let next=p.patched(&serde_json::json!({"uiLanguage":"en"})).unwrap();
        assert_eq!(next.language, "ru"); assert_eq!(next.ui_language, "en");
        assert!(p.patched(&serde_json::json!({"uiLanguage":"fr"})).is_err());
    }
}
