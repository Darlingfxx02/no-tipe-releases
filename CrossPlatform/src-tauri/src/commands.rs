use crate::{
    credentials,
    domain::*,
    engine::{self, AppState, Rect},
    migration, models, platform,
    store::err,
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

type Shared<'a> = State<'a, Arc<AppState>>;
#[tauri::command]
pub fn bootstrap(app: AppHandle, state: Shared<'_>) -> Result<Value, String> {
    if models::ensure_default(&state.store, None)? { state.synchronize_preferences(&app)?; }
    Ok(
        json!({"onboardingComplete":state.store.get_meta::<bool>("onboardingComplete")?.unwrap_or(false),"preferences":state.store.preferences()?,"recent":state.store.transcript_history("",None,10)?,"latestTranscriptText":state.store.latest_transcript_text()?,"stats":state.store.statistics(0.)?,"modes":state.store.list::<Mode>("modes")?,"empowerments":crate::empowerment::catalog(&state.store,&state.store.preferences()?)?,"dictionary":state.store.list::<DictionaryEntry>("dictionary")?,"snippets":state.store.list::<crate::snippets::Snippet>("snippets")?,"models":models::catalog(&state.store)?,"textModels":crate::text_models::catalog(&state.store)?,"modelCatalog":crate::model_hub::status(&state.store.root),"snapshot":state.snapshot()?,"legacyAvailable":!crate::channel::DEVELOPER && migration::available(),"legacyImported":state.store.get_meta::<String>("legacyImported")?,"systemLocale":crate::localization::resolve("system"),"platform":std::env::consts::OS,"version":app.package_info().version.to_string(),"appName":crate::channel::NAME,"releaseChannel":if crate::channel::DEVELOPER {"dev"} else {"stable"}}),
    )
}
#[tauri::command]
pub fn history(
    state: Shared<'_>,
    search: String,
    before: Option<crate::store::TranscriptCursor>,
    limit: u32,
) -> Result<Vec<Transcript>, String> {
    state.store.transcript_history(&search, before.as_ref(), limit)
}
#[tauri::command]
pub fn statistics(state: Shared<'_>, since: f64, until: Option<f64>) -> Result<Statistics, String> {
    state.store.statistics_range(since, until.unwrap_or(f64::INFINITY))
}
static VOICE_GENERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
#[tauri::command]
pub async fn voice_profile(state: Shared<'_>) -> Result<crate::voice_profile::ProfileState, String> {
    let building = VOICE_GENERATION.try_lock().is_err();
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let input = state.store.voice_inputs(chrono::Utc::now().timestamp_millis() as f64 / 1000.)?;
        Ok(crate::voice_profile::state(&input, building))
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn generate_voice_profile(app: AppHandle, state: Shared<'_>) -> Result<crate::voice_profile::ProfileState, String> {
    let _work = state.lifecycle.read().await;
    let _guard = VOICE_GENERATION.try_lock().map_err(|_| crate::localization::message("native.profile.already_building"))?;
    let shared = state.inner().clone();
    let worker = shared.clone();
    let (mut cache, evidence) = tokio::task::spawn_blocking(move || {
        let now = chrono::Utc::now().timestamp_millis() as f64 / 1000.;
        let input = worker.store.voice_inputs(now)?;
        if !crate::voice_profile::state(&input, false).can_generate { return Err(crate::localization::message("native.profile.keep_dictating")); }
        let (mut cache,evidence)=crate::voice_profile::build(&input,now);
        if let Some(previous)=input.cached.as_ref().filter(|_|crate::voice_profile::state(&input,false).remaining_words>0) {
            cache.words_at_creation=previous.words_at_creation;
        }
        Ok((cache,evidence))
    }).await.map_err(err)??;
    let baseline = shared.store.preferences()?;
    let modes = shared.store.list::<Mode>("modes")?;
    let mode = modes.iter().find(|m| m.enabled && Some(&m.id) == baseline.active_mode.as_ref());
    let preferences = processing_preferences(&baseline, mode);
    crate::voice_profile::enrich(&mut cache, &preferences, &evidence).await;
    cache.report.created_at = chrono::Utc::now().timestamp_millis() as f64 / 1000.;
    let worker = shared.clone();
    let result = tokio::task::spawn_blocking(move || {
        worker.store.save_voice_profile(&cache)?;
        let input = worker.store.voice_inputs(chrono::Utc::now().timestamp_millis() as f64 / 1000.)?;
        Ok(crate::voice_profile::state(&input, false))
    }).await.map_err(err)?;
    let _ = app.emit("voice-profile-changed", ());
    result
}
#[tauri::command]
pub fn save_preferences(
    app: AppHandle,
    state: Shared<'_>,
    patch: Value,
) -> Result<Preferences, String> {
    let modes = state.store.list::<Mode>("modes")?;
    let preferences = state.store.update_preferences_with_commit(|previous| {
        let preferences = previous.patched(&patch)?;
        crate::text_models::validate_activation(&state.store.root, previous, &preferences, &modes)?;
        let effects = apply_preference_effects(&app, previous, &preferences)?;
        *previous = preferences;
        Ok(effects)
    }, PreferenceEffects::commit)?;
    state.synchronize_preferences(&app)?;
    if patch.get("usageAnalytics").is_some(){crate::telemetry::refresh(&app);}
    Ok(preferences)
}
struct PreferenceEffects {
    app: AppHandle,
    shortcut: Option<crate::shortcuts::ShortcutChange>,
    previous_launch_at_login: Option<bool>,
    committed: bool,
}
impl PreferenceEffects {
    fn commit(mut self) {
        self.committed = true;
        if let Some(shortcut) = self.shortcut.take() { shortcut.commit(); }
    }
}
impl Drop for PreferenceEffects {
    fn drop(&mut self) {
        use tauri_plugin_autostart::ManagerExt;
        if !self.committed {
            if let Some(previous) = self.previous_launch_at_login {
                let result = if previous { self.app.autolaunch().enable() } else { self.app.autolaunch().disable() };
                if let Err(error) = result { let _ = self.app.emit("app-error", err(error)); }
            }
        }
        // An uncommitted ShortcutChange restores registration without trying
        // to register a conflicting or system-reserved predecessor again.
    }
}
fn apply_preference_effects(app: &AppHandle, previous: &Preferences, next: &Preferences) -> Result<PreferenceEffects, String> {
    use tauri_plugin_autostart::ManagerExt;
    let mut effects = PreferenceEffects { app: app.clone(), shortcut: None, previous_launch_at_login: None, committed: false };
    if previous.shortcut != next.shortcut {
        effects.shortcut = Some(crate::shortcuts::prepare_from(app, &next.shortcut, &previous.shortcut)?);
    }
    if previous.launch_at_login != next.launch_at_login {
        let result = if next.launch_at_login { app.autolaunch().enable() } else { app.autolaunch().disable() };
        result.map_err(err)?;
        effects.previous_launch_at_login = Some(previous.launch_at_login);
    }
    Ok(effects)
}
#[tauri::command]
pub fn save_empowerment(app: AppHandle, state: Shared<'_>, empowerment: crate::empowerment::Definition) -> Result<(), String> {
    let item = empowerment.normalized()?;
    state.store.put("empowerments", &item.id, &item)?;
    if state.snapshot()?.empowerment.as_deref() == Some(&item.id) { state.update_empowerment(Some(&item.id))?; }
    state.emit(&app);
    app.emit("data-changed", ()).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn delete_empowerment(app: AppHandle, state: Shared<'_>, id: String) -> Result<(), String> {
    if id == "brief" { return Err(crate::localization::message("Empowerments.builtin_delete")); }
    state.remove_empowerment(&id)?;
    state.store.delete("empowerments", &id)?;
    state.emit(&app);
    app.emit("data-changed", ()).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub fn save_mode(app: AppHandle, state: Shared<'_>, mode: Mode) -> Result<(), String> {
    if mode.name.trim().is_empty() {
        return Err("Enter a mode name".into());
    }
    if mode.processing_provider.as_deref() != Some(crate::text_models::PROVIDER) {
        if let Some(endpoint) = &mode.processing_endpoint { validate_endpoint(endpoint)?; }
    }
    let previous = state.store.list::<Mode>("modes")?.into_iter().find(|m|m.id==mode.id);
    state.store.put("modes", &mode.id, &mode)?;
    let mut p = state.store.preferences()?;
    if p.active_mode.as_deref() == Some(mode.id.as_str()) {
        // Editing instructions must not reset temporary changes from the cloud.
        if let Some(old) = previous {
            if old.enhance != mode.enhance { p.enhance = mode.enhance; }
            if old.shorten != mode.shorten { p.shorten = mode.shorten; }
            if old.translation != mode.translation { p.translation = mode.translation.clone(); }
        }
        if !mode.enabled { p.active_mode = None; }
        state.store.set_preferences(&p)?;
        state.synchronize_preferences(&app)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn preview_mode(state: Shared<'_>, mode: Mode, text: String) -> Result<String, String> {
    if text.trim().is_empty() { return Err(crate::localization::message("native.sample_required")); }
    if text.len() > 50_000 { return Err("Use a shorter sample (up to 50,000 bytes)".into()); }
    let mut p = state.store.preferences()?;
    p.enhance = mode.enhance;
    p.shorten = mode.shorten;
    p.translation = mode.translation.clone();
    let Some(prompt) = processing_prompt(&p, Some(&mode)) else { return Ok(text); };
    // Only the explicitly entered sample is sent. No clipboard/history/recording.
    crate::providers::process(&processing_preferences(&p, Some(&mode)), &prompt, &text).await
}
#[tauri::command]
pub async fn processing_models(state: Shared<'_>, endpoint: String, provider: Option<String>) -> Result<Vec<String>, String> {
    if provider.as_deref() == Some(crate::text_models::PROVIDER) {
        return Ok(crate::text_models::catalog(&state.store)?.into_iter().filter(|m|m.installed).map(|m|m.id).collect());
    }
    crate::providers::processing_models(&endpoint).await
}
#[tauri::command]
pub fn text_models(state:Shared<'_>)->Result<Vec<Model>,String> { crate::text_models::catalog(&state.store) }
#[tauri::command]
pub async fn search_model_hub(state:Shared<'_>,search:crate::model_hub::Search)->Result<crate::model_hub::SearchResult,String> {
    crate::model_hub::search(&state.store.root,search).await
}
#[tauri::command]
pub async fn add_hub_model(app:AppHandle,state:Shared<'_>,kind:crate::model_hub::Kind,repository:String,revision:String,file:String)->Result<Model,String> {
    let _work=state.lifecycle.read().await;
    let model=crate::model_hub::add(&state.store.root,kind,&repository,&revision,&file).await?;
    let _=app.emit("model-catalog-changed",crate::model_hub::status(&state.store.root));
    Ok(model)
}
#[tauri::command]
pub async fn refresh_model_catalog(app:AppHandle,state:Shared<'_>,force:Option<bool>)->Result<crate::model_hub::Status,String> {
    let status=crate::model_hub::refresh(&state.store.root,force.unwrap_or(false)).await?;
    let _=app.emit("model-catalog-changed",&status);
    let _=app.emit("text-models-changed",());
    Ok(status)
}
#[tauri::command]
pub async fn download_text_model(app:AppHandle,state:Shared<'_>,id:String)->Result<(),String> {
    let _work=state.lifecycle.read().await;
    crate::text_models::download(&app,&state.store,&id).await
}
#[tauri::command]
pub async fn add_text_model(app:AppHandle,state:Shared<'_>,name:String,path:Option<PathBuf>,url:Option<String>)->Result<String,String> {
    let _work=state.lifecycle.read().await;
    crate::text_models::add(&app,&state.store,name,path,url).await
}
#[tauri::command]
pub async fn remove_text_model(app:AppHandle,state:Shared<'_>,id:String)->Result<(),String> {
    let _recording=state.operation.try_lock().map_err(|_|crate::localization::message("native.finish_before_remove"))?;
    let _work=state.lifecycle.try_write().map_err(|_|crate::localization::message("native.finish_work_before_remove"))?;
    if state.snapshot()?.state!="idle" {return Err(crate::localization::message("native.stop_before_remove"));}
    crate::text_models::remove(&app,&state.store,&id).await
}
#[tauri::command]
pub fn save_dictionary(state: Shared<'_>, entry: DictionaryEntry) -> Result<(), String> {
    crate::dictionary::validate(&entry)?;
    state.store.put("dictionary", &entry.id, &entry)
}
#[tauri::command]
pub fn save_snippet(app: AppHandle, state: Shared<'_>, snippet: crate::snippets::Snippet) -> Result<(), String> {
    state.store.save_snippet(snippet)?;
    let _ = app.emit("data-changed", ());
    Ok(())
}
#[tauri::command]
pub fn preview_snippet_import(state: Shared<'_>, path: PathBuf) -> Result<Value, String> {
    if std::fs::metadata(&path).map_err(err)?.len() > 3 * 1024 * 1024 { return Err("The JSON file must be smaller than 3 MB.".into()); }
    let bytes = std::fs::read(path).map_err(err)?;
    if bytes.len() > 3 * 1024 * 1024 { return Err("The JSON file must be smaller than 3 MB.".into()); }
    let preview = crate::snippets::preview_import(&bytes, &state.store.list("snippets")?, &state.store.list("dictionary")?)?;
    serde_json::to_value(preview).map_err(err)
}
#[tauri::command]
pub fn import_snippets(app: AppHandle, state: Shared<'_>, snippets: Vec<crate::snippets::Snippet>) -> Result<usize, String> {
    let count = state.store.import_snippets(snippets)?;
    let _ = app.emit("data-changed", ());
    Ok(count)
}
#[tauri::command]
pub fn export_snippets(state: Shared<'_>, path: PathBuf) -> Result<(), String> {
    let items = state.store.list::<crate::snippets::Snippet>("snippets")?.into_iter().map(|s| json!({"name":s.trigger,"text":s.expansion})).collect::<Vec<_>>();
    std::fs::write(path, serde_json::to_vec_pretty(&items).map_err(err)?).map_err(err)
}
#[tauri::command]
pub async fn copy_snippet(state: Shared<'_>, id: String) -> Result<(), String> {
    let snippet = state.store.list::<crate::snippets::Snippet>("snippets")?.into_iter().find(|s| s.id == id).ok_or("Snippet not found")?;
    platform::copy_formatted(&snippet.expansion, crate::snippets::html(&snippet).as_deref()).await
}
#[tauri::command]
pub fn save_model(state: Shared<'_>, model: Model) -> Result<(), String> {
    crate::store::validate_endpoint_or_local(&model)?;
    state.store.put("models", &model.id, &model)
}
#[tauri::command]
pub fn delete_item(app: AppHandle, state: Shared<'_>, collection: String, id: String) -> Result<(), String> {
    if collection == "empowerments" { return delete_empowerment(app, state, id); }
    state.store.delete(&collection, &id)?;
    if collection == "modes" {
        let mut p = state.store.preferences()?;
        if p.active_mode.as_deref() == Some(id.as_str()) {
            p.active_mode = None;
            state.store.set_preferences(&p)?;
            state.synchronize_preferences(&app)?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn save_secret(provider: String, key: String) -> Result<(), String> {
    credentials::save(&provider, &key)
}
#[tauri::command]
pub async fn connect_api_provider(app:AppHandle,provider:String,key:String)->Result<(),String> {
    crate::api_connections::connect(&provider,&key).await?;
    let _=app.emit("data-changed",());
    Ok(())
}
#[tauri::command]
pub fn model_download_status(state:Shared<'_>)->Result<Vec<crate::model_download::Status>,String> {
    crate::model_download::statuses(&state.store)
}
#[tauri::command]
pub fn cancel_model_download(id:String)->Result<(),String> {crate::model_download::cancel(&id)}
#[tauri::command]
pub async fn download_model(app: AppHandle, state: Shared<'_>, id: String) -> Result<(), String> {
    let _work = state.lifecycle.read().await;
    models::download(app.clone(), &state.store, &id).await?;
    state.synchronize_preferences(&app)
}
#[tauri::command]
pub fn select_speech_model(app: AppHandle, state: Shared<'_>, id: String) -> Result<Preferences, String> {
    let p = models::select(&state.store, &id)?;
    state.synchronize_preferences(&app)?;
    let _ = app.emit("data-changed", ());
    Ok(p)
}
#[tauri::command]
pub async fn remove_model(app:AppHandle,state:Shared<'_>,id:String)->Result<(),String> {
    let _recording=state.operation.try_lock().map_err(|_|crate::localization::message("native.finish_before_remove"))?;
    let _work=state.lifecycle.try_write().map_err(|_|crate::localization::message("native.finish_work_before_remove"))?;
    if state.snapshot()?.state!="idle" {return Err(crate::localization::message("native.stop_before_remove"));}
    models::remove(&app,&state.store,&id).await
}
#[tauri::command]
pub fn audio_devices() -> Result<Vec<crate::audio::Device>, String> {
    crate::audio::devices()
}
#[tauri::command]
pub fn cloud_snapshot(state: Shared<'_>) -> Result<Snapshot, String> {
    state.snapshot()
}
#[tauri::command]
pub fn cloud_dock_geometry(state: Shared<'_>) -> Result<crate::dock::Geometry, String> {
    Ok(state.dock_geometry.lock().map_err(err)?.unwrap_or_default())
}
#[tauri::command]
pub async fn show_cloud(app: AppHandle) -> Result<(), String> {
    engine::show_cloud(&app)
}
#[tauri::command]
pub fn set_dashboard_active(app: AppHandle, state: Shared<'_>, active: bool) -> Result<(), String> {
    state.dashboard_active.store(active, std::sync::atomic::Ordering::Relaxed);
    engine::sync_cloud_visibility(&app)
}
#[tauri::command]
pub async fn recorder_action(
    app: AppHandle,
    state: Shared<'_>,
    action: String,
) -> Result<(), String> {
    engine::action(app, state.inner().clone(), &action).await
}
#[tauri::command]
pub async fn cloud_action(
    app: AppHandle,
    state: Shared<'_>,
    action: String,
    detail: Value,
) -> Result<(), String> {
    match action.as_str() {
        "drag" => {
            let window = app.get_webview_window("cloud").ok_or("Recorder is unavailable")?;
            crate::recorder_position::drag(window,
                detail["x"].as_f64().ok_or("Missing drag origin")?,
                detail["y"].as_f64().ok_or("Missing drag origin")?,
                detail["end"].as_bool().unwrap_or(false)).await
        }
        "reset-position" => {
            let window = app.get_webview_window("cloud").ok_or("Recorder is unavailable")?;
            crate::recorder_position::reset(&window)
        }
        "renderer-status" => {
            // Renderer-only diagnostics: no transcript, audio or credentials.
            let safe = json!({"error":detail["error"],"palette":detail["palette"],"chromatic":detail["chromatic"],"hidden":detail["hidden"],"width":detail["width"],"height":detail["height"],"stage":detail["stage"],"time":detail["time"],"nativeActive":detail["nativeActive"],"paused":detail["paused"],"rect":detail["rect"],"shell":detail["shell"],"canvas":detail["canvas"],"glError":detail["glError"],"rendererError":detail["rendererError"],"fallback":detail["fallback"]});
            state.store.set_meta("cloudRenderer", &safe)?;
            if let Some(error) = safe["error"].as_str() {
                if !error.is_empty() {
                    let _ = app.emit("app-error", format!("Recorder: {error}"));
                }
            }
            Ok(())
        }
        "ready" => {
            state.emit(&app);
            if let Some(window) = app.get_webview_window("cloud") {
                // A retained/reloaded webview can subscribe after visibility
                // changed. Publish presentation separately from session state.
                let _ = window.emit("cloud-active", window.is_visible().unwrap_or(false));
                let _ = window.emit("cloud-hover-hidden", state.cloud_hover_hidden.load(std::sync::atomic::Ordering::Relaxed));
                let _ = window.emit("cloud-dock", state.dock_geometry.lock().map_err(err)?.unwrap_or_default());
            }
            Ok(())
        }
        "regions" => {
            let regions: Vec<Rect> =
                serde_json::from_value(detail["regions"].clone()).map_err(err)?;
            if regions.len() <= 8
                && regions.iter().all(|r| {
                    [r.x, r.y, r.width, r.height].iter().all(|n| n.is_finite())
                        && r.width >= 0.
                        && r.height >= 0.
                        && r.width <= 600.
                        && r.height <= 400.
                })
            {
                *state.hit_regions.lock().map_err(err)? = regions;
            }
            Ok(())
        }
        "history" => {
            // Recorder actions never open or activate the main application.
            // The tray can reveal the dashboard's transcript list when explicitly opened.
            app.emit("navigate", "History").map_err(err)?;
            Ok(())
        }
        "empowerment" => {
            state.update_empowerment(detail["value"].as_str().filter(|value| !value.is_empty()))?;
            state.emit(&app);
            Ok(())
        }
        "processing" | "translation" => {
            use crate::session::ProcessingChange;
            let value = detail["value"].as_str().unwrap_or("");
            let change = if action == "translation" { ProcessingChange::Translation(value.into()) }
            else {
                let enabled = detail["enabled"].as_bool().ok_or("Missing processing state")?;
                match value {
                    "enhance" => ProcessingChange::Enhance(enabled),
                    "shorten" => ProcessingChange::Shorten(enabled),
                    _ => return Err("Unknown processing option".into()),
                }
            };
            if let Err(error) = state.update_processing(change) {
                // The recorder updates its controls optimistically and ignores
                // invoke rejections. Restore the saved selection and surface why.
                state.emit(&app);
                let _ = app.emit("app-error", &error);
                return Err(error);
            }
            state.emit(&app);
            let _ = app.emit("data-changed", ());
            Ok(())
        }
        _ => engine::action(app, state.inner().clone(), &action).await,
    }
}
#[tauri::command]
pub async fn transcribe_file(
    app: AppHandle,
    state: Shared<'_>,
    path: PathBuf,
    options: Option<crate::file_jobs::FileOptions>,
) -> Result<Transcript, String> {
    engine::file(app, state.inner().clone(), path, options).await
}
#[tauri::command]
pub fn cancel_file_transcription(request_id:String) -> Result<(),String> {
    crate::file_jobs::cancel(&request_id)
}
#[tauri::command]
pub fn transcript(state: Shared<'_>, id: String) -> Result<Transcript, String> {
    state.store.transcript(&id)
}
#[tauri::command]
pub fn transcript_processing_options(state: Shared<'_>, id: String) -> Result<Value, String> {
    let t = state.store.transcript(&id)?;
    Ok(json!({
        "saved": crate::reprocessing::saved_configuration(&t).ok().flatten(),
        "current": crate::reprocessing::current_configuration(&state.store)?,
    }))
}
#[tauri::command]
pub async fn retry_recognition(app: AppHandle, state: Shared<'_>, id: String) -> Result<Option<Transcript>, String> {
    engine::retry_recognition(app, state.inner().clone(), &id).await
}
#[tauri::command]
pub async fn retry_transcript(
    app: AppHandle, state: Shared<'_>, id: String, source: Option<String>,
    configuration: Option<crate::session::ProcessingConfiguration>,
) -> Result<Transcript, String> {
    let _work = state.lifecycle.read().await;
    let t = state.store.transcript(&id)?;
    let config = match source.as_deref().unwrap_or("saved") {
        "saved" => crate::reprocessing::saved_configuration(&t)?.ok_or("This entry has no saved processing rules. Open Review and choose current settings.")?,
        "current" => configuration.ok_or("Review current settings before enhancing this entry")?,
        _ => return Err("Unknown processing settings choice".into()),
    };
    crate::reprocessing::retry(&state.store, &id, config, || { let _ = app.emit("data-changed", ()); }).await
}
#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    platform::copy(&text)
}
#[tauri::command]
pub fn copy_system_info(app: AppHandle) -> Result<(), String> {
    platform::copy(&format!(
        "No Type {}\nOS: {}\nArchitecture: {}\nUI: Tauri / React\nAudio: native CPAL\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    ))
}
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(err)?;
    if parsed.scheme() != "https" {
        return Err("Only HTTPS links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}
#[tauri::command]
pub fn permission_status() -> crate::permissions::Permissions {
    crate::permissions::status()
}
#[tauri::command]
pub fn request_permissions(app: AppHandle, kind: String) -> Result<(), String> {
    crate::permissions::request(&app, &kind)
}
#[tauri::command]
pub fn complete_onboarding(state: Shared<'_>) -> Result<(), String> {
    state.store.set_meta("onboardingComplete", &true)
}
#[tauri::command]
pub fn cloud_diagnostics(app: AppHandle, state: Shared<'_>) -> Result<Value, String> {
    let window = app.get_webview_window("cloud");
    Ok(
        json!({"exists":window.is_some(),"visible":window.as_ref().and_then(|w|w.is_visible().ok()),"position":window.as_ref().and_then(|w|w.outer_position().ok()),"size":window.as_ref().and_then(|w|w.inner_size().ok()),"scale":window.as_ref().and_then(|w|w.scale_factor().ok()),"renderer":state.store.get_meta::<Value>("cloudRenderer")?,"dockGeometry":*state.dock_geometry.lock().map_err(err)?,"monitors":app.available_monitors().map_err(err)?.iter().map(|m|json!({"size":m.size(),"position":m.position(),"scale":m.scale_factor()})).collect::<Vec<_>>()}),
    )
}
#[tauri::command]
pub async fn import_legacy(app: AppHandle, state: Shared<'_>) -> Result<usize, String> {
    let state = state.inner().clone();
    let count =
        tauri::async_runtime::spawn_blocking(move || migration::import_legacy(&state.store))
            .await
            .map_err(err)??;
    let _ = app.emit("data-changed", ());
    Ok(count)
}
#[tauri::command]
pub fn export_backup(state: Shared<'_>, path: PathBuf) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(&state.store.backup()?).map_err(err)?;
    atomic_export(&path, &data)
}
#[tauri::command]
pub fn import_backup(app: AppHandle, state: Shared<'_>, path: PathBuf) -> Result<usize, String> {
    let bytes = std::fs::read(path).map_err(err)?;
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("Backup is too large".into());
    }
    let mut backup: Backup = serde_json::from_slice(&bytes).map_err(err)?;
    backup.preferences.shortcut = crate::shortcuts::portable_shortcut(&backup.preferences.shortcut, std::env::consts::OS);
    let count = state.store.import_backup_with_commit(backup, |previous, preferences| {
        apply_preference_effects(&app, previous, preferences)
    }, PreferenceEffects::commit)?;
    state.synchronize_preferences(&app)?;
    Ok(count)
}
#[tauri::command]
pub fn export_transcripts(state: Shared<'_>, path: PathBuf) -> Result<(), String> {
    let content = state
        .store
        .backup()?
        .transcripts
        .iter()
        .map(|t| {
            format!(
                "{}\n{}\n",
                chrono::DateTime::from_timestamp(t.timestamp as i64, 0)
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
                t.delivered_text()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    atomic_export(&path, content.as_bytes())
}
pub(crate) fn atomic_export(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp, data).map_err(err)?;
    let result = std::fs::rename(&temp, path).map_err(err);
    if result.is_err() { let _ = std::fs::remove_file(temp); }
    result
}
#[tauri::command]
pub fn window_action(app: AppHandle, action: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window unavailable")?;
    match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" => {
            if window.is_maximized().map_err(err)? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        _ => return Err("Unknown window action".into()),
    }
    .map_err(err)
}
