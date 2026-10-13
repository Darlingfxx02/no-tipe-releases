//! Bounded provisional recognition while the full recording remains untouched.
use crate::{audio, engine::AppState, session::RecordingSession, providers};
use std::{path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Emitter};

const WINDOW_SECONDS: usize = 12;
const OVERLAP_SECONDS: usize = 2;

#[derive(Default)]
struct LiveText { start: usize, committed: String, draft: String }
impl LiveText {
    fn update(&mut self, start: usize, text: String) -> String {
        if start != self.start {
            self.committed = join_overlap(&self.committed, &self.draft);
            self.start = start;
        }
        self.draft = text;
        join_overlap(&self.committed, &self.draft)
    }
}
fn normalized(word: &str) -> String { word.chars().filter(|c|c.is_alphanumeric()).flat_map(char::to_lowercase).collect() }
pub(crate) fn join_overlap(previous: &str, next: &str) -> String {
    if previous.is_empty() { return next.trim().into(); }
    let before: Vec<_> = previous.split_whitespace().collect();
    let after: Vec<_> = next.split_whitespace().collect();
    let overlap = (1..=before.len().min(after.len()).min(32)).rev().find(|&n|
        before[before.len()-n..].iter().zip(&after[..n]).all(|(a,b)|normalized(a)==normalized(b))
    ).unwrap_or(0);
    if overlap==after.len() { return previous.into(); }
    format!("{} {}",previous.trim(),after[overlap..].join(" "))
}
fn window_start(length: usize, rate: usize) -> usize {
    // Consecutive windows overlap in audio and text. Keep the earlier start
    // fixed while the current phrase grows, then commit it once at rollover.
    length.saturating_sub(rate*OVERLAP_SECONDS)/(rate*(WINDOW_SECONDS-OVERLAP_SECONDS))*(rate*(WINDOW_SECONDS-OVERLAP_SECONDS))
}
fn can_publish(expected: u64, current: u64, phase: &str, canceled: bool) -> bool {
    !canceled && expected==current && phase=="recording"
}
struct TemporaryAudio(PathBuf);
impl Drop for TemporaryAudio { fn drop(&mut self) { let _=std::fs::remove_file(&self.0); } }
fn first_delay(local: bool) -> Duration { Duration::from_millis(if local { 1000 } else { 2500 }) }
fn cadence(local: bool, failures: u64) -> Duration { Duration::from_millis((if local { 700 } else { 2500 }) * (1 + failures.min(4))) }
async fn canceled(cancel: &AtomicBool) {
    while !cancel.load(Ordering::Relaxed) { tokio::time::sleep(Duration::from_millis(10)).await; }
}

pub fn start(app: AppHandle, state: Arc<AppState>, generation: u64, session: Arc<RecordingSession>, buffer: Arc<Mutex<Vec<f32>>>, rate: u32, cancel: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let temp = TemporaryAudio(state.store.root.join("audio").join(format!(".live-{}.wav",uuid::Uuid::new_v4())));
        let mut text = LiveText::default();
        let mut last_length = 0;
        let mut failures = 0;
        let model = &session.model;
        let language = &session.configuration.language;
        let vocabulary = &session.vocabulary;
        if model.local {
            let prepared_session = session.clone();
            let prepare_cancel = cancel.clone();
            // Overlap weight loading with capture, including when live text is
            // hidden. Keep the session's lifecycle guard while weights are used.
            tauri::async_runtime::spawn(async move {
                let _ = providers::prepare_local(&prepared_session.model, prepare_cancel).await;
            });
        }
        let mut next = tokio::time::Instant::now() + first_delay(model.local);
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(next) => {},
                _ = canceled(&cancel) => break,
            }
            let attempt_started = tokio::time::Instant::now();
            next = attempt_started + cadence(model.local, failures);
            let status = state.runtime.lock().ok().map(|r|(r.generation,r.snapshot.state.clone(),r.snapshot.show_transcript,r.snapshot.paused));
            let Some((current,phase,visible,paused)) = status else { break; };
            if !can_publish(generation,current,&phase,cancel.load(Ordering::Relaxed)) { break; }
            if !visible || paused { continue; }
            let mut waiting_first_audio = false;
            let audio = buffer.lock().ok().and_then(|samples| {
                let length=samples.len();
                if length<rate as usize { waiting_first_audio = true; return None; }
                if length.saturating_sub(last_length)<rate as usize/2 { return None; }
                let fresh=&samples[last_length.min(length)..];
                last_length=length;
                let rms=(fresh.iter().map(|v|v*v).sum::<f32>()/fresh.len().max(1) as f32).sqrt();
                if rms<0.002 { return None; }
                let start=window_start(length,rate as usize);
                Some((start,samples[start..].to_vec()))
            });
            if model.local && waiting_first_audio {
                // Hardware packets need not align with our first 1-second tick.
                // Do not turn a few missing samples into another 700 ms delay.
                next = tokio::time::Instant::now() + Duration::from_millis(50);
            }
            let Some((start,samples)) = audio else { continue; };
            let path=temp.0.clone();
            let prepared = tokio::task::spawn_blocking(move || {
                let samples=audio::resample(&samples,rate,16000)?;
                audio::write_wav(&path,&samples)?;
                Ok::<_,String>(samples)
            }).await;
            let Ok(Ok(samples)) = prepared else { continue; };
            if cancel.load(Ordering::Relaxed) { break; }
            let recognition = if model.local {
                // Cooperative local cancellation preserves the WAV until the
                // helper/Whisper worker releases it and frees the shared engine.
                providers::transcribe(&model,&temp.0,samples,&language,&vocabulary,cancel.clone()).await
            } else {
                tokio::select! {
                    result=providers::transcribe(&model,&temp.0,samples,&language,&vocabulary,cancel.clone())=>result,
                    _=canceled(&cancel)=>break,
                }
            };
            if cancel.load(Ordering::Relaxed) { break; }
            match recognition {
                Ok(partial) if !partial.trim().is_empty() => {
                    failures=0;
                    let partial=text.update(start,partial);
                    let snapshot=state.runtime.lock().ok().and_then(|mut r| {
                        if !can_publish(generation,r.generation,&r.snapshot.state,cancel.load(Ordering::Relaxed)) || !r.snapshot.show_transcript || r.snapshot.paused { return None; }
                        if r.snapshot.transcript==partial { return None; }
                        r.snapshot.transcript=partial;
                        Some(r.snapshot.clone())
                    });
                    // Text changes do not change window visibility or focus.
                    if let Some(snapshot)=snapshot { let _=app.emit("cloud-state",snapshot); }
                }
                Err(error) if !error.contains("No speech") && !error.contains("No recognition") => {
                    failures+=1;
                    if failures==2 { let _=app.emit("delivery-notice","Live transcription is temporarily unavailable. Recording continues; the full text will be recognized when you finish."); }
                }
                _=>{}
            }
            // Local cadence is between starts. Slow inference causes one fresh
            // attempt, never a backlog. Preserve the cloud request/billing rate.
            next = if model.local { attempt_started } else { tokio::time::Instant::now() } + cadence(model.local, failures);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Model;
    #[test] fn inference_time_consumes_the_cadence_and_errors_still_back_off() {
        assert_eq!(first_delay(true), Duration::from_secs(1));
        assert_eq!(cadence(true,0).saturating_sub(Duration::from_millis(600)),Duration::from_millis(100));
        assert_eq!(cadence(true,0).saturating_sub(Duration::from_secs(3)),Duration::ZERO);
        assert_eq!(cadence(true,2),Duration::from_millis(2100));
        assert_eq!(cadence(false,0),Duration::from_millis(2500));
        assert_eq!(cadence(false,100),Duration::from_millis(12500));
    }
    #[test] fn preserves_long_dictations_without_duplicate_overlap() {
        let mut text=LiveText::default();
        assert_eq!(text.update(0,"Мы диктуем текст прямо сейчас".into()),"Мы диктуем текст прямо сейчас");
        assert_eq!(text.update(0,"Мы диктуем текст прямо сейчас и видим".into()),"Мы диктуем текст прямо сейчас и видим");
        assert_eq!(text.update(10,"сейчас и видим его в облачке".into()),"Мы диктуем текст прямо сейчас и видим его в облачке");
        assert_eq!(text.update(10,"сейчас и видим его в облачке без задержки".into()),"Мы диктуем текст прямо сейчас и видим его в облачке без задержки");
        assert_eq!(join_overlap("Hello, WORLD!","world again"),"Hello, WORLD! again");
    }
    #[test] fn window_is_bounded_and_includes_overlap() {
        let rate=16000;
        for seconds in 1..14400 {
            let length=seconds*rate;
            assert!(length-window_start(length,rate)<=WINDOW_SECONDS*rate);
        }
        assert_eq!(window_start(11*rate,rate),0);
        assert_eq!(window_start(12*rate,rate),10*rate);
    }
    #[test] fn late_results_cannot_reopen_or_overwrite_a_finished_session() {
        assert!(can_publish(7,7,"recording",false));
        assert!(!can_publish(7,8,"recording",false));
        assert!(!can_publish(7,7,"preparing",false));
        assert!(!can_publish(7,7,"idle",false));
        assert!(!can_publish(7,7,"recording",true));
    }
    #[tokio::test]
    #[ignore = "Requires the installed local GigaAM model and a speech fixture"]
    async fn gigaam_returns_text_before_the_recording_finishes() {
        let fixture=PathBuf::from(std::env::var("NOTYPE_LIVE_FIXTURE").expect("speech fixture"));
        let directory=PathBuf::from(std::env::var("NOTYPE_GIGAAM_DIRECTORY").expect("installed model"));
        crate::platform::configure(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let samples=audio::decode(&fixture).unwrap();
        assert!(samples.len()>5*16000);
        let model=Model {id:"test".into(),name:"GigaAM".into(),provider:"coreml".into(),model:crate::gigaam::ID.into(),endpoint:String::new(),local:true,path:Some(directory.to_string_lossy().into()),download_url:None,size:0,installed:true,has_key:true,languages:"Russian".into(),description:String::new()};
        let file=TemporaryAudio(std::env::temp_dir().join(format!("notype-live-test-{}.wav",uuid::Uuid::new_v4())));
        let mut outputs=vec![];
        for end in [3*16000,5*16000] {
            audio::write_wav(&file.0,&samples[..end]).unwrap();
            outputs.push(providers::transcribe(&model,&file.0,samples[..end].to_vec(),"ru",&[],Arc::new(AtomicBool::new(false))).await.unwrap());
        }
        assert!(!outputs[0].trim().is_empty());
        assert!(outputs[1].split_whitespace().count()>outputs[0].split_whitespace().count(),"More audio must update the partial transcript");
        println!("Local live recognition produced two growing partials before the end of the fixture.");
    }
    #[tokio::test]
    #[ignore = "Requires the installed local GigaAM model and a speech fixture"]
    async fn canceled_gigaam_preview_releases_the_engine_for_the_final_recording() {
        let fixture=PathBuf::from(std::env::var("NOTYPE_LIVE_FIXTURE").expect("speech fixture"));
        let directory=PathBuf::from(std::env::var("NOTYPE_GIGAAM_DIRECTORY").expect("installed model"));
        crate::platform::configure(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
        let samples=audio::decode(&fixture).unwrap();
        assert!(samples.len()>5*16000);
        let model=Model {id:"test".into(),name:"GigaAM".into(),provider:"coreml".into(),model:crate::gigaam::ID.into(),endpoint:String::new(),local:true,path:Some(directory.to_string_lossy().into()),download_url:None,size:0,installed:true,has_key:true,languages:"Russian".into(),description:String::new()};
        let file=TemporaryAudio(std::env::temp_dir().join(format!("no-tipe-cancel-test-{}.wav",uuid::Uuid::new_v4())));
        audio::write_wav(&file.0,&samples).unwrap();
        providers::prepare_local(&model,Arc::new(AtomicBool::new(false))).await.unwrap();
        let reference=providers::transcribe(&model,&file.0,samples.clone(),"ru",&[],Arc::new(AtomicBool::new(false))).await.unwrap();
        let cancel=Arc::new(AtomicBool::new(false));
        let preview_model=model.clone(); let preview_path=file.0.clone(); let preview_samples=samples.clone(); let preview_cancel=cancel.clone();
        let preview=tokio::spawn(async move { providers::transcribe(&preview_model,&preview_path,preview_samples,"ru",&[],preview_cancel).await });
        tokio::time::sleep(Duration::from_millis(10)).await;
        cancel.store(true,Ordering::Relaxed);
        let final_text=providers::transcribe(&model,&file.0,samples,"ru",&[],Arc::new(AtomicBool::new(false))).await.unwrap();
        assert_eq!(preview.await.unwrap().unwrap_err(),"Canceled");
        assert_eq!(final_text,reference,"canceling live must not change the full recognition");
    }
}
