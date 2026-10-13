fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-changed=tauri.dev.conf.json");
    println!("cargo:rerun-if-changed=icons-dev/icon.icns");
    let developer = std::env::var_os("CARGO_FEATURE_DEV_CHANNEL").is_some();
    let config: serde_json::Value = serde_json::from_str(include_str!("tauri.dev.conf.json")).unwrap();
    let version = if developer { config["version"].as_str().unwrap().to_owned() } else { std::env::var("CARGO_PKG_VERSION").unwrap() };
    println!("cargo:rustc-env=NO_TYPE_APP_VERSION={version}");
    cc::Build::new().cpp(true).std("c++17")
        .file("../native/SpeechOnnx.cpp").include("speech-runtime/include")
        .flag_if_supported("-fvisibility=hidden").compile("no_type_speech_onnx");
    println!("cargo:rustc-link-search=native={}/speech-runtime/lib",std::env::var("CARGO_MANIFEST_DIR").unwrap());
    for library in ["sherpa-onnx-c-api","sherpa-onnx-core","kaldi-decoder-core","sherpa-onnx-kaldifst-core","sherpa-onnx-fstfar","sherpa-onnx-fst","kaldi-native-fbank-core","kissfft-float","onnxruntime","ssentencepiece_core"] {
        println!("cargo:rustc-link-lib=static={library}");
    }
    println!("cargo:rerun-if-changed=../native/SpeechOnnx.cpp");
    println!("cargo:rerun-if-changed=speech-runtime/build.json");
    println!("cargo:rerun-if-changed=speech-runtime/include/c-api.h");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("../native/CloudPanel.m")
            .flag("-fno-objc-arc")
            .compile("no_tipe_cloud_panel");
        cc::Build::new()
            .file("../native/Permissions.m")
            .file("../native/Paste.m")
            .file("../native/Media.m")
            .file("../native/AudioDevices.m")
            .file("../native/ApplicationIcon.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("no_tipe_permissions");
        for framework in ["AppKit", "AVFoundation", "ApplicationServices", "CoreAudio"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rerun-if-changed=../native/Permissions.m");
        println!("cargo:rerun-if-changed=../native/CloudPanel.m");
        println!("cargo:rerun-if-changed=../native/Paste.m");
        println!("cargo:rerun-if-changed=../native/Media.m");
        println!("cargo:rerun-if-changed=../native/AudioDevices.m");
        println!("cargo:rerun-if-changed=../native/ApplicationIcon.m");
        println!("cargo:rerun-if-changed=icons/icon.icns");
    }
    tauri_build::build()
}
