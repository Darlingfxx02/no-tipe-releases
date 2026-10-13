#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if let Some(code) = no_tipe_desktop::whisper_benchmark_command(&std::env::args().collect::<Vec<_>>()) {
        std::process::exit(code);
    }
    no_tipe_desktop::run();
}
