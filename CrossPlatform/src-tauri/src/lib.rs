mod audio;
mod channel;
mod diagnostics;
mod localization;
#[cfg(target_os = "macos")]
mod application_icon;
mod insight_stats;
mod voice_profile;
mod commands;
mod credentials;
mod api_connections;
mod legacy;
mod domain;
mod dock;
mod engine;
mod empowerment;
mod live;
mod session;
mod reprocessing;
mod file_jobs;
mod migration;
mod models;
mod model_hub;
mod model_download;
mod text_models;
mod local_text;
mod gigaam;
mod sherpa;
mod speech_bundle;
mod permissions;
mod recorder_position;
mod platform;
#[cfg(any(target_os = "windows", test))]
mod paste_evidence;
mod media;
mod providers;
mod whisper_runtime;
mod whisper_benchmark;
pub use whisper_benchmark::command as whisper_benchmark_command;
mod shortcuts;
mod store;
mod snippets;
mod dictionary;
mod text_cleanup;
mod result_edit;
mod updates;
mod telemetry;
mod telemetry_details;
#[cfg(test)]
mod tests;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;

fn configure_shortcut(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    shortcuts::configure(app, value)
}

// Only explicit application-open actions reveal the main window. Recorder
// interaction keeps its separate, nonactivating panel behavior.
fn open_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            open_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri::plugin::Builder::<tauri::Wry, ()>::new("diagnostics")
            .js_init_script(include_str!("diagnostics.js"))
            .build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().pubkey(channel::UPDATER_KEY.trim()).build())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    shortcuts::handle_registered(app, shortcut, event.state() == ShortcutState::Pressed);
                })
                .build(),
        )
        .invoke_handler(|invoke| {
            diagnostics::command_received(&invoke);
            let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
            diagnostics::developer_status,
            diagnostics::developer_logs,
            diagnostics::developer_client_event,
            diagnostics::developer_clear_logs,
            diagnostics::developer_export_logs,
            diagnostics::developer_copy_logs,
            updates::check_updates,
            updates::update_channel,
            updates::save_update_token,
            updates::install_update,
            commands::bootstrap,
            commands::history,
            commands::statistics,
            commands::voice_profile,
            commands::generate_voice_profile,
            commands::save_preferences,
            commands::save_mode,
            commands::save_empowerment,
            commands::delete_empowerment,
            commands::preview_mode,
            commands::processing_models,
            commands::text_models,
            commands::search_model_hub,
            commands::add_hub_model,
            commands::refresh_model_catalog,
            commands::download_text_model,
            commands::add_text_model,
            commands::remove_text_model,
            commands::save_dictionary,
            dictionary::add_dictionary_correction,
            result_edit::save_transcript_correction,
            commands::save_snippet,
            commands::preview_snippet_import,
            commands::import_snippets,
            commands::export_snippets,
            commands::copy_snippet,
            commands::save_model,
            commands::delete_item,
            commands::save_secret,
            commands::connect_api_provider,
            commands::download_model,
            commands::select_speech_model,
            commands::model_download_status,
            commands::cancel_model_download,
            commands::remove_model,
            commands::audio_devices,
            commands::cloud_snapshot,
            commands::cloud_dock_geometry,
            commands::show_cloud,
            commands::set_dashboard_active,
            commands::recorder_action,
            commands::cloud_action,
            commands::transcribe_file,
            commands::cancel_file_transcription,
            commands::transcript,
            commands::transcript_processing_options,
            commands::retry_transcript,
            commands::retry_recognition,
            commands::copy_text,
            commands::copy_system_info,
            commands::open_url,
            commands::request_permissions,
            commands::permission_status,
            commands::complete_onboarding,
            commands::cloud_diagnostics,
            shortcuts::shortcut_capture,
            commands::import_legacy,
            commands::export_backup,
            commands::import_backup,
            commands::export_transcripts,
            commands::window_action
            ];
            handler(invoke)
        })
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            if app.config().identifier != channel::IDENTIFIER || app.package_info().version.to_string() != channel::VERSION {
                return Err("Build configuration does not match the compiled distribution channel".into());
            }
            if !channel::DEVELOPER { legacy::prepare_data_root(&root).map_err(std::io::Error::other)?; }
            if let Some(window) = app.get_webview_window("main") { window.set_title(channel::NAME)?; }
            let store = store::Store::open(&root).map_err(std::io::Error::other)?;
            diagnostics::initialize(app.handle(), &root, store.preferences().map_err(std::io::Error::other)?.developer_mode);
            text_models::migrate_ollama(&store).map_err(std::io::Error::other)?;
            let state = Arc::new(engine::AppState::new(store).map_err(std::io::Error::other)?);
            app.manage(state.clone());
            telemetry::start(app.handle());
            platform::configure(app.path().resource_dir()?);
            local_text::configure(app.path().resource_dir()?, state.store.root.clone());
            let catalog_app=app.handle().clone();
            let catalog_root=state.store.root.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Ok(status)=model_hub::refresh(&catalog_root,false).await {
                        let _=catalog_app.emit("model-catalog-changed",&status);
                        let _=catalog_app.emit("text-models-changed",());
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(15*60)).await;
                }
            });
            shortcuts::initialize(app.handle());
            let cloud_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = engine::show_cloud(&cloud_app) {
                    let _ = cloud_app.emit("app-error", error);
                }
            });
            let p = state.store.preferences().map_err(std::io::Error::other)?;
            // Rebind the login item after a product or executable path rename.
            // Its enabled state continues to come from the saved preference.
            use tauri_plugin_autostart::ManagerExt;
            let login = if p.launch_at_login { app.autolaunch().enable() } else { app.autolaunch().disable() };
            if let Err(error) = login {
                let _ = app.emit("app-error", error.to_string());
            }
            if let Err(error) = configure_shortcut(app.handle(), &p.shortcut) {
                let _ = app.emit("app-error", error);
            }
            let menu = localization::menu(app.handle(), &p.ui_language)?;
            #[cfg(target_os = "macos")]
            app.set_menu(localization::application_menu(app.handle(), &p.ui_language)?)?;
            let mut tray = tauri::tray::TrayIconBuilder::with_id("main")
                .tooltip(channel::NAME)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        open_main_window(app);
                    }
                    "record" => {
                        let state = app.state::<Arc<engine::AppState>>().inner().clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let action = if state.snapshot().is_ok_and(|s| s.state == "recording") {
                                "finish"
                            } else {
                                "record"
                            };
                            if let Err(error) = engine::action(app.clone(), state, action).await {
                                let _ = app.emit("app-error", error);
                            }
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            #[cfg(target_os = "macos")]
            {
                tray = tray
                    .icon(tauri::include_image!("icons/tray.png"))
                    .icon_as_template(true);
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            let handle = app.handle().clone();
            let state2 = state.clone();
            tauri::async_runtime::spawn(async move {
                #[cfg(not(target_os = "macos"))]
                let mut display_tick = 0;
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(32)).await;
                    if let Some(window) = handle.get_webview_window("cloud") {
                        if !window.is_visible().unwrap_or(false) {
                            continue;
                        }
                        #[cfg(target_os = "macos")]
                        {
                            let regions = state2.hit_regions.lock().ok().map(|r| r.clone());
                            if let Some(regions) = regions {
                                let _ = permissions::update_cloud(&window, regions, state2.notch_mode.load(std::sync::atomic::Ordering::Relaxed));
                            }
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            display_tick = (display_tick + 1) % 3;
                            if display_tick == 0 {
                                let _ = engine::follow_cloud(&window);
                            }
                            if let (Ok(cursor), Ok(position), Ok(scale), Ok(regions)) = (
                                window.cursor_position(),
                                window.outer_position(),
                                window.scale_factor(),
                                state2.hit_regions.lock(),
                            ) {
                                let x = (cursor.x - position.x as f64) / scale;
                                let y = (cursor.y - position.y as f64) / scale;
                                let safe_top = if state2.notch_mode.load(std::sync::atomic::Ordering::Relaxed) { 3. } else { 0. };
                                let inside = y >= safe_top && regions.iter().any(|r| {
                                    x >= r.x
                                        && x <= r.x + r.width
                                        && y >= r.y
                                        && y <= r.y + r.height
                                });
                                let hide_on_hover = state2.hover_hiding_enabled();
                                #[cfg(target_os = "windows")]
                                if unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) } >= 0 {
                                    crate::recorder_position::released(&state2);
                                }
                                let dragging = state2.recorder_dragging.load(std::sync::atomic::Ordering::Relaxed);
                                let _ = window.set_ignore_cursor_events(!dragging && (hide_on_hover || !inside));
                                state2.publish_cloud_hover(&window, hide_on_hover && inside);
                            }
                        }
                    }
                }
            });
            let cleanup = state.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let _ = cleanup.store.cleanup();
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            diagnostics::window_event(window, event);
            if window.label() == "main" {
                if matches!(event, tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)) {
                    let _ = engine::sync_cloud_visibility(window.app_handle());
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let state = window.state::<Arc<engine::AppState>>();
                    if state.store.preferences().is_ok_and(|p| p.keep_in_tray) {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = engine::sync_cloud_visibility(window.app_handle());
                    }
                }
            }
        });
    builder
        .build(tauri::generate_context!())
        .expect("No Type desktop could not start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) { diagnostics::record("info", "app", "ready", serde_json::Value::Null); }
            if matches!(event, tauri::RunEvent::Exit) { diagnostics::record("info", "app", "session.exited", serde_json::Value::Null); }
            if matches!(event, tauri::RunEvent::Exit) { local_text::shutdown(); }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Ready) {
                application_icon::apply();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                // A visible recorder also makes has_visible_windows true.
                // Dock reopening must restore main in either case.
                open_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
