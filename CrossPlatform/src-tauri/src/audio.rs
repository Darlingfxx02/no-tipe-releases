use crate::store::err;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{FftFixedInOut, Resampler};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Deserialize, Serialize)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub default: bool,
}
pub fn devices() -> Result<Vec<Device>, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(input_catalog()?.devices)
    }
    #[cfg(not(target_os = "macos"))]
    {
        system_devices()
    }
}
#[cfg(not(target_os = "macos"))]
fn system_devices() -> Result<Vec<Device>, String> {
    let host = cpal::default_host();
    let default = host
        .default_input_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();
    Ok(host
        .input_devices()
        .map_err(err)?
        .filter_map(|d| d.name().ok())
        .map(|name| Device {
            id: name.clone(),
            default: name == default,
            name,
        })
        .collect())
}

#[cfg(any(target_os = "macos", test))]
#[derive(Deserialize)]
struct InputCatalog {
    devices: Vec<Device>,
    blocked: Vec<String>,
}
#[cfg(any(target_os = "macos", test))]
impl InputCatalog {
    fn resolve(&self, requested: &str) -> Result<String, String> {
        if !requested.is_empty() && !self.blocked.iter().any(|name| name == requested) {
            return self
                .devices
                .iter()
                .find(|d| d.id == requested)
                .map(|d| d.name.clone())
                .ok_or_else(|| crate::localization::message("native.microphone_unavailable"));
        }
        self.devices.iter().find(|d| d.default).or_else(|| self.devices.first())
            .map(|d| d.name.clone()).ok_or_else(||
                crate::localization::message("native.wired_microphone"))
    }
}
#[cfg(target_os = "macos")]
fn input_catalog() -> Result<InputCatalog, String> {
    unsafe extern "C" {
        fn no_tipe_audio_devices() -> *mut std::ffi::c_char;
        fn no_tipe_audio_free(value: *mut std::ffi::c_char);
    }
    let value = unsafe { no_tipe_audio_devices() };
    if value.is_null() {
        return Err("Audio input devices are unavailable".into());
    }
    let bytes = unsafe { std::ffi::CStr::from_ptr(value).to_bytes().to_vec() };
    unsafe {
        no_tipe_audio_free(value);
    }
    serde_json::from_slice(&bytes).map_err(err)
}

fn recording_input(host: &cpal::Host, requested: &str) -> Result<cpal::Device, String> {
    #[cfg(target_os = "macos")]
    let requested = input_catalog()?.resolve(requested)?;
    #[cfg(not(target_os = "macos"))]
    if requested.is_empty() {
        return host
            .default_input_device()
            .ok_or_else(|| crate::localization::message("native.microphone_unavailable"));
    }
    host.input_devices()
        .map_err(err)?
        .find(|device| device.name().ok().as_deref() == Some(requested.as_ref()))
        .ok_or_else(|| crate::localization::message("native.microphone_unavailable"))
}
enum Command {
    Stop(mpsc::Sender<Result<Captured, String>>),
    Cancel,
}
pub struct Captured {
    pub samples: Vec<f32>,
    pub path: PathBuf,
    pub duration: f64,
    delete_on_drop: bool,
}
impl Captured {
    pub fn new(samples: Vec<f32>, path: PathBuf, duration: f64) -> Self {
        Self { samples, path, duration, delete_on_drop: true }
    }
    pub fn keep_for_retry(&mut self) { self.delete_on_drop = false; }
    pub fn discard_on_drop(&mut self) { self.delete_on_drop = true; }
    pub fn into_dictation(self) -> Option<Self> {
        // Canonical audio is 16 kHz. Less than one 20 ms speech-analysis window
        // is an accidental key press, not a recording to send to a provider.
        if self.samples.len() < 320 {
            None
        } else {
            Some(self)
        }
    }
}
impl Drop for Captured {
    fn drop(&mut self) {
        if self.delete_on_drop { let _ = std::fs::remove_file(&self.path); }
    }
}
pub struct Recorder {
    sender: mpsc::Sender<Command>,
    pub paused: Arc<AtomicBool>,
    pub buffer: Arc<Mutex<Vec<f32>>>,
    pub rate: u32,
}
impl Recorder {
    pub fn start(app: AppHandle, device: String, path: PathBuf) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let paused = Arc::new(AtomicBool::new(false));
        let paused_worker = paused.clone();
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let worker_buffer = buffer.clone();
        std::thread::spawn(move || {
            let host = cpal::default_host();
            let setup = (|| -> Result<_, String> {
                // Resolve before opening any stream: opening a Bluetooth input
                // already switches the headphones into their call profile.
                let input = recording_input(&host, &device)?;
                let config = input.default_input_config().map_err(err)?;
                let rate = config.sample_rate().0;
                let channels = config.channels() as usize;
                let paused = paused_worker.clone();
                let buffer = worker_buffer.clone();
                let app2 = app.clone();
                let mut last = Instant::now();
                let mut consume = move |values: Vec<f32>| {
                    if paused.load(Ordering::Relaxed) {
                        return;
                    }
                    let mono: Vec<_> = values
                        .chunks(channels)
                        .map(|v| v.iter().sum::<f32>() / channels as f32)
                        .collect();
                    let rms =
                        (mono.iter().map(|v| v * v).sum::<f32>() / mono.len().max(1) as f32).sqrt();
                    let peak = mono.iter().map(|v| v.abs()).fold(0f32, f32::max);
                    if let Ok(mut data) = buffer.lock() {
                        // Bound memory even if a shortcut release is missed: four hours.
                        if data.len() < rate as usize * 14400 {
                            data.extend(mono);
                        } else {
                            let _ =
                                app2.emit("audio-error", "Recording reached the four-hour limit");
                        }
                    }
                    if last.elapsed() >= Duration::from_millis(32) {
                        let level = ((rms.max(1e-6).log10() * 20. + 55.) / 45.).clamp(0., 1.);
                        let peak = ((peak.max(1e-6).log10() * 20. + 45.) / 40.).clamp(0., 1.);
                        let _ = app2.emit(
                            "cloud-audio",
                            serde_json::json!({"level":level,"peak":peak}),
                        );
                        last = Instant::now();
                    }
                };
                let on_error = move |e: cpal::StreamError| {
                    let _ = app.emit("audio-error", e.to_string());
                };
                let stream = match config.sample_format() {
                    cpal::SampleFormat::F32 => input.build_input_stream(
                        &config.config(),
                        move |data: &[f32], _| consume(data.to_vec()),
                        on_error,
                        None,
                    ),
                    cpal::SampleFormat::I16 => input.build_input_stream(
                        &config.config(),
                        move |data: &[i16], _| {
                            consume(data.iter().map(|s| *s as f32 / 32768.).collect())
                        },
                        on_error,
                        None,
                    ),
                    cpal::SampleFormat::I32 => input.build_input_stream(
                        &config.config(),
                        move |data: &[i32], _| {
                            consume(data.iter().map(|s| *s as f32 / 2147483648.).collect())
                        },
                        on_error,
                        None,
                    ),
                    cpal::SampleFormat::U16 => input.build_input_stream(
                        &config.config(),
                        move |data: &[u16], _| {
                            consume(data.iter().map(|s| (*s as f32 - 32768.) / 32768.).collect())
                        },
                        on_error,
                        None,
                    ),
                    _ => return Err(crate::localization::message("native.unsupported_audio")),
                }
                .map_err(err)?;
                stream.play().map_err(err)?;
                Ok((stream, rate))
            })();
            match setup {
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                }
                Ok((stream, rate)) => {
                    let _ = ready_tx.send(Ok(rate));
                    if let Ok(Command::Stop(reply)) = receiver.recv() {
                        drop(stream);
                        let result = (|| {
                            let data = worker_buffer.lock().map_err(err)?.clone();
                            let duration = data.len() as f64 / rate as f64;
                            let samples = resample(&data, rate, 16000)?;
                            let captured = Captured::new(samples, path, duration);
                            write_wav(&captured.path, &captured.samples)?;
                            Ok(captured)
                        })();
                        let _ = reply.send(result);
                    }
                }
            }
        });
        let rate = ready_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(err)??;
        Ok(Self {
            sender,
            paused,
            buffer,
            rate,
        })
    }
    pub fn stop(self) -> Result<Captured, String> {
        let (tx, rx) = mpsc::channel();
        self.sender.send(Command::Stop(tx)).map_err(err)?;
        rx.recv_timeout(Duration::from_secs(30)).map_err(err)?
    }
    pub fn cancel(self) {
        let _ = self.sender.send(Command::Cancel);
    }
}
pub fn resample(samples: &[f32], from: u32, to: u32) -> Result<Vec<f32>, String> {
    if from == to {
        return Ok(samples.to_vec());
    }
    if samples.is_empty() {
        return Ok(vec![]);
    }
    let mut rs = FftFixedInOut::<f32>::new(from as usize, to as usize, 1024, 1).map_err(err)?;
    let chunk = rs.input_frames_next();
    let delay = rs.output_delay();
    let mut output = Vec::new();
    for data in samples.chunks(chunk) {
        let mut block = data.to_vec();
        block.resize(chunk, 0.);
        output.extend(rs.process(&[block], None).map_err(err)?.remove(0));
    }
    output.extend(rs.process(&[vec![0.; chunk]], None).map_err(err)?.remove(0));
    let count = (samples.len() as f64 * to as f64 / from as f64).round() as usize;
    Ok(output.into_iter().skip(delay).take(count).collect())
}
pub fn write_wav(path: &Path, samples: &[f32]) -> Result<(), String> {
    let mut writer = hound::WavWriter::create(
        path,
        hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        },
    )
    .map_err(err)?;
    for value in samples {
        writer
            .write_sample((value.clamp(-1., 1.) * 32767.) as i16)
            .map_err(err)?;
    }
    writer.finalize().map_err(err)
}
pub fn decode(path: &Path) -> Result<Vec<f32>, String> {
    use symphonia::core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
        io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    };
    let file = std::fs::File::open(path).map_err(err)?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }
    let mut probe = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(err)?;
    let track = probe
        .format
        .default_track()
        .ok_or_else(|| crate::localization::message("native.no_audio_track"))?;
    let id = track.id;
    let mut rate = track.codec_params.sample_rate.unwrap_or(16000);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(err)?;
    let mut samples = vec![];
    loop {
        let packet = match probe.format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(err(e)),
        };
        if packet.track_id() != id {
            continue;
        }
        let decoded = decoder.decode(&packet).map_err(err)?;
        rate = decoded.spec().rate;
        let channels = decoded.spec().channels.count();
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buffer.copy_interleaved_ref(decoded);
        samples.extend(
            buffer
                .samples()
                .chunks(channels)
                .map(|v| v.iter().sum::<f32>() / channels as f32),
        );
        if samples.len() > rate as usize * 14400 {
            return Err("Audio files must be shorter than four hours".into());
        }
    }
    resample(&samples, rate, 16000)
}

#[cfg(test)]
mod capture_tests {
    use super::*;

    #[test]
    fn empty_and_subframe_dictations_are_discarded_before_recognition() {
        for count in [0, 171, 319] {
            let path = std::env::temp_dir().join(format!("notype-short-{}.wav", uuid::Uuid::new_v4()));
            let samples = vec![0.25; count];
            write_wav(&path, &samples).unwrap();
            let captured = Captured::new(decode(&path).unwrap(), path.clone(), count as f64 / 16000.);
            assert!(captured.into_dictation().is_none());
            assert!(!path.exists(), "Discarded captures must not leave orphan WAVs");
        }
    }

    #[test]
    fn nonempty_dictation_keeps_audio_only_until_recognition_finishes() {
        for count in [320, 16000] {
            let path = std::env::temp_dir().join(format!("notype-capture-{}.wav", uuid::Uuid::new_v4()));
            let samples: Vec<_> = (0..count).map(|i| (i as f32 * 0.1).sin() * 0.25).collect();
            write_wav(&path, &samples).unwrap();
            let captured = Captured::new(decode(&path).unwrap(), path.clone(), count as f64 / 16000.).into_dictation().expect("A full analysis frame must be preserved");
            assert_eq!(captured.samples.len(), count);
            assert_eq!(captured.duration, count as f64 / 16000.);
            assert_eq!(captured.path, path);
            assert!(path.exists());
            drop(captured);
            assert!(!path.exists());
        }
    }
}

#[cfg(test)]
mod input_tests {
    use super::*;
    fn catalog() -> InputCatalog {
        InputCatalog {
            devices: vec![
                Device {
                    id: "Built-in".into(),
                    name: "Built-in".into(),
                    default: true,
                },
                Device {
                    id: "USB".into(),
                    name: "USB".into(),
                    default: false,
                },
            ],
            blocked: vec!["AirPods".into(), "iPhone".into()],
        }
    }
    #[test]
    fn automatic_and_unsafe_saved_inputs_use_safe_default() {
        let catalog = catalog();
        for requested in ["", "AirPods", "iPhone"] {
            assert_eq!(catalog.resolve(requested).unwrap(), "Built-in");
        }
    }
    #[test]
    fn explicit_wired_input_is_preserved() {
        assert_eq!(catalog().resolve("USB").unwrap(), "USB");
    }
    #[test]
    fn disconnected_explicit_input_is_reported() {
        assert!(catalog().resolve("Disconnected USB").is_err());
    }
    #[test]
    fn no_safe_input_fails_before_opening_a_wireless_stream() {
        let catalog = InputCatalog {
            devices: vec![],
            blocked: vec!["AirPods".into()],
        };
        assert!(catalog.resolve("").is_err());
        assert!(catalog.resolve("AirPods").is_err());
    }
}
