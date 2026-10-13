use std::path::Path;

/// An explicit support/build command; normal startup never reads these files.
/// No application database, settings, credentials or windows are initialized.
pub fn command(arguments: &[String]) -> Option<i32> {
    if arguments.get(1).map(String::as_str) != Some("--whisper-benchmark") { return None; }
    let result = (|| -> Result<(), String> {
        if !(arguments.len() == 5 || (arguments.len() == 6 && arguments[5] == "--cpu")) {
            return Err("Usage: --whisper-benchmark MODEL AUDIO NEW_REPORT.json [--cpu]".into());
        }
        let model = Path::new(&arguments[2]);
        let audio = Path::new(&arguments[3]);
        let output = Path::new(&arguments[4]);
        if !model.is_file() || !audio.is_file() { return Err("The model and audio must exist".into()); }
        if output.exists() { return Err("The benchmark report must be a new file".into()); }
        let report = crate::providers::benchmark_whisper(model, audio, arguments.len() == 6)?;
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(output).map_err(|e|e.to_string())?;
        serde_json::to_writer_pretty(&mut file, &report).map_err(|e|e.to_string())?;
        Ok(())
    })();
    Some(match result { Ok(()) => 0, Err(error) => { eprintln!("Whisper benchmark failed: {error}"); 1 } })
}
