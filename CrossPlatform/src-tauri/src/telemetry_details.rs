//! Bounded categories and counters only. Content and raw errors never enter the payload.
use crate::{domain::{Transcript,ProcessingState},store::{Store,err}};
use rusqlite::{Connection,params};
use serde::{Deserialize,Serialize};
use std::{collections::BTreeMap,sync::LazyLock};
#[derive(Deserialize)]struct Catalog{speech:BTreeMap<String,String>,processing:BTreeMap<String,String>,languages:Vec<String>}
static CATALOG:LazyLock<Catalog>=LazyLock::new(||serde_json::from_str(include_str!("../analytics-catalog.json")).unwrap());
const VERSION:&str=crate::channel::VERSION;
#[derive(Serialize)]pub struct Counter{day:String,version:String,kind:String,key:String,count:u32}
#[derive(Serialize)]#[serde(rename_all="camelCase")]pub struct Profile{at:i64,version:String,platform:String,theme:String,ui_language:String,recognition_language:String,recorder_style:String,dictionary:u32,snippets:u32,modes:u32}
#[derive(Serialize)]pub struct Details{pub profile:Profile,pub counters:Vec<Counter>}
pub fn create_tables(db:&Connection)->Result<(),String>{db.execute_batch("CREATE TABLE IF NOT EXISTS telemetry_dimensions(day TEXT NOT NULL,version TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,version,kind,key));CREATE TABLE IF NOT EXISTS telemetry_seen(id TEXT NOT NULL,kind TEXT NOT NULL,day TEXT NOT NULL,PRIMARY KEY(id,kind));").map_err(err)}
fn category(map:&BTreeMap<String,String>,value:&str)->String{if map.contains_key(value){value.into()}else{"other".into()}}
fn language(value:&str)->String{if CATALOG.languages.iter().any(|v|v==value){value.into()}else{"other".into()}}
fn error_category(value:&str)->&'static str{
 let e=value.to_ascii_lowercase();
 if e.contains("api_access")||e.contains("key_required")||e.contains("unauthorized")||e.contains("401")||e.contains("403"){"authentication"}
 else if e.contains("rate_limit")||e.contains("429"){"rate_limit"}
 else if e.contains("timeout")||e.contains("timed out"){"timeout"}
 else if e.contains("permission")||e.contains("accessibility"){"permission"}
 else if e.contains("microphone")||e.contains("audio_device")||e.contains("input device")||e.contains("input stream"){"microphone"}
 else if e.contains("download")||e.contains("model_unavailable")||e.contains("weights")||e.contains("model_missing")||e.contains("model not found"){"model_unavailable"}
 else if e.contains("interrupted")||e.contains("cancel"){"interrupted"}
 else if e.contains("connect")||e.contains("network")||e.contains("dns")||e.contains("tls"){"network"}
 else if e.contains("invalid_json")||e.contains("invalid response"){"invalid_response"}
 else if e.contains("provider.http"){"provider_error"}else{"other"}
}
fn count_once(db:&Connection,t:&Transcript,kind:&str,key:&str)->Result<(),String>{
 let day=chrono::Utc::now().format("%Y-%m-%d").to_string();
 if db.execute("INSERT OR IGNORE INTO telemetry_seen(id,kind,day) VALUES(?1,?2,?3)",params![t.id,kind,day]).map_err(err)?==0{return Ok(());}
 db.execute("INSERT INTO telemetry_dimensions(day,version,kind,key,count) VALUES(?1,?2,?3,?4,1) ON CONFLICT(day,version,kind,key) DO UPDATE SET count=MIN(10000,count+1)",params![day,VERSION,kind,key]).map_err(err)?;Ok(())
}
pub fn setup_error(db:&Connection,error:&str)->Result<(),String>{
 let day=chrono::Utc::now().format("%Y-%m-%d").to_string();
 db.execute("INSERT INTO telemetry_dimensions(day,version,kind,key,count) VALUES(?1,?2,'error_setup',?3,1) ON CONFLICT(day,version,kind,key) DO UPDATE SET count=MIN(10000,count+1)",params![day,VERSION,error_category(error)]).map_err(err)?;
 Ok(())
}
pub fn record(db:&Connection,t:&Transcript)->Result<(),String>{
 if t.status=="completed"&&!t.text.trim().is_empty(){
  let model=t.session_config.as_ref().map(|c|c.speech_model.id.as_str()).unwrap_or("other");
  count_once(db,t,"speech",&category(&CATALOG.speech,model))?;
  let lang=t.session_config.as_ref().map(|c|c.language.as_str()).unwrap_or("other");
  count_once(db,t,"language",&language(lang))?;
 }
 if t.processing_state==ProcessingState::Completed&&t.enhanced_text.as_ref().is_some_and(|v|!v.trim().is_empty()){
  let config=t.processing_config.as_ref().or_else(||t.session_config.as_ref().map(|c|&c.processing));
  let id=config.filter(|c|c.provider=="local").map(|c|c.model.as_str()).unwrap_or("other");
  count_once(db,t,"processing",&category(&CATALOG.processing,id))?;
 }
 for(kind,error)in[("error_recognition",t.recognition_error.as_deref().or_else(||if t.status=="failed"{t.processing_error.as_deref()}else{None})),("error_processing",if t.status!="failed"{t.processing_error.as_deref()}else{None}),("error_delivery",t.delivery_error.as_deref())]{
  if let Some(error)=error.filter(|v|!v.is_empty()){count_once(db,t,kind,error_category(error))?;}
 }Ok(())
}
pub fn payload(store:&Store)->Result<Details,String>{
 let db=store.db.lock().map_err(err)?;
 let p:crate::domain::Preferences=db.query_row("SELECT value FROM metadata WHERE key='preferences'",[],|r|r.get::<_,String>(0)).map_err(err).and_then(|v|serde_json::from_str(&v).map_err(err))?;
 if !crate::telemetry::enabled(&p){return Err("Statistics disabled".into());}
 let before=(chrono::Utc::now()-chrono::Duration::days(30)).format("%Y-%m-%d").to_string();
 db.execute("DELETE FROM telemetry_dimensions WHERE day < ?1",[&before]).map_err(err)?;
 db.execute("DELETE FROM telemetry_seen WHERE day < ?1",[&before]).map_err(err)?;
 let count=|table:&str|db.query_row(&format!("SELECT MIN(COUNT(*),1000000) FROM {table}"),[],|r|r.get::<_,u32>(0)).map_err(err);
 let profile=Profile{at:chrono::Utc::now().timestamp_millis(),version:VERSION.into(),platform:std::env::consts::OS.into(),theme:p.palette,ui_language:crate::localization::resolve(&p.ui_language).into(),recognition_language:language(&p.language),recorder_style:p.recorder_style,dictionary:count("dictionary")?,snippets:count("snippets")?,modes:count("modes")?};
 let mut q=db.prepare("SELECT day,version,kind,key,count FROM telemetry_dimensions ORDER BY day DESC,version,kind,key").map_err(err)?;
 let counters=q.query_map([],|r|Ok(Counter{day:r.get(0)?,version:r.get(1)?,kind:r.get(2)?,key:r.get(3)?,count:r.get(4)?})).map_err(err)?.collect::<Result<Vec<_>,_>>().map_err(err)?;
 Ok(Details{profile,counters})
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn content_cannot_be_a_category(){assert_eq!(category(&CATALOG.speech,"private-key-or-model-name"),"other");assert_eq!(language("private text"),"other");assert_eq!(error_category("request timed out at https://secret.example/key"),"timeout");assert_eq!(error_category("private words"),"other");}
}
