//! No Type owns this private runtime, its model files and its complete lifecycle.
use crate::{domain::Preferences, store::err, text_models};
use serde_json::{json, Value};
use std::{net::TcpListener, path::PathBuf, process::{Child, Command, Stdio}, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

const CONTEXT: u32 = 16384;
struct Server { child:Child, model:String, url:String, key:String, used:Instant }
pub struct Engine { binary:PathBuf, root:PathBuf, server:Mutex<Option<Server>>, operation:tokio::sync::Mutex<()> }
static ENGINE:OnceLock<Engine>=OnceLock::new();

pub fn configure(resources:PathBuf, root:PathBuf) {
    let name=if cfg!(windows) {"no-tipe-text.exe"} else {"no-tipe-text"};
    let binary=resources.join("local-text").join(name);
    #[cfg(debug_assertions)]
    let binary=if binary.exists() {binary} else {PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("local-text").join(name)};
    let _=ENGINE.set(Engine::new(binary,root));
    tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Some(engine)=ENGINE.get() {
                if let Ok(_guard)=engine.operation.try_lock() {
                    let idle=engine.server.lock().is_ok_and(|s|s.as_ref().is_some_and(|s|s.used.elapsed()>Duration::from_secs(300)));
                    if idle { engine.stop(); }
                }
            }
        }
    });
}
pub fn shutdown() { if let Some(engine)=ENGINE.get() {engine.stop();} }
pub async fn unload(id:&str) -> Result<(),String> {
    if let Some(engine)=ENGINE.get() {
        let _guard=engine.operation.try_lock().map_err(|_|"Wait for text processing to finish before removing a model")?;
        let selected=engine.server.lock().map_err(err)?.as_ref().is_some_and(|s|s.model==id);
        if selected {engine.stop();}
    }
    Ok(())
}
pub async fn process(p:&Preferences, prompt:&str, input:&str) -> Result<String,String> {
    ENGINE.get().ok_or("The built-in text engine is not initialized")?.process(p,prompt,input).await
}
struct Interrupted<'a> {engine:&'a Engine, complete:bool}
impl Drop for Interrupted<'_> {fn drop(&mut self) {if !self.complete {self.engine.stop();}}}

impl Engine {
    fn new(binary:PathBuf,root:PathBuf)->Self {Self {binary,root,server:Mutex::new(None),operation:tokio::sync::Mutex::new(())}}
    fn stop(&self) {
        if let Ok(mut server)=self.server.lock() {
            if let Some(mut server)=server.take() {let _=server.child.kill();let _=server.child.wait();}
        }
    }
    fn alive(&self, model:&str)->Result<bool,String> {
        let mut server=self.server.lock().map_err(err)?;
        Ok(match server.as_mut() {Some(s) if s.model==model=>s.child.try_wait().map_err(err)?.is_none(),_=>false})
    }
    fn launch(&self, model:&str)->Result<(),String> {
        self.stop();
        let path=text_models::require_installed(&self.root,model)?;
        if !self.binary.is_file() {return Err("The built-in text engine is missing. Reinstall No Type.".into());}
        let listener=TcpListener::bind("127.0.0.1:0").map_err(err)?;
        let port=listener.local_addr().map_err(err)?.port();
        let key=uuid::Uuid::new_v4().to_string();
        let mut command=Command::new(&self.binary);
        command.args(["--model"]).arg(path).args(["--host","127.0.0.1","--port",&port.to_string(),
            "--ctx-size",&CONTEXT.to_string(),"--parallel","1","--jinja","--no-webui",
            "--offline","--no-context-shift","--reasoning-budget","0","--chat-template-kwargs","{\"enable_thinking\":false}",
            "--log-disable"]);
        // Discard inherited llama/GGML settings and credentials. The API key never
        // appears in a command line, on disk, in backups or in the frontend.
        command.env_clear().envs(std::env::vars().filter(|(k,_)|["PATH","HOME","TMPDIR","SystemRoot","WINDIR","TEMP","USERPROFILE","LOCALAPPDATA"].contains(&k.as_str())))
            .env("LLAMA_API_KEY",&key).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt;command.creation_flags(0x08000000); }
        drop(listener);
        let child=command.spawn().map_err(|e|format!("Could not start No Type's text engine: {e}"))?;
        *self.server.lock().map_err(err)?=Some(Server {child,model:model.into(),url:format!("http://127.0.0.1:{port}"),key,used:Instant::now()});
        Ok(())
    }
    async fn process(&self,p:&Preferences,prompt:&str,input:&str)->Result<String,String> {
        let _operation=self.operation.lock().await;
        let mut interrupted=Interrupted {engine:self,complete:false};
        if !self.alive(&p.processing_model)? {self.launch(&p.processing_model)?;}
        let (url,key)={let server=self.server.lock().map_err(err)?;let s=server.as_ref().ok_or("Text engine stopped")?;(s.url.clone(),s.key.clone())};
        let health=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).redirect(reqwest::redirect::Policy::none()).build().map_err(err)?;
        let start=Instant::now();
        loop {
            if !self.alive(&p.processing_model)? {return Err("The local text model could not load. Check that it is a complete GGUF model supported by llama.cpp and that enough memory is available.".into());}
            if health.get(format!("{url}/health")).bearer_auth(&key).send().await.is_ok_and(|r|r.status().is_success()) {break;}
            if start.elapsed()>Duration::from_secs(180) {return Err("The local text model took too long to load. Try a smaller model.".into());}
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let client=reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(p.processing_timeout)).redirect(reqwest::redirect::Policy::none()).build().map_err(err)?;
        let body=json!({"model":p.processing_model,"stream":false,"temperature":0.2,"max_tokens":8192,
            "chat_template_kwargs":{"enable_thinking":false},"messages":[{"role":"system","content":prompt},{"role":"user","content":format!("<USER_MESSAGE>\n{input}\n</USER_MESSAGE>")} ]});
        let response=client.post(format!("{url}/v1/chat/completions")).bearer_auth(key).json(&body).send().await
            .map_err(|e|if e.is_timeout() {"Local text processing timed out. Try a smaller model or increase the processing timeout.".into()} else {format!("Local text processing failed: {e}")})?;
        let status=response.status();
        let value:Value=response.json().await.map_err(err)?;
        if !status.is_success() {
            let message=value.pointer("/error/message").and_then(Value::as_str).unwrap_or("Local text processing failed");
            return Err(format!("{message}. Try a shorter text or another installed model."));
        }
        let output=completed_text(&value)?;
        if let Some(s)=self.server.lock().map_err(err)?.as_mut() {s.used=Instant::now();}
        interrupted.complete=true;
        Ok(output)
    }
}
impl Drop for Engine {fn drop(&mut self) {self.stop();}}
fn completed_text(value:&Value)->Result<String,String> {
    if value.pointer("/choices/0/finish_reason").and_then(Value::as_str)!=Some("stop") {return Err("The local model did not finish the text. Try a shorter text or another model; the original transcript is preserved.".into());}
    let output=value.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").trim();
    if output.is_empty() {return Err("The local text model returned no text".into());}
    Ok(output.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_generation_is_never_delivered_as_completed_text() {
        assert!(completed_text(&json!({"choices":[{"finish_reason":"length","message":{"content":"Partial"}}]})).is_err());
        assert_eq!(completed_text(&json!({"choices":[{"finish_reason":"stop","message":{"content":"Готово."}}]})).unwrap(),"Готово.");
    }
    #[tokio::test]
    async fn missing_model_is_actionable_without_ollama_or_credentials() {
        let engine=Engine::new(PathBuf::from("missing-runtime"),std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()));
        let p=Preferences {processing_provider:"local".into(),processing_model:text_models::DEFAULT_MODEL.into(),..Default::default()};
        assert_eq!(engine.process(&p,"Edit.","Text.").await.unwrap_err(),crate::localization::message("native.download_text_model"));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn canceling_a_request_stops_the_owned_process() {
        let engine=Engine::new(PathBuf::new(),PathBuf::new());
        let p=Preferences::default();
        let child=Command::new("sleep").arg("30").spawn().unwrap();
        *engine.server.lock().unwrap()=Some(Server {child,model:p.processing_model.clone(),url:"http://127.0.0.1:1".into(),key:"test".into(),used:Instant::now()});
        assert!(tokio::time::timeout(Duration::from_millis(40),engine.process(&p,"Edit.","Text.")).await.is_err());
        assert!(engine.server.lock().unwrap().is_none());
    }
    #[tokio::test]
    #[ignore = "requires a downloaded model and the built native runtime"]
    async fn native_runtime_edits_without_an_external_service() {
        let root=PathBuf::from(std::env::var("NO_TIPE_TEST_DATA").expect("NO_TIPE_TEST_DATA"));
        let binary=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("local-text/no-tipe-text");
        let engine=Engine::new(binary,root);
        let p=Preferences {processing_model:std::env::var("NO_TIPE_TEST_MODEL").unwrap_or(text_models::DEFAULT_MODEL.into()),processing_timeout:180,..Default::default()};
        let output=engine.process(&p,"Correct punctuation and capitalization. Return only the corrected Russian text. Preserve every word.","привет это проверка локальной модели она работает без внешних приложений").await.unwrap();
        assert!(output.contains("проверка") && output.contains("модели"),"{output}");
        assert!(engine.alive(&p.processing_model).unwrap());
        engine.stop();assert!(!engine.alive(&p.processing_model).unwrap());
    }
}
