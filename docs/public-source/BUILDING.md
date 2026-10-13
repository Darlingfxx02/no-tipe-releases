# Build No Type from source

The current application is in `CrossPlatform/`: React and TypeScript for the
interface, Rust and Tauri 2 for the application, and small native OS adapters.
`NoTipe/Resources/CloudRecorder/CloudRecorder.html` is the shared recorder source.
The GigaAM Swift file in `NoTipe/Transcription/` is a numerical-test reference.

## Prerequisites

Use Node.js 24 with npm, a current stable Rust toolchain, Python 3, CMake and Git.
The first build downloads pinned speech and text runtimes and verifies their
checksums. Model weights are downloaded separately when selected in the app.

On macOS, install Xcode command-line tools and use macOS 13 or later. On Windows,
install Visual Studio 2022 C++ build tools, LLVM (including libclang), and the
Windows SDK. Windows builds target x64; local Whisper requires AVX2. The build
script prepares its pinned Vulkan SDK without installing system drivers.

## Checks and frontend development

```sh
cd CrossPlatform
npm ci
npm test
npx tsc --noEmit
npm run dev
```

The browser preview is an interface preview. Recording, preference persistence,
Keychain access and other native features require the desktop application.

## Desktop build

Prepare the native adapters, then build with your own signing configuration.
Official signing credentials are not part of this repository. An unsigned local
build must disable updater artifact generation.

macOS (ad-hoc signing):

```sh
npm run prepare:native
npm run tauri -- build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}}}' -- --locked
```

Windows (PowerShell):

```powershell
npm run prepare:native
'{"bundle":{"createUpdaterArtifacts":false}}' | Set-Content -Encoding utf8 local-build.json
npm run tauri -- build --bundles nsis --config local-build.json -- --locked
Remove-Item local-build.json
```

Use a separate application identifier, product name and data namespace for your
own distribution. The official stable updater reads signed packages from this
repository; forks should configure their own channel and updater public key.
The public keys included in source verify official updates and cannot sign them.

Build output is under `CrossPlatform/src-tauri/target/`. Generated runtimes,
models, installers and application bundles are not committed. Apache 2.0 applies
to No Type's original code; retain LICENSE, NOTICE and dependency notices when
redistributing. See THIRD-PARTY-NOTICES.md for bundled third-party components.
