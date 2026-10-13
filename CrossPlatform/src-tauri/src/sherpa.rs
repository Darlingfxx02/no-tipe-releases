//! Pinned ONNX conversions run locally on macOS and Windows.
use crate::{domain::Model, providers::SpeechProgress, store::err};
use std::ffi::{c_char,c_void,CStr,CString};

extern "C" {
    fn no_type_speech_create(directory:*const c_char,architecture:*const c_char,model_file:*const c_char,
        decoder_file:*const c_char,joiner_file:*const c_char,tokens_file:*const c_char,feature_dim:i32,threads:i32)->*const c_void;
    fn no_type_speech_destroy(recognizer:*const c_void);
    fn no_type_speech_decode(recognizer:*const c_void,samples:*const f32,length:i32)->*const c_char;
    fn no_type_speech_result_free(result:*const c_char);
}
struct Recognizer(*const c_void);
// Each handle is owned by the cache and accessed only while its mutex is held.
unsafe impl Send for Recognizer {}
impl Drop for Recognizer {fn drop(&mut self){unsafe{no_type_speech_destroy(self.0)}}}
use std::{path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, OnceLock}};

pub const PARAKEET_ID:&str="parakeet-tdt-0.6b-v3-int8";
pub const GIGAAM_V3_ID:&str="gigaam-v3-e2e-rnnt-int8";
pub const GIGAAM_MULTILINGUAL_ID:&str="gigaam-multilingual-ctc-int8";
pub const GIGAAM_MULTILINGUAL_LARGE_ID:&str="gigaam-multilingual-large-ctc-int8";
pub fn bundle_id(repository:&str,file:&str)->Option<&'static str> {
    match (repository,file) {
        ("csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8","encoder.int8.onnx")=>Some(PARAKEET_ID),
        ("Alexxerm/gigaam-v3-e2e-rnnt-sherpa-onnx","encoder.int8.onnx")=>Some(GIGAAM_V3_ID),
        ("fussraider/GigaAM-Multilingual-sherpa-onnx-ctc","model.int8.onnx")=>Some(GIGAAM_MULTILINGUAL_ID),
        ("fussraider/GigaAM-Multilingual-sherpa-onnx-ctc","large/model.int8.onnx")=>Some(GIGAAM_MULTILINGUAL_LARGE_ID),
        _=>None,
    }
}
struct Cached {path:String, recognizer:Recognizer}
static CACHE:OnceLock<Mutex<Option<Cached>>>=OnceLock::new();

fn check(cancel:&AtomicBool)->Result<(),String> {
    if cancel.load(Ordering::Relaxed) {Err("Canceled".into())} else {Ok(())}
}
fn load(cache:&mut Option<Cached>,model:&Model)->Result<(),String> {
    let template=serde_json::from_str::<Vec<crate::model_hub::Asset>>(include_str!("../speech-model-bundles.json")).unwrap()
        .into_iter().find(|asset|asset.id()==model.model).ok_or("Unsupported ONNX speech model")?;
    let path=model.path.as_deref().ok_or_else(||crate::localization::message("native.download_speech_model"))?;
    if cache.as_ref().is_some_and(|c|c.path==path) {return Ok(());}
    if !template.files.iter().all(|f|std::fs::metadata(Path::new(path).join(&f.path)).is_ok_and(|m|m.is_file()&&m.len()==f.size)) {
        return Err(crate::localization::message("native.download_speech_model"));
    }
    *cache=None;
    let path_string=CString::new(path).map_err(err)?;
    let architecture=CString::new(template.architecture.as_str()).map_err(err)?;
    let model_file=CString::new(template.file.as_str()).map_err(err)?;
    let member=|prefix:&str|CString::new(template.files.iter().find(|f|f.path.rsplit('/').next().is_some_and(|name|name.starts_with(prefix))).map_or("",|f|f.path.as_str())).map_err(err);
    let decoder=member("decoder.")?;let joiner=member("joiner.")?;let tokens=member("tokens.")?;
    let feature_dim=if model.model==PARAKEET_ID {80} else {64};
    let threads=std::thread::available_parallelism().map_or(2,|v|v.get().min(4)) as i32;
    let pointer=unsafe {no_type_speech_create(path_string.as_ptr(),architecture.as_ptr(),model_file.as_ptr(),decoder.as_ptr(),joiner.as_ptr(),tokens.as_ptr(),feature_dim,threads)};
    if pointer.is_null() {return Err(format!("Unable to load {}",model.name));}
    let recognizer=Recognizer(pointer);
    *cache=Some(Cached{path:path.into(),recognizer});
    Ok(())
}
pub async fn prepare(model:Model,cancel:Arc<AtomicBool>)->Result<(),String> {
    tokio::task::spawn_blocking(move||{
        let mut cache=CACHE.get_or_init(||Mutex::new(None)).lock().map_err(err)?;
        check(&cancel)?;load(&mut cache,&model)?;check(&cancel)
    }).await.map_err(err)?
}
pub async fn transcribe(model:Model,samples:Vec<f32>,cancel:Arc<AtomicBool>,progress:Option<SpeechProgress>)->Result<String,String> {
    tokio::task::spawn_blocking(move||{
        let mut cache=CACHE.get_or_init(||Mutex::new(None)).lock().map_err(err)?;
        check(&cancel)?;load(&mut cache,&model)?;check(&cancel)?;
        let recognizer=&cache.as_ref().unwrap().recognizer;
        let mut text=String::new();let mut start=0;
        // Bound memory and cancellation latency for long recordings. The overlap
        // preserves words at boundaries and is removed from the committed text.
        while start<samples.len() {
            check(&cancel)?;
            let end=(start+24*16000).min(samples.len());
            let pointer=unsafe {no_type_speech_decode(recognizer.0,samples[start..end].as_ptr(),(end-start) as i32)};
            if pointer.is_null() {return Err(format!("{} recognition failed",model.name));}
            let bytes=unsafe {CStr::from_ptr(pointer).to_bytes().to_vec()};
            unsafe {no_type_speech_result_free(pointer)};
            check(&cancel)?;
            let result:serde_json::Value=serde_json::from_slice(&bytes).map_err(err)?;
            text=crate::live::join_overlap(&text,result["text"].as_str().ok_or("Speech recognition result is unavailable")?.trim());
            if let Some(callback)=&progress {callback(text.clone(),end as f64/16000.);}
            if end==samples.len() {break;}
            start=end-2*16000;
        }
        if text.trim().is_empty() {Err(crate::localization::message("native.no_speech"))} else {Ok(text)}
    }).await.map_err(err)?
}
pub fn unload()->Result<(),String> {
    *CACHE.get_or_init(||Mutex::new(None)).lock().map_err(err)?=None;Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore="requires downloaded Parakeet weights and official speech fixture"]
    async fn real_parakeet_recognizes_and_reuses_cached_weights() {
        let directory=std::env::var("NO_TYPE_PARAKEET_DIR").expect("NO_TYPE_PARAKEET_DIR");
        let audio=std::env::var("NO_TYPE_PARAKEET_WAV").expect("NO_TYPE_PARAKEET_WAV");
        let root=Path::new(&directory).parent().unwrap().parent().unwrap().to_path_buf();
        let asset=crate::model_hub::assets(&root,crate::model_hub::Kind::Speech).into_iter().find(|a|a.id()==PARAKEET_ID).unwrap();
        let model=Model{path:Some(directory.clone()),..asset.model(&root)};
        let samples=crate::audio::decode(Path::new(&audio)).unwrap();
        prepare(model.clone(),Arc::new(AtomicBool::new(false))).await.unwrap();
        let reference=crate::providers::transcribe(&model,Path::new(&audio),samples.clone(),"en",&[],Arc::new(AtomicBool::new(false))).await.unwrap();
        assert!(reference.to_lowercase().contains("ask not what your country can do for you"),"{reference}");
        let canceled=transcribe(model.clone(),samples.clone(),Arc::new(AtomicBool::new(true)),None).await.unwrap_err();
        assert_eq!(canceled,"Canceled");
        assert_eq!(transcribe(model,samples,Arc::new(AtomicBool::new(false)),None).await.unwrap(),reference);
        if let Ok(audio)=std::env::var("NO_TYPE_PARAKEET_RU_WAV") {
            let samples=crate::audio::decode(Path::new(&audio)).unwrap();
            let model=Model{path:Some(directory),..asset.model(&root)};
            let text=crate::providers::transcribe(&model,Path::new(&audio),samples,"ru",&[],Arc::new(AtomicBool::new(false))).await.unwrap().to_lowercase();
            assert!(text.contains("проверка")&&text.contains("русской речи"),"{text}");
        }
        unload().unwrap();
    }
}
