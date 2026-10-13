//! Opt-in daily counters. Only allowlisted model identifiers, categories and counters leave the device.
use crate::{domain::{Preferences, Transcript}, engine::AppState, store::{Store,err}};
use rusqlite::{params,Connection,OptionalExtension};
use serde::{Deserialize,Serialize};
use std::sync::Arc;
use tauri::Manager;

const ENDPOINT:&str="https://notype.tech/api/app";
const VERSION:&str=crate::channel::VERSION;
pub const CONSENT_VERSION:u32=2;
pub fn enabled(p:&Preferences)->bool{!crate::channel::DEVELOPER&&p.usage_analytics==Some(true)&&p.usage_analytics_version>=CONSENT_VERSION}
static NETWORK:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());

#[derive(Clone,Serialize,Deserialize)]
struct Identity { id:String, token:String, #[serde(default)] registered:bool }
#[derive(Debug,Serialize)]
struct Daily { day:String,version:String,platform:String,success:u32,failed:u32,seconds:f64,launches:u32 }

pub fn create_tables(db:&Connection)->Result<(),String>{
    crate::telemetry_details::create_tables(db)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS telemetry_daily(day TEXT NOT NULL,version TEXT NOT NULL,success INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,seconds REAL NOT NULL DEFAULT 0,launches INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,version));
      CREATE TABLE IF NOT EXISTS telemetry_outcomes(id TEXT PRIMARY KEY,day TEXT NOT NULL,success INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0);").map_err(err)
}
fn opted_in(db:&Connection)->bool{
    if crate::channel::DEVELOPER{return false;}
    db.query_row("SELECT (json_extract(value,'$.usageAnalytics')=1 AND COALESCE(json_extract(value,'$.usageAnalyticsVersion'),0)>=2) FROM metadata WHERE key='preferences'",[],|r|r.get::<_,Option<bool>>(0)).ok().flatten()==Some(true)
}
pub fn record(db:&Connection,t:&Transcript)->Result<(),String>{
    if !opted_in(db)||t.is_no_speech()||t.insights.as_ref().and_then(|s|s.source.as_deref())==Some("file"){return Ok(());}
    let since:Option<f64>=db.query_row("SELECT CAST(value AS REAL) FROM metadata WHERE key='telemetry.since'",[],|r|r.get(0)).optional().map_err(err)?;
    if since.is_some_and(|since|t.timestamp<since){return Ok(());}
    crate::telemetry_details::record(db,t)?;
    let success=t.status=="completed"&&!t.text.trim().is_empty();
    let failed=t.status=="failed";
    if !success&&!failed{return Ok(());}
    let previous:Option<(bool,bool)>=db.query_row("SELECT success,failed FROM telemetry_outcomes WHERE id=?",[&t.id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    let add_success=success&&!previous.is_some_and(|p|p.0);
    let add_failed=failed&&!previous.is_some_and(|p|p.1);
    if !add_success&&!add_failed{return Ok(());}
    let day=chrono::Utc::now().format("%Y-%m-%d").to_string();
    db.execute("INSERT INTO telemetry_outcomes(id,day,success,failed) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET success=MAX(success,excluded.success),failed=MAX(failed,excluded.failed)",params![t.id,day,success,failed]).map_err(err)?;
    let seconds=if add_success&&t.duration.is_finite(){t.duration.clamp(0.,86400.)}else{0.};
    db.execute("INSERT INTO telemetry_daily(day,version,success,failed,seconds) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(day,version) DO UPDATE SET success=success+excluded.success,failed=failed+excluded.failed,seconds=MIN(86400,seconds+excluded.seconds)",params![day,VERSION,add_success,add_failed,seconds]).map_err(err)?;
    Ok(())
}
pub fn record_setup_error(store:&Store,error:&str)->Result<(),String>{
    let db=store.db.lock().map_err(err)?;
    if !opted_in(&db){return Ok(());}
    crate::telemetry_details::setup_error(&db,error)
}
pub fn consent_changed(db:&Connection,previous:&Preferences,next:&Preferences)->Result<(),String>{
    if previous.usage_analytics==next.usage_analytics&&previous.usage_analytics_version==next.usage_analytics_version{return Ok(());}
    // Pending deletion survives offline withdrawal and is never included in backups.
    if next.usage_analytics!=Some(true){
        db.execute("INSERT OR REPLACE INTO metadata(key,value) SELECT 'telemetry.forget',value FROM metadata WHERE key='telemetry.identity'",[]).map_err(err)?;
        db.execute("DELETE FROM metadata WHERE key='telemetry.identity'",[]).map_err(err)?;
    }
    if previous.usage_analytics!=next.usage_analytics {
        db.execute("DELETE FROM telemetry_daily",[]).map_err(err)?;
        db.execute("DELETE FROM telemetry_outcomes",[]).map_err(err)?;
    }
    db.execute("DELETE FROM telemetry_dimensions",[]).map_err(err)?;
    db.execute("DELETE FROM telemetry_seen",[]).map_err(err)?;
    if enabled(next){db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('telemetry.since',?1)",[chrono::Utc::now().timestamp_millis() as f64/1000.]).map_err(err)?;}
    Ok(())
}
fn launch(store:&Store)->Result<(),String>{
    let db=store.db.lock().map_err(err)?;
    if !opted_in(&db){return Ok(());}
    let day=chrono::Utc::now().format("%Y-%m-%d").to_string();
    db.execute("INSERT INTO telemetry_daily(day,version,launches) VALUES(?1,?2,1) ON CONFLICT(day,version) DO UPDATE SET launches=launches+1",params![day,VERSION]).map_err(err)?;
    Ok(())
}
async fn synchronize(store:&Store)->Result<(),String>{
    // Dev must never register or upload, even with consent or a legacy queue.
    if crate::channel::DEVELOPER{return Ok(());}
    let _guard=NETWORK.lock().await;
    let mut headers=reqwest::header::HeaderMap::new();
    headers.insert("x-no-type-channel",reqwest::header::HeaderValue::from_static("stable"));
    let client=reqwest::Client::builder().default_headers(headers).timeout(std::time::Duration::from_secs(8)).build().map_err(err)?;
    if let Some(identity)=store.get_meta::<Identity>("telemetry.forget")?{
        let response=client.delete(format!("{ENDPOINT}/forget")).header("X-Installation-ID",&identity.id).bearer_auth(&identity.token).send().await.map_err(|_|"Statistics unavailable")?;
        if response.status().is_success()||response.status()==reqwest::StatusCode::UNAUTHORIZED{
            store.db.lock().map_err(err)?.execute("DELETE FROM metadata WHERE key='telemetry.forget'",[]).map_err(err)?;
        }else{return Err("Statistics unavailable".into());}
    }
    if !enabled(&store.preferences()?){return Ok(());}
    let mut identity=match store.get_meta::<Identity>("telemetry.identity")?{
        Some(value)=>value,
        None=>{
            let value=Identity{id:uuid::Uuid::new_v4().to_string(),token:format!("{}{}",uuid::Uuid::new_v4(),uuid::Uuid::new_v4()),registered:false};
            let db=store.db.lock().map_err(err)?;
            if !opted_in(&db){return Ok(());}
            db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('telemetry.identity',?1)",[serde_json::to_string(&value).map_err(err)?]).map_err(err)?;value
        }
    };
    // Registration is idempotent. Server keeps the first-seen date on retries and updates.
    if !identity.registered {
        if !enabled(&store.preferences()?){return Ok(());}
        let response=client.post(format!("{ENDPOINT}/register")).json(&serde_json::json!({"id":identity.id,"token":identity.token,"platform":std::env::consts::OS,"version":VERSION})).send().await.map_err(|_|"Statistics unavailable")?;
        if !response.status().is_success(){return Err("Statistics unavailable".into());}
        identity.registered=true;
        let db=store.db.lock().map_err(err)?;
        if !opted_in(&db){return Ok(());}
        db.execute("UPDATE metadata SET value=?1 WHERE key='telemetry.identity'",[serde_json::to_string(&identity).map_err(err)?]).map_err(err)?;
    }
    let rows={
        let db=store.db.lock().map_err(err)?;
        if !opted_in(&db){return Ok(());}
        let before=(chrono::Utc::now()-chrono::Duration::days(30)).format("%Y-%m-%d").to_string();
        db.execute("DELETE FROM telemetry_daily WHERE day < ?1",[&before]).map_err(err)?;
        db.execute("DELETE FROM telemetry_outcomes WHERE day < ?1",[&before]).map_err(err)?;
        let mut q=db.prepare("SELECT day,version,success,failed,seconds,launches FROM telemetry_daily ORDER BY day DESC,version DESC LIMIT 31").map_err(err)?;
        let rows=q.query_map([],|r|Ok(Daily{day:r.get(0)?,version:r.get(1)?,platform:std::env::consts::OS.into(),success:r.get(2)?,failed:r.get(3)?,seconds:r.get(4)?,launches:r.get(5)?})).map_err(err)?;
        rows.collect::<Result<Vec<_>,_>>().map_err(err)?
    };
    if !enabled(&store.preferences()?){return Ok(());}
    let response=client.post(format!("{ENDPOINT}/summary")).header("X-Installation-ID",&identity.id).bearer_auth(&identity.token).json(&rows).send().await.map_err(|_|"Statistics unavailable")?;
    if !response.status().is_success(){return Err("Statistics unavailable".into());}
    let details=crate::telemetry_details::payload(store)?;
    // Bounded batches also send an empty-counter profile on a quiet installation.
    for offset in (0..details.counters.len().max(1)).step_by(400){
        if !enabled(&store.preferences()?){return Ok(());}
        let end=(offset+400).min(details.counters.len());
        let payload=serde_json::json!({"profile":details.profile,"counters":&details.counters[offset..end]});
        let response=client.post(format!("{ENDPOINT}/details")).header("X-Installation-ID",&identity.id).bearer_auth(&identity.token).json(&payload).send().await.map_err(|_|"Statistics unavailable")?;
        if !response.status().is_success(){return Err("Statistics unavailable".into());}
    }
    Ok(())
}
pub fn start(app:&tauri::AppHandle){
    if crate::channel::DEVELOPER{return;}
    let state=app.state::<Arc<AppState>>().inner().clone();
    tauri::async_runtime::spawn(async move{
        let mut counted=false;
        loop{
            if !counted&&state.store.preferences().is_ok_and(|p|enabled(&p)){
                counted=launch(&state.store).is_ok();
            }
            let _=synchronize(&state.store).await;
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });
}
pub fn refresh(app:&tauri::AppHandle){
    if crate::channel::DEVELOPER{return;}
    let state=app.state::<Arc<AppState>>().inner().clone();
    tauri::async_runtime::spawn(async move{let _=synchronize(&state.store).await;});
}

#[cfg(test)] mod tests{
    use super::*;
    #[test]fn expanded_consent_is_not_inherited_from_legacy_settings_or_backups(){
        let root=std::env::temp_dir().join(format!("no-type-consent-{}",uuid::Uuid::new_v4()));
        let store=Store::open(&root).unwrap();
        store.update_preferences(|p|{p.usage_analytics=Some(true);p.usage_analytics_version=1;Ok(())}).unwrap();
        assert!(!enabled(&store.preferences().unwrap()));
        record_setup_error(&store,"microphone permission").unwrap();
        assert_eq!(store.db.lock().unwrap().query_row("SELECT COUNT(*) FROM telemetry_dimensions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        let mut backup=store.backup().unwrap();backup.preferences.usage_analytics_version=CONSENT_VERSION;
        store.import_backup(backup).unwrap();
        assert!(!enabled(&store.preferences().unwrap()));
        let next=store.preferences().unwrap().patched(&serde_json::json!({"usageAnalytics":true})).unwrap();
        assert_eq!(enabled(&next),!crate::channel::DEVELOPER);
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(not(feature="dev-channel"))]
    #[test]fn detailed_counters_track_later_stages_without_sending_content(){
        let root=std::env::temp_dir().join(format!("no-type-details-{}",uuid::Uuid::new_v4()));
        let store=Store::open(&root).unwrap();
        store.update_preferences(|p|{p.usage_analytics=Some(true);p.usage_analytics_version=CONSENT_VERSION;Ok(())}).unwrap();
        let mut t:Transcript=serde_json::from_value(serde_json::json!({"id":"detail-test","text":"","status":"failed","duration":12.,"timestamp":chrono::Utc::now().timestamp_millis() as f64/1000.+1.,"recognitionError":"request timed out PRIVATE-URL"})).unwrap();
        store.save_transcript(&t).unwrap();store.save_transcript(&t).unwrap();
        t.status="completed".into();t.text="PRIVATE-DICTATION".into();t.model=Some("PRIVATE-MODEL".into());t.recognition_error=None;
        t.processing_state=crate::domain::ProcessingState::Failed;t.processing_error=Some("request timed out PRIVATE-KEY".into());
        store.save_transcript(&t).unwrap();store.save_transcript(&t).unwrap();
        t.processing_state=crate::domain::ProcessingState::Completed;t.processing_error=None;t.enhanced_text=Some("PRIVATE-RESULT".into());
        t.processing_config=Some(serde_json::from_value(serde_json::json!({"provider":"local","model":"qwen3.5-4b","endpoint":"PRIVATE-ENDPOINT","timeout":90,"enhance":true,"shorten":false,"translation":"off","instructions":"PRIVATE-INSTRUCTION"})).unwrap());
        store.save_transcript(&t).unwrap();store.save_transcript(&t).unwrap();
        store.db.lock().unwrap().execute("INSERT INTO dictionary(id,data) VALUES('entry','PRIVATE-WORD')",[]).unwrap();
        let payload=serde_json::to_value(crate::telemetry_details::payload(&store).unwrap()).unwrap();
        assert_eq!(payload["profile"]["dictionary"],1);
        let counters=payload["counters"].as_array().unwrap();
        for kind in ["speech","processing","error_recognition","error_processing"]{
            let row=counters.iter().find(|r|r["kind"]==kind).unwrap();assert_eq!(row["count"],1);
        }
        assert_eq!(counters.iter().find(|r|r["kind"]=="processing").unwrap()["key"],"qwen3.5-4b");
        assert!(!payload.to_string().contains("PRIVATE"));
        store.db.lock().unwrap().execute("DELETE FROM dictionary",[]).unwrap();
        assert_eq!(serde_json::to_value(crate::telemetry_details::payload(&store).unwrap()).unwrap()["profile"]["dictionary"],0);
        store.update_preferences(|p|{p.usage_analytics=Some(false);Ok(())}).unwrap();
        assert!(crate::telemetry_details::payload(&store).is_err());
        assert_eq!(store.db.lock().unwrap().query_row("SELECT COUNT(*) FROM telemetry_dimensions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(not(feature="dev-channel"))]
    #[test]fn consent_and_outcomes_are_idempotent(){
        let root=std::env::temp_dir().join(format!("no-type-telemetry-{}",uuid::Uuid::new_v4()));
        let store=Store::open(&root).unwrap();
        let t:Transcript=serde_json::from_value(serde_json::json!({"id":"test","text":"private words","status":"completed","duration":12.,"timestamp":chrono::Utc::now().timestamp_millis() as f64/1000.+1.})).unwrap();
        {let db=store.db.lock().unwrap();record(&db,&t).unwrap();assert_eq!(db.query_row("SELECT COUNT(*) FROM telemetry_daily",[],|r|r.get::<_,i64>(0)).unwrap(),0);}
        store.update_preferences(|p|{p.usage_analytics=Some(true);p.usage_analytics_version=2;Ok(())}).unwrap();
        {let db=store.db.lock().unwrap();record(&db,&t).unwrap();record(&db,&t).unwrap();assert_eq!(db.query_row("SELECT success FROM telemetry_daily",[],|r|r.get::<_,i64>(0)).unwrap(),1);}
        store.update_preferences(|p|{p.usage_analytics=Some(false);Ok(())}).unwrap();
        {let db=store.db.lock().unwrap();assert_eq!(db.query_row("SELECT COUNT(*) FROM telemetry_daily",[],|r|r.get::<_,i64>(0)).unwrap(),0);}
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(feature="dev-channel")]
    #[tokio::test]async fn developer_builds_never_collect_or_synchronize_even_with_consent(){
        let root=std::env::temp_dir().join(format!("no-type-dev-telemetry-{}",uuid::Uuid::new_v4()));
        let store=Store::open(&root).unwrap();
        store.update_preferences(|p|{p.usage_analytics=Some(true);p.usage_analytics_version=CONSENT_VERSION;Ok(())}).unwrap();
        assert!(!enabled(&store.preferences().unwrap()));
        let t:Transcript=serde_json::from_value(serde_json::json!({"id":"dev-test","text":"test dictation","status":"completed","duration":12.,"timestamp":chrono::Utc::now().timestamp_millis() as f64/1000.+1.})).unwrap();
        store.save_transcript(&t).unwrap();
        launch(&store).unwrap();
        record_setup_error(&store,"microphone permission").unwrap();
        assert!(crate::telemetry_details::payload(&store).is_err());
        {
            let db=store.db.lock().unwrap();
            for table in ["telemetry_daily","telemetry_outcomes","telemetry_dimensions","telemetry_seen"]{
                assert_eq!(db.query_row(&format!("SELECT COUNT(*) FROM {table}"),[],|r|r.get::<_,i64>(0)).unwrap(),0);
            }
            // A legacy queued identity must not trigger network access either.
            db.execute("INSERT INTO metadata(key,value) VALUES('telemetry.forget','invalid-json')",[]).unwrap();
        }
        synchronize(&store).await.unwrap();
        assert!(store.get_meta::<Identity>("telemetry.identity").unwrap().is_none());
        drop(store);std::fs::remove_dir_all(root).unwrap();
    }
}
