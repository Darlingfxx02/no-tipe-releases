use crate::{
    credentials,
    domain::{validate_endpoint, Model, Preferences},
    store::err,
};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use reqwest::{
    multipart::{Form, Part},
    Client, Response,
};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

fn client(timeout: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(err)
}
async fn response(response: Response) -> Result<Value, String> {
    crate::diagnostics::record(if response.status().is_success() { "debug" } else { "error" }, "provider", "http.response", json!({"status":response.status().as_u16()}));
    let status = response.status();
    let bytes = response.bytes().await.map_err(err)?;
    if !status.is_success() {
        // Do not persist arbitrary provider responses, which can echo secrets or
        // dictated content. The status is sufficient for a useful local error.
        return Err(match status.as_u16() {
            401 | 403 => crate::localization::message("native.api_access"),
            429 => crate::localization::message("native.provider.rate_limit"),
            413 => crate::localization::message("native.provider.audio_too_large"),
            _ => crate::localization::message_with_values("native.provider.http",serde_json::json!({"status":status.as_u16()})),
        });
    }
    serde_json::from_slice(&bytes).map_err(|_| crate::localization::message("native.provider.invalid_json"))
}
fn text(v: &Value, pointer: &str) -> Result<String, String> {
    v.pointer(pointer)
        .and_then(Value::as_str)
        .filter(|t| !t.trim().is_empty())
        .map(|t| t.trim().to_owned())
        .ok_or(crate::localization::message("native.no_speech_text"))
}
fn file(bytes: Vec<u8>) -> Result<Part, String> {
    Part::bytes(bytes)
        .file_name("dictation.wav")
        .mime_str("audio/wav")
        .map_err(err)
}
pub async fn transcribe(
    model: &Model,
    path: &Path,
    samples: Vec<f32>,
    language: &str,
    vocabulary: &[String],
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    transcribe_progress(model,path,samples,language,vocabulary,cancel,None).await
}
struct WhisperCache { path: String, context: whisper_rs::WhisperContext, use_gpu: bool }
static WHISPER_CONTEXT: OnceLock<Mutex<Option<WhisperCache>>> = OnceLock::new();
fn whisper_error(key: &str, error: impl std::fmt::Display) -> String {
    crate::localization::message_with_values(key, json!({"detail": error.to_string()}))
}
unsafe extern "C" fn whisper_abort(user_data: *mut std::ffi::c_void) -> bool {
    // `transcribe_progress` keeps the Arc alive until synchronous inference and
    // its WhisperState have finished. All callback threads only read the flag.
    let cancel = unsafe { &*(user_data as *const AtomicBool) };
    cancel.load(Ordering::Relaxed)
}
fn load_whisper(cache: &mut Option<WhisperCache>, model_path: &str, allow_gpu: bool) -> Result<(), String> {
    if cache.as_ref().is_none_or(|cached| cached.path != model_path || (!allow_gpu && cached.use_gpu)) {
        // Release the previous weights before allocating another model. Holding
        // both during a switch can exhaust memory on Windows machines.
        *cache = None;
        crate::whisper_runtime::initialize_logging();
        let mut use_gpu = allow_gpu && crate::whisper_runtime::prefer_gpu();
        let mut context = whisper_rs::WhisperContext::new_with_params(model_path, crate::whisper_runtime::parameters(use_gpu));
        if use_gpu && context.is_err() {
            crate::diagnostics::record("warn", "whisper", "gpu.fallback", json!({"stage":"model-load"}));
            use_gpu = false;
            context = whisper_rs::WhisperContext::new_with_params(model_path, crate::whisper_runtime::parameters(false));
        }
        *cache = Some(WhisperCache { path: model_path.into(), context: context.map_err(|e| whisper_error("native.whisper_load_failed", e))?, use_gpu });
        crate::diagnostics::record("info", "whisper", "model.loaded", json!({"gpu_requested":use_gpu,"device":crate::whisper_runtime::device()}));
    }
    Ok(())
}
/// Prepare only the already selected local provider; never issue a cloud request.
pub async fn prepare_local(model: &Model, cancel: Arc<AtomicBool>) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
    match model.provider.as_str() {
        "sherpa-onnx" => crate::sherpa::prepare(model.clone(),cancel).await,
        "coreml" => {
            let directory = model.path.as_deref().ok_or("Download GigaAM in AI Models first")?;
            if !crate::gigaam::installed(Path::new(directory)) { return Err("Download GigaAM in AI Models first".into()); }
            crate::platform::prepare_coreml(directory, cancel).await
        }
        "whisper" => {
            let path = model.path.clone().filter(|path| Path::new(path).is_file()).ok_or_else(|| crate::localization::message("native.download_speech_model"))?;
            tokio::task::spawn_blocking(move || {
                let mut cache = WHISPER_CONTEXT.get_or_init(|| Mutex::new(None)).lock().map_err(err)?;
                if cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
                load_whisper(&mut cache, &path, true)
            }).await.map_err(err)?
        }
        _ => Ok(()),
    }
}
pub fn unload_whisper() -> Result<(),String> {
    *WHISPER_CONTEXT.get_or_init(||Mutex::new(None)).lock().map_err(err)?=None;
    Ok(())
}
pub type SpeechProgress=Arc<dyn Fn(String,f64)+Send+Sync>;
/// Exercise the packaged speech engine without opening a window or user data.
/// Reports contain timing, backend and transcript hashes, never dictated text.
pub fn benchmark_whisper(model_path: &Path, audio_path: &Path, cpu: bool) -> Result<Value, String> {
    use sha2::{Digest, Sha256};
    use std::time::Instant;
    let model_path = model_path.to_str().ok_or("Invalid model path")?.to_owned();
    let samples = crate::audio::decode(audio_path)?;
    if samples.is_empty() || samples.len() > 16000 * 120 {
        return Err("The benchmark requires between 0 and 120 seconds of audio".into());
    }
    let audio_seconds = samples.len() as f64 / 16000.;
    let start = Instant::now();
    {
        let mut cache = WHISPER_CONTEXT.get_or_init(|| Mutex::new(None)).lock().map_err(err)?;
        load_whisper(&mut cache, &model_path, !cpu)?;
    }
    let load_ms = start.elapsed().as_millis() as u64;
    let mut runs = Vec::new();
    for _ in 0..2 {
        let start = Instant::now();
        let text = recognize_whisper(model_path.clone(), samples.clone(), "en".into(), String::new(),
            Arc::new(AtomicBool::new(false)), None, !cpu)?;
        runs.push(json!({"elapsed_ms":start.elapsed().as_millis() as u64,
            "gpu_used":crate::whisper_runtime::gpu_active(), "text_characters":text.chars().count(),
            "text_sha256":format!("{:x}", Sha256::digest(text.as_bytes()))}));
    }
    Ok(json!({"cpu_forced":cpu,"device":crate::whisper_runtime::device(),
        "audio_seconds":audio_seconds,"load_ms":load_ms,"runs":runs}))
}

fn recognize_whisper(model_path: String, samples: Vec<f32>, language: String, vocabulary: String,
    cancel: Arc<AtomicBool>, progress: Option<SpeechProgress>, allow_gpu: bool) -> Result<String, String> {
    use whisper_rs::{
        FullParams, SamplingStrategy,
    };
    // Reuse loaded weights between live windows and final recognition.
    // Only one inference uses the GPU at a time; cancellation releases
    // the preview before the final recording is processed.
    let mut cache = WHISPER_CONTEXT.get_or_init(||Mutex::new(None)).lock().map_err(err)?;
    if cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
    for attempt in 0..2 {
        load_whisper(&mut cache, &model_path, allow_gpu && attempt == 0)?;
        if cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
        let cached = cache.as_ref().ok_or_else(|| crate::localization::message("native.speech_model_unavailable"))?;
        let use_gpu = cached.use_gpu;
        let mut state = match cached.context.create_state() {
            Ok(state) => state,
            Err(_) if use_gpu && attempt == 0 => {
                crate::diagnostics::record("warn", "whisper", "gpu.fallback", json!({"stage":"state-create"}));
                continue;
            },
            Err(error) => return Err(whisper_error("native.whisper_recognition_failed", error)),
        };
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(if language == "auto" {
            None
        } else {
            Some(&language)
        });
        params.set_translate(false);
        params.set_print_realtime(false);
        params.set_print_progress(false);
        params.set_print_timestamps(false);
        params.set_print_special(false);
        params.set_no_context(true);
        params.set_initial_prompt(&vocabulary);
        if let Some(progress)=progress.clone() {
            if attempt > 0 { progress(String::new(), 0.); }
            let mut partial=String::new();
            let callback: Box<dyn FnMut(whisper_rs::SegmentCallbackData)> = Box::new(move |segment| {
                partial.push_str(&segment.text);
                progress(partial.trim().to_owned(),segment.end_timestamp as f64/100.);
            });
            params.set_segment_callback_safe::<_, Box<dyn FnMut(whisper_rs::SegmentCallbackData)>>(Some(callback));
        }
        params.set_n_threads(
            std::thread::available_parallelism()
                .map(|p| p.get().min(8) as i32)
                .unwrap_or(4),
        );
        // whisper-rs 0.16's safe setter double-boxes a trait object, then
        // casts it to the concrete closure type in its C trampoline. This
        // reads the wrong memory and can abort healthy inference (-6) or
        // crash. Use a typed, borrowed AtomicBool with a stable Arc address.
        unsafe {
            params.set_abort_callback(Some(whisper_abort));
            params.set_abort_callback_user_data(Arc::as_ptr(&cancel) as *mut std::ffi::c_void);
        }
        let recognition = state.full(params, &samples);
        // Whisper returns a generic computation error when its abort
        // callback fires. Preserve cancellation as a separate outcome.
        if cancel.load(Ordering::Relaxed) { return Err("Canceled".into()); }
        if recognition.is_err() && use_gpu && attempt == 0 {
            drop(state);
            crate::diagnostics::record("warn", "whisper", "gpu.fallback", json!({"stage":"inference"}));
            continue;
        }
        recognition.map_err(|e| whisper_error("native.whisper_recognition_failed", e))?;
        let result = state
            .as_iter()
            .map(|segment| segment.to_string())
            .collect::<String>();
        return if result.trim().is_empty() {
            Err(crate::localization::message("native.no_speech"))
        } else {
            Ok(result.trim().to_owned())
        };
    }
    Err(crate::localization::message("native.speech_model_unavailable"))
}

pub async fn transcribe_progress(
    model: &Model,
    path: &Path,
    samples: Vec<f32>,
    language: &str,
    vocabulary: &[String],
    cancel: Arc<AtomicBool>,
    progress: Option<SpeechProgress>,
) -> Result<String, String> {
    crate::diagnostics::record("debug", "provider", "speech.started", json!({"provider":model.provider,"model":model.model}));
    if samples.is_empty() {
        return Err(crate::localization::message("native.no_audio"));
    }
    if model.provider=="sherpa-onnx" {
        return crate::sherpa::transcribe(model.clone(),samples,cancel,progress).await;
    }
    if model.provider == "whisper" {
        if model.languages=="English" && !matches!(language,"auto"|"en") {return Err(crate::localization::message("native.english_model"));}
        let model_path = model
            .path
            .clone()
            .filter(|p| Path::new(p).is_file())
            .ok_or_else(|| crate::localization::message("native.download_speech_model"))?;
        let language = language.to_owned();
        let vocabulary = vocabulary.join(", ");
        return tokio::task::spawn_blocking(move || recognize_whisper(model_path, samples, language,
            vocabulary, cancel, progress, true)).await.map_err(err)?;
    }
    if model.provider == "coreml" {
        let directory = model.path.as_deref().ok_or("Download GigaAM in AI Models first")?;
        if !crate::gigaam::installed(Path::new(directory)) { return Err("Download GigaAM in AI Models first".into()); }
        let text = crate::platform::coreml(path, directory, cancel).await?;
        if text.trim().is_empty() { return Err(crate::localization::message("native.no_speech")); }
        return Ok(text);
    }
    validate_endpoint(&model.endpoint)?;
    let key = credentials::get(&model.provider)?;
    let c = client(180)?;
    let base = model.endpoint.trim_end_matches('/');
    let bytes = tokio::fs::read(path).await.map_err(err)?;
    let has_language = language != "auto" && !language.is_empty();
    match model.provider.as_str() {
        "deepgram" => {
            let mut query = vec![
                ("model", model.model.as_str()),
                ("smart_format", "true"),
                ("punctuate", "true"),
            ];
            if has_language {
                query.push(("language", language));
            } else {
                query.push(("detect_language", "true"));
            }
            for term in vocabulary {
                query.push(("keyterm", term));
            }
            let v = response(
                c.post(format!("{base}/listen"))
                    .header("Authorization", format!("Token {key}"))
                    .query(&query)
                    .header("Content-Type", "audio/wav")
                    .body(bytes)
                    .send()
                    .await
                    .map_err(err)?,
            )
            .await?;
            text(&v, "/results/channels/0/alternatives/0/transcript")
        }
        "elevenlabs" => {
            let mut form = Form::new()
                .part("file", file(bytes)?)
                .text("model_id", model.model.clone())
                .text("temperature", "0.0")
                .text("tag_audio_events", "false")
                .text("no_verbatim", "true");
            if has_language {
                form = form.text("language_code", language.to_owned());
            }
            for term in vocabulary.iter().take(100) {
                form = form.text("keyterms", term.clone());
            }
            text(
                &response(
                    c.post(format!("{base}/speech-to-text"))
                        .header("xi-api-key", key)
                        .multipart(form)
                        .send()
                        .await
                        .map_err(err)?,
                )
                .await?,
                "/text",
            )
        }
        "gemini" => {
            let body = json!({"contents":[{"parts":[{"text":"Transcribe this audio. Return only the original spoken text, without explanations."},{"inlineData":{"mimeType":"audio/wav","data":base64::engine::general_purpose::STANDARD.encode(bytes)}}]}]});
            text(
                &response(
                    c.post(format!("{base}/models/{}:generateContent", model.model))
                        .header("x-goog-api-key", key)
                        .json(&body)
                        .send()
                        .await
                        .map_err(err)?,
                )
                .await?,
                "/candidates/0/content/parts/0/text",
            )
        }
        "assemblyai" => {
            let upload = response(
                c.post(format!("{base}/upload"))
                    .header("authorization", &key)
                    .body(bytes)
                    .send()
                    .await
                    .map_err(err)?,
            )
            .await?;
            let mut payload = json!({"audio_url":text(&upload,"/upload_url")?,"speech_models":[model.model],"punctuate":true,"format_text":true,"keyterms_prompt":vocabulary});
            if has_language {
                payload["language_code"] = json!(language);
            } else {
                payload["language_detection"] = json!(true);
            }
            let job = response(
                c.post(format!("{base}/transcript"))
                    .header("authorization", &key)
                    .json(&payload)
                    .send()
                    .await
                    .map_err(err)?,
            )
            .await?;
            let id = text(&job, "/id")?;
            poll(
                &c,
                &format!("{base}/transcript/{id}"),
                "authorization",
                &key,
                "/status",
                "completed",
                "/text",
                cancel,
            )
            .await
        }
        "soniox" => {
            let upload = response(
                c.post(format!("{base}/files"))
                    .bearer_auth(&key)
                    .multipart(Form::new().part("file", file(bytes)?))
                    .send()
                    .await
                    .map_err(err)?,
            )
            .await?;
            let file_id = text(&upload, "/id")?;
            let result=async{
                let mut payload=json!({"file_id":file_id,"model":model.model,"enable_speaker_diarization":false,"enable_language_identification":true,"context":{"terms":vocabulary}});if has_language{payload["language_hints"]=json!([language]);}
                let job=response(c.post(format!("{base}/transcriptions")).bearer_auth(&key).json(&payload).send().await.map_err(err)?).await?;let id=text(&job,"/id")?;
                let result=async{poll(&c,&format!("{base}/transcriptions/{id}"),"authorization",&format!("Bearer {key}"),"/status","completed","",cancel).await?;let v=response(c.get(format!("{base}/transcriptions/{id}/transcript")).bearer_auth(&key).send().await.map_err(err)?).await?;text(&v,"/text")}.await;
                let _=c.delete(format!("{base}/transcriptions/{id}")).bearer_auth(&key).send().await;result
            }.await;
            let _ = c
                .delete(format!("{base}/files/{file_id}"))
                .bearer_auth(&key)
                .send()
                .await;
            result
        }
        "speechmatics" => {
            let config = json!({"type":"transcription","transcription_config":{"language":if has_language{language}else{"auto"},"operating_point":model.model,"additional_vocab":vocabulary.iter().map(|t|json!({"content":t})).collect::<Vec<_>>()}});
            let job = response(
                c.post(format!("{base}/jobs"))
                    .bearer_auth(&key)
                    .multipart(
                        Form::new()
                            .text("config", config.to_string())
                            .part("data_file", file(bytes)?),
                    )
                    .send()
                    .await
                    .map_err(err)?,
            )
            .await?;
            let id = text(&job, "/id")?;
            let result = async {
                poll(
                    &c,
                    &format!("{base}/jobs/{id}"),
                    "authorization",
                    &format!("Bearer {key}"),
                    "/job/status",
                    "done",
                    "",
                    cancel,
                )
                .await?;
                let result = c
                    .get(format!("{base}/jobs/{id}/transcript?format=txt"))
                    .bearer_auth(&key)
                    .send()
                    .await
                    .map_err(err)?
                    .error_for_status()
                    .map_err(err)?
                    .text()
                    .await
                    .map_err(err)?;
                Ok(result.trim().to_owned())
            }
            .await;
            let _ = c
                .delete(format!("{base}/jobs/{id}"))
                .bearer_auth(&key)
                .send()
                .await;
            result
        }
        "cartesia" => cartesia(samples, &key, &model.model, cancel).await,
        _ => {
            let mut form = Form::new();
            let endpoint = if model.provider == "xai" {
                format!("{base}/stt")
            } else {
                form = form.text("model", model.model.clone());
                format!("{base}/audio/transcriptions")
            };
            if has_language {
                form = form.text("language", language.to_owned());
            }
            if !vocabulary.is_empty() && model.provider != "xai" {
                form = form.text("prompt", format!("Vocabulary: {}", vocabulary.join(", ")));
            }
            form = form.part("file", file(bytes)?);
            text(
                &response(
                    c.post(endpoint)
                        .bearer_auth(key)
                        .multipart(form)
                        .send()
                        .await
                        .map_err(err)?,
                )
                .await?,
                "/text",
            )
        }
    }
}
async fn poll(
    c: &Client,
    url: &str,
    header: &str,
    key: &str,
    status_path: &str,
    done: &str,
    text_path: &str,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    for _ in 0..600 {
        if cancel.load(Ordering::Relaxed) {
            return Err("Canceled".into());
        }
        let v = response(c.get(url).header(header, key).send().await.map_err(err)?).await?;
        let status = v.pointer(status_path).and_then(Value::as_str).unwrap_or("");
        if status == done {
            return if text_path.is_empty() {
                Ok(String::new())
            } else {
                text(&v, text_path)
            };
        }
        if ["failed", "error", "rejected", "deleted"].contains(&status) {
            return Err("The provider could not transcribe this recording".into());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("Transcription timed out".into())
}
async fn cartesia(
    samples: Vec<f32>,
    key: &str,
    model: &str,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
    let mut url = url::Url::parse("wss://api.cartesia.ai/stt/turns/websocket").map_err(err)?;
    url.query_pairs_mut().extend_pairs([
        ("model", model),
        ("encoding", "pcm_s16le"),
        ("sample_rate", "16000"),
        ("cartesia_version", "2026-03-01"),
    ]);
    let mut request = url.as_str().into_client_request().map_err(err)?;
    request
        .headers_mut()
        .insert("X-API-Key", key.parse().map_err(err)?);
    let (mut ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(err)?;
    for chunk in samples.chunks(8000) {
        if cancel.load(Ordering::Relaxed) {
            return Err("Canceled".into());
        }
        let data: Vec<u8> = chunk
            .iter()
            .flat_map(|s| ((s.clamp(-1., 1.) * 32767.) as i16).to_le_bytes())
            .collect();
        ws.send(Message::Binary(data.into())).await.map_err(err)?;
    }
    ws.send(Message::Text("{\"type\":\"close\"}".into()))
        .await
        .map_err(err)?;
    let mut final_text = String::new();
    while let Ok(Some(message)) = tokio::time::timeout(Duration::from_secs(30), ws.next()).await {
        let message = message.map_err(err)?;
        if let Message::Text(raw) = message {
            let v: Value = serde_json::from_str(&raw).map_err(err)?;
            if let Some(value) = v
                .get("text")
                .and_then(Value::as_str)
                .or_else(|| v.get("transcript").and_then(Value::as_str))
            {
                if v["is_final"] == true || v["type"] == "turn.end" {
                    final_text.push_str(value);
                    final_text.push(' ');
                }
            }
            if v["type"] == "done" || v["type"] == "close" {
                break;
            }
        } else if matches!(message, Message::Close(_)) {
            break;
        }
    }
    if final_text.trim().is_empty() {
        Err(crate::localization::message("native.no_speech_text"))
    } else {
        Ok(final_text.trim().into())
    }
}
pub async fn process(p: &Preferences, prompt: &str, input: &str) -> Result<String, String> {
    crate::diagnostics::record("info", "provider", "processing.started", json!({"provider":p.processing_provider,"model":p.processing_model,"characters":input.chars().count()}));
    if p.processing_provider == crate::text_models::PROVIDER {
        return crate::local_text::process(p, prompt, input).await;
    }
    validate_endpoint(&p.processing_endpoint)?;
    let c = client(p.processing_timeout)?;
    let base = p.processing_endpoint.trim_end_matches('/');
    let user = format!("<USER_MESSAGE>\n{input}\n</USER_MESSAGE>");
    if p.processing_provider == "ollama" {
        let root = base.strip_suffix("/v1").unwrap_or(base).trim_end_matches('/');
        let mut body = json!({"model":p.processing_model,"stream":false,"messages":[{"role":"system","content":prompt},{"role":"user","content":user}]});
        // Qwen thinking is useful for reasoning, but not for punctuation edits.
        if p.processing_model.to_lowercase().contains("qwen3") { body["think"] = json!(false); }
        let r = c.post(format!("{root}/api/chat")).json(&body).send().await.map_err(err)?;
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(format!("Ollama model '{}' is not installed. Choose an available text model in Modes or AI Models.", p.processing_model));
        }
        return text(&response(r).await?, "/message/content");
    }
    let key = credentials::get(&p.processing_provider)?;
    if p.processing_provider == "anthropic" {
        let v=response(c.post(format!("{base}/messages")).header("x-api-key",key).header("anthropic-version","2023-06-01").json(&json!({"model":p.processing_model,"system":prompt,"max_tokens":8192,"messages":[{"role":"user","content":user}]})).send().await.map_err(err)?).await?;
        text(&v, "/content/0/text")
    } else {
        let v=response(c.post(format!("{base}/chat/completions")).bearer_auth(key).json(&json!({"model":p.processing_model,"stream":false,"messages":[{"role":"system","content":prompt},{"role":"user","content":user}]})).send().await.map_err(err)?).await?;
        text(&v, "/choices/0/message/content")
    }
}

pub async fn processing_models(endpoint: &str) -> Result<Vec<String>, String> {
    validate_endpoint(endpoint)?;
    let base=endpoint.trim_end_matches('/');
    let root=base.strip_suffix("/v1").unwrap_or(base);
    let r=client(10)?.get(format!("{root}/api/tags")).send().await
        .map_err(|_|"Cannot connect to Ollama. Start Ollama and check its address.".to_owned())?;
    let v=response(r).await?;
    Ok(v["models"].as_array().ok_or("Ollama returned an invalid model list")?.iter()
        .filter_map(|m|m["name"].as_str().map(str::to_owned)).collect())
}

#[cfg(test)]
mod empty_audio_tests {
    use super::*;
    #[test]
    fn native_abort_callback_reads_only_the_live_atomic_flag() {
        let cancel=Arc::new(AtomicBool::new(false));
        let pointer=Arc::as_ptr(&cancel) as *mut std::ffi::c_void;
        assert!(!unsafe { whisper_abort(pointer) });
        cancel.store(true,Ordering::Relaxed);
        assert!(unsafe { whisper_abort(pointer) });
        cancel.store(false,Ordering::Relaxed);
        assert!(!unsafe { whisper_abort(pointer) });
        assert_eq!(Arc::strong_count(&cancel),1);
    }
    #[test]
    fn corrupt_weights_report_an_actionable_localized_error_and_do_not_keep_a_stale_context() {
        let path=std::env::temp_dir().join(format!("no-tipe-corrupt-model-{}.bin",uuid::Uuid::new_v4()));
        std::fs::write(&path,b"not a Whisper model").unwrap();
        let mut cache=None;
        let error=load_whisper(&mut cache,path.to_str().unwrap(),false).unwrap_err();
        assert!(error.contains("native.whisper_load_failed"));assert!(cache.is_none());
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn empty_audio_is_rejected_before_model_loading_or_provider_access() {
        for provider in ["coreml", "whisper", "openai", "deepgram"] {
            let model = Model {
                id: "empty-audio-test".into(), name: "Test".into(),
                provider: provider.into(), model: String::new(),
                endpoint: String::new(), local: true, path: None,
                download_url: None, size: 0, installed: false, has_key: false,
                languages: String::new(), description: String::new(),
            };
            let error = transcribe(&model, Path::new("missing.wav"), vec![], "ru", &[], Arc::new(AtomicBool::new(false)))
                .await.unwrap_err();
            assert_eq!(error, crate::localization::message("native.no_audio"));
        }
    }
}

#[cfg(test)]
mod processing_tests {
    use super::*;
    use std::{io::{Read, Write}, net::TcpListener};

    fn server(status: &str, body: &str) -> (String, std::thread::JoinHandle<Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let reply = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let task = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes = Vec::new();
            let (headers, offset) = loop {
                let mut chunk = [0; 1024];
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0); bytes.extend_from_slice(&chunk[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    break (String::from_utf8_lossy(&bytes[..end]).to_string(), end + 4);
                }
            };
            assert!(headers.starts_with("POST /api/chat "));
            let size: usize = headers.lines().find_map(|line|line.to_lowercase().strip_prefix("content-length: ").map(str::to_owned)).unwrap().parse().unwrap();
            while bytes.len() < offset + size {
                let mut chunk = [0;1024]; let n = stream.read(&mut chunk).unwrap(); assert!(n > 0); bytes.extend_from_slice(&chunk[..n]);
            }
            stream.write_all(reply.as_bytes()).unwrap();
            serde_json::from_slice(&bytes[offset..offset+size]).unwrap()
        });
        (url, task)
    }

    #[test]
    fn local_processing_uses_native_chat_without_thinking() {
        let (endpoint, request) = server("200 OK", r#"{"message":{"content":"Готовый текст."}}"#);
        let p = Preferences { processing_provider:"ollama".into(), processing_model:"qwen3.5:9b".into(), processing_endpoint:endpoint, ..Default::default() };
        let result = tokio::runtime::Runtime::new().unwrap().block_on(process(&p,"Correct punctuation.","готовый текст"));
        assert_eq!(result.unwrap(), "Готовый текст.");
        let sent = request.join().unwrap();
        assert_eq!(sent["think"], false);
        assert_eq!(sent["messages"][0]["content"], "Correct punctuation.");
        assert!(sent["messages"][1]["content"].as_str().unwrap().contains("готовый текст"));
    }

    #[test]
    fn missing_local_text_model_reports_actionable_error() {
        let (endpoint, request) = server("404 Not Found", r#"{"error":"model not found"}"#);
        let p = Preferences { processing_provider:"ollama".into(), processing_model:"missing-model".into(), processing_endpoint:endpoint, ..Default::default() };
        let error = tokio::runtime::Runtime::new().unwrap().block_on(process(&p,"Edit.","Example.")).unwrap_err();
        assert!(error.contains("missing-model") && error.contains("not installed"));
        request.join().unwrap();
    }
}
