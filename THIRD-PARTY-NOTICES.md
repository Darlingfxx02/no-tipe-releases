# Third-party notices

No Tipe's original application code is proprietary, copyright 2026 Darlingfxx02. Third-party packages retain their own license and copyright notices; No Tipe's proprietary notice does not replace or restrict their licenses.

The private source repository is `Darlingfxx02/no-tipe`. The separate public release repository is `Darlingfxx02/no-tipe-releases` and contains no application source.

The earlier native implementation uses whisper.cpp, FluidAudio, Sparkle, KeyboardShortcuts, LaunchAtLogin, MediaRemoteAdapter, Zip, SelectedTextKit and Swift Atomics. Preserve each dependency's own license and copyright notice.

The current app retains the bundled media adapter's notice in `CrossPlatform/native/mediaremote-adapter/NOTICE.txt` and `CrossPlatform/src-tauri/platform/MediaRemote-NOTICE.txt`. Dependency source URLs identify those third-party packages; they are not No Tipe's repository or update destination.

Each production build generates `CrossPlatform/public/THIRD-PARTY-LICENSES.txt` from the locked runtime Rust and JavaScript dependency graph and original package license files. This generated notice, the Inter font license, the media adapter notice and No Tipe's proprietary license are included in the application. JavaScript legal comments remain present after obfuscation.

Mode icons use eight original Iconsax Linear SVGs by Vuesax / Lusaxweb, bundled within the application. Their source revision and original usage notice are preserved in `CrossPlatform/public/assets/mode-icons/LICENSE.txt` and included in the generated third-party licenses. Iconsax retains ownership of its artwork.

- The bundled local text engine uses llama.cpp v0.5.0 (MIT), with original notices in `local-text/llama.cpp-LICENSE.txt` and the bundled third-party license list. No Tipe manages this runtime; no separate Ollama installation is required.
- Windows Whisper uses the Khronos Vulkan Loader and Vulkan Headers from SDK 1.4.321.0. Their original Apache 2.0/MIT notices, including the loader's MIT-licensed cJSON and JSON helpers, are preserved in `Vulkan-NOTICES.txt` and the bundled third-party license list. The SDK build tools are not distributed with the app.
- The Qwen3.5 text model catalog uses Apache 2.0 model weights from Qwen, quantized as GGUF by Unsloth. Weights are downloaded separately and verified against pinned SHA-256 checksums. The original Qwen license is included in `Qwen-LICENSE.txt`. Custom imported models retain their respective licenses.
- Local NVIDIA Parakeet recognition uses the ASR-only sherpa-onnx 1.13.8 runtime (Apache 2.0) and ONNX Runtime (MIT), with original dependency notices in `speech-runtime/sherpa-onnx-NOTICES.txt` and the generated third-party license list. Parakeet v3 weights are downloaded separately from the pinned sherpa-onnx conversion of `nvidia/parakeet-tdt-0.6b-v3` and retain NVIDIA's CC BY 4.0 model license. GigaAM v3 is developed by Sber / Salute and retains its MIT model license; its CoreML conversion is downloaded separately. These models are not No Type's proprietary work.
