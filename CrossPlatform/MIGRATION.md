# No Tipe desktop migration

The user chose a full macOS + Windows migration on 2026-09-29. The existing Swift application remains the reference and working installation until the replacement is verified.

## Target architecture

- One React/TypeScript interface, including the dashboard from Figma `152:5866`, sidebar, settings and recorder controls.
- Tauri 2 desktop host and a shared Rust domain layer for storage, preferences, dictation sessions, processing, models and history.
- Narrow OS adapters for audio devices, global hotkeys, focus/paste evidence, clipboard, tray and window behavior.
- Reuse the existing WebGL cloud renderer and its transitions; bridge events rather than creating a second shader.
- Versioned SQLite storage, OS credential storage, an explicit import path from the Swift application's data. Do not overwrite its databases or expose credentials to the frontend.
- macOS Apple Silicon and Windows x64 build targets. Apple-only inference providers need explicit platform capability handling; CoreML binaries cannot be treated as Windows-compatible models.

## Completion gates

- [ ] Shared application shell and faithful new dashboard with live data.
- [ ] History, statistics, modes, dictionary and word replacements.
- [ ] Audio-device selection; record, pause, stop and cancel.
- [ ] Cloud transcription and processing providers with retained configuration.
- [ ] Local inference and model lifecycle with clear per-platform support.
- [ ] Existing cloud, voice response, completion/copy/error states and preferences.
- [ ] Global shortcuts, tray, paste verification and clipboard fallback.
- [ ] Settings, backup/import/export, retention, permissions and diagnostics.
- [ ] Migration of existing history and settings, preserving the old stores.
- [ ] macOS signed build and native interaction checks.
- [ ] Windows build and Windows-specific integration checks.

## Source audit

Current application: 320 Swift files, SwiftData storage, 11 cloud transcription provider adapters, native Whisper/FluidAudio/Apple/GigaAM inference, and a bundled WebKit recorder renderer. The shader already has a native bridge (`Scripts/cloud-recorder-bridge.js`, `CloudWindowManager.swift`). Paste delivery distinguishes verified insertion, clipboard-only delivery and failure; partial processing failures retain the original dictated text.

Figma assets are downloaded locally in `NoTipe/Assets.xcassets/cloud-nav-*.imageset`. The wave PNG is an exact local copy of the actual shader capture. The pixel logo source is `DesignAssets/no-tipe-microled-logo.svg`.

## References

- https://v2.tauri.app/concept/architecture/
- https://v2.tauri.app/reference/webview-versions/
- https://v2.tauri.app/develop/sidecar/
- https://v2.tauri.app/distribute/windows-installer/


## Verification checkpoint — 2026-09-30

This is a working migration build, not a completed replacement of the Swift application. The macOS build is installed separately as `/Applications/No Tipe.app` and signed with the existing Apple Development identity. It has not been notarized. The original No Tipe application and databases are unchanged.

### Implemented and checked in this pass

- Settings use four top tabs (General, Dictation, Appearance, Data), with Permissions in General and shortcut/audio/processing/delivery in Dictation. They use simple label/control rows, immediate switches/selects, and text/number commits on blur or Enter. Escape reverts an unfinished edit. No Save button is added for ordinary preference edits. Capture of a shortcut changes only the button contents; no transient instruction expands the row.
- Preference writes are serialized. Rapid edits to different settings survive both successful writes and a failure in another field. Inline validation handles invalid text/numbers.
- Primary shortcut capture supports physical keys independent of keyboard layout, side-specific macOS modifiers, release to apply, Escape/blur to cancel, reserved combination rejection, and restoration of the existing binding after capture. Right Option was saved in the native app. Other native input combinations still need broader verification.
- Permission onboarding and the Permissions section in General report microphone/accessibility independently. The microphone request belongs to the main signed process. Changing a code-signing identity can require the user to grant access to the new identity once.
- The native cloud was visually observed rendering a Siri wave. Its shader source matches the approved prototype. Startup snapshot delivery waits for listeners; the preview accepts the current preferences directly. Exact palette swatches and disabled palette selection in chromatic mode now match the renderer. macOS presentation uses the screen under the pointer and a non-activating floating window.
- Cloud processing toggles override legacy mode enhancement/translation options while retaining the mode's provider/model. Retry uses the same provider resolution. Time saved uses total words and recording duration.
- `npm test`: 5 passing tests. `cargo test --lib`: 12 passing tests. TypeScript/Vite and signed debug macOS bundle build passed. Signature verification passed. Windows build/runtime verification remains pending.

### Remaining parity work before a full migration release

- Real-time transcription and all local engines: Parakeet and Apple-native engines are not yet implemented in the shared host; GigaAM remains macOS-only.
- Mode-specific and secondary global shortcuts, global cancellation, ordered handling of press/release around a slow microphone start, and shortcut reconfiguration after imports.
- App/URL/trigger-word mode activation parity; selected-text context; word replacement boundaries, case handling and comma-separated variants.
- Recording sounds/media behavior, audio-device disconnect recovery, and freezing resolved configuration for a recording session.
- Metrics for a session cancelled during enhancement, runtime preference resynchronization after imports, and complete primary-shortcut migration.
- Windows packaging, clipboard format preservation, verified insertion and real hardware hotkey/audio tests.

### Settings pattern reference

The official Codex settings reference documents category organization and the settings keyboard shortcut: https://learn.chatgpt.com/docs/reference/settings.md . Native Codex inspection was unavailable because Computer Use disallows control of that application. The simpler control rows, commit-on-blur behavior and removal of extra Save buttons are the implementation of the user's requested interaction model, not a claim of a pixel-exact inspection of Codex.


### Settings component fidelity — 2026-09-30

Settings components now use the explicitly supplied Figma C04 / Linear library (`91:1096`), while retaining the user's four top tabs and autosave behavior. References: Button `92:1311`, Select `92:1331`, Toggle `92:1348`, Keycap `92:1349`, Setting row `92:1432`. `src/settings.css` scopes these tokens to settings: bundled Inter 13/20 labels, 12/16 descriptions, 15/23 section headings, 24/32 title; 30 px controls with 8 px radius; 24 px keycaps; 56/66 px row densities. Original exported toggle states (30×20) and chevron (16×16) are bundled locally. No temporary Figma asset URLs are used at runtime. Browser geometry checks matched these sizes, all four tabs were inspected, and resource/error logs were clear. The dashboard shell and recorder shader remain outside this styling change.


### Dropdowns and verified macOS paste — 2026-09-30

- Removed the main-panel gutter and outline only at the sidebar junction. Per the final correction, outer insets remain 6 px at the top, bottom and right, with 12 px inner corners on all four sides (18 px shell radius minus the inset). The left inset remains zero. Content retains its internal spacing.
- All application selects use a shared Radix Select wrapper. The reference was inspected live in Linear Preferences (First day of week): selected-item alignment, neutral hover, trailing check, scrolling and keyboard navigation. Empty values remain valid for system/default choices. Escape closes only the menu inside a dialog. Pointer opening does not show an indigo focus ring; keyboard focus remains visible in neutral gray.
- macOS target capture, Cmd+V delivery and verification now execute in the main signed process (`native/Paste.m`), the same identity that requests Accessibility. The Swift helper only performs model inference. Capture requests Electron/Chromium AX exposure, rejects secure/non-editable fields and retains target identity. Delivery waits for modifier release, reads a fresh baseline, and verifies the actual field change before returning `inserted`. Clipboard restoration and auto-send run only after verified insertion. Focus loss and unreadable results remain clipboard-only; no duplicate retry paste is sent.
- The main app reports the missing Accessibility permission when it falls back to copying. Eleven native evidence checks pass, including selected replacement, identical replacement, unrelated edits, unavailable evidence, Unicode and CRLF. Existing five frontend and twelve Rust tests pass; signed macOS bundle and strict signature verification pass.
- At installation, Microphone was Allowed and Accessibility was Not allowed. Live cross-application paste verification is pending the user's grant; passing evidence tests does not prove OS insertion without that permission. Windows insertion behavior was not changed or verified in this pass.


### Cursor display following and signing continuity — 2026-09-30

The visible recorder now follows the display containing the pointer, rather than choosing a display only when first shown. macOS positioning and hit testing share native Cocoa point coordinates, avoiding the current Tao cursor/monitor coordinate mismatch on mixed-scale displays. Position changes use the display's visible frame, preserve the existing cloud/WebGL instance and never focus another application. The hidden recorder does no relocation work. Windows uses the cursor monitor's work area and destination scale; its hardware verification remains pending.

Three Cocoa placement checks and three shared physical-coordinate checks pass (dock inset, negative desktop origins, destination scale). `tauri.conf.json` now pins the existing Apple Development signing identity even for builds without an explicit environment override. Current installed and rebuilt bundles have the same certificate-based designated requirement. The user reports that System Settings already shows the switch enabled while the current process reports false; an earlier-signature TCC record is a hypothesis, not verified from the protected database. No TCC database modifications, global permission reset or permission bypass were performed. A one-time off/on regrant for the installed No Tipe Next may still be required.


### Responsive keyboard dashboard — 2026-09-30

- Implemented Figma `229:11170` as native React/CSS content. The keyboard keeps proportional keys, gaps, radii, type and key travel. Its 1920 px baseline is 996 px wide; it eases down to the 800 px transcript column by a 1440 px expanded-sidebar window, then fits available space. View Insights navigates, NoType starts/stops dictation and reflects the recording state, and GitHub opens the existing project URL.
- The dashboard edge effect uses the recorder's actual spectral fragment shader, wave tuning, voice response and theme palettes, extracted by `scripts/build-cloud.mjs` into `src/generated/cloudWave.json`. Edge coordinates are adapted in `DashboardWave.tsx`; no generated artwork or screenshot substitutes for the live effect. Audio comes from the existing native `cloud-audio` event, without a second microphone capture. Chromatic mode keeps the panel neutral. Render resources are released on leaving Dashboard; reduced-motion and context restoration are handled.
- Native presentation policy hides the single floating cloud while the main Dashboard is focused, visible and not minimized. Navigation, focus changes and recording state updates re-evaluate visibility without resetting the session. The new persisted `alwaysShowCloud` preference defaults to true for existing users; turning it off hides idle cloud outside Dashboard but retains active dictation and completion states. Dialogs suspend Dashboard ownership.
- Settings, History, Modes, Transcribe, Dictionary, AI Models and Audio content are capped at 800 px. Insights and the Dashboard hero retain their wider layout. Existing shell insets and all four rounded corners are preserved.
- Verification: frontend build and 5 tests pass; 18 Rust tests pass, including presentation policy and preference migration. Browser checks at approximately 1920, 1358 and 896 CSS px verified keyboard scaling, column widths, lack of horizontal overflow, sidebar collapse, Insights navigation and clean WebGL remounts. Signed macOS debug bundle installed with `ditto`, strict code-signature verification passed; native Dashboard and preference persistence inspected. NoType was exercised against the native microphone: the app entered recording and the key stayed depressed; the test was ended by quitting before processing or delivery, then the app reopened idle. Voice-response tuning and cross-app cloud visibility still need user observation on the intended microphone/displays. Windows runtime verification remains pending.

### Dashboard and settings polish — 2026-09-30

- Restored the Dashboard's Figma `229:11202` rim (1 px, rgba(166,164,216,.23)), above the wave without affecting layout. Dashboard scrolling stays available with its scrollbar fully hidden. The sidebar uses a larger-pixel NoType wordmark; keyboard action keys have trailing Insights/star icons. The shortcut hint is plain non-interactive content. NoType Pro has no destination, retains its wrapper colors, and uses the Figma three 8×16 orange bars.
- Shared `ScrollArea` hides native layout-consuming scrollbars and draws an accessible draggable overlay. Settings keep exactly 800 CSS px where space permits; browser measurements verified identical x/width on General (overflowing) and Data (not overflowing). Overlay keyboard scrolling was exercised. Switch tracks are now 40×26 inside 48×40 hit targets. Appearance preview is 252 px tall, leaving approximately 20 px above the expanded language controls and below the recorder.
- Verification: five frontend tests and production frontend build passed. Signed macOS debug bundle built, installed at `/Applications/No Tipe.app`, and strict signature verification passed. Native Dashboard visually inspected; proof at `artifacts/notype-dashboard-polish.png`.
- macOS Accessibility was restored after the user removed and re-added `/Applications/No Tipe.app` in System Settings; a simple off/on regrant and restart had not cleared the denial. Native General now reports Allowed. The status queries AXIsProcessTrusted directly, without a preference cache. No permission bypass or TCC modification was performed. The user then completed a live dictation test and confirmed that text inserted automatically into the active input. The native paste implementation was not changed in this UI pass; the verified remediation was regranting macOS access to the installed signed application.

- Final verification after another signed update: Accessibility remains Allowed. Fixed the Appearance iframe handshake for WebKit's opaque custom-scheme origins; messages remain scoped to the bundled parent and contain visual preferences/sample text only. The installed app's preview opens settings and language choices, with even top/bottom spacing and the selected Siri palette preserved.
- Follow-up logo adjustment: reduced the wordmark to a 2.4 px shared matrix pitch, centered the microphone and NoType, extended the inactive matrix across the complete gray tile, and left three or more inactive rows above/below. Final native settings proof: `artifacts/notype-settings-final.png`.

## Sidebar and media pause — 2026-09-30

- Sidebar matches the revised Figma 229:11171: equal 8 px side insets, patterned header, separator and revised menu spacing. Shortcut and Pro surfaces share the same subtle vertical gradient rim. Per the latest review, the rail is always expanded; the collapse button and experimental contour were removed. Dashboard shader mapping is unchanged from the rectangular version.
- Native macOS traffic lights use the Figma positions (20/40/60, 22) and 12 px diameter, preserving the actual AppKit buttons. Native screenshot measured the colored bounds at 2×: (40,44)–(64,68), (80,44)–(104,68), (120,44)–(144,68).
- Dictation > Microphone adds `pauseMedia`, opt-in by default and imported from legacy `isPauseMediaEnabled`. macOS sends the explicit MediaRemote Pause command; Windows pauses the active playing GSMTC session. No play/pause toggle and no automatic resume. Dispatch happens only after recording successfully starts; a finished/canceled session invalidates pending dispatch. An unavailable player does not fail dictation.
- Native macOS end-to-end check: enabled the setting, started the local test player, clicked Start dictation; the player changed from Playing to Paused. Accessibility and microphone remained Allowed after the signed update. Windows runtime verification is still pending on a Windows machine.
- Keyboard icons have 22% opacity. Key fills are clipped to the padding box so inset shadows cannot expose a bright outer fringe; the independent rim ranges from 1.2% to 6% alpha.
- Dashboard transcripts are selectable text without row hover/background/action. Copy and delete icons appear on hover or keyboard focus; deletion uses the existing confirmation pattern. Processing error details remain accessible separately.
- Validation: TypeScript/Vite build, 5 frontend tests, 19 Rust tests including media-pause preference/backup compatibility. Signed macOS debug bundle verified. Local test fixtures are under artifacts/ and are not bundled.
- Dashboard's final two bottom-right keys now navigate four live statistics: saved time, words, sessions, recording time. Left/right arrow keys wrap through the same sequence; input controls, dialogs, text selections, modifier shortcuts and repeated held keys are excluded. Browser UI validation covered clicks/Enter, arrow keys, all four labels, and wrapping in both directions.

### Mode editing, local GigaAM and processing recovery — 2026-09-30

- Modes now opens a full page editor for creating and editing instructions. Changes are debounced and serialized, flushed before navigation, and retained in memory on save failure. The page includes independent processing switches, speech and text model settings, delivery, application rules, and sample preview without recording, clipboard writes or history entries. Custom instructions now apply to normal paste modes as well as app-only results; explicit provider overrides take precedence over imported legacy values.
- Added complete GigaAM v3 CoreML asset validation and resumable downloads. The native inference helper accepts the resolved model directory rather than assuming the old application's library path. The user's existing compatible CoreML assets were copied into the new app's model directory, leaving the original intact. Type's split ONNX/ANE format was inspected but not repackaged. Two local inference checks produced the exact Russian reference sentence. This CoreML provider is macOS-only; Windows GigaAM inference is not claimed.
- The reported HTTP 404 came from an unavailable Ollama text model, not GigaAM recognition. Text processing now uses Ollama's native chat endpoint and lists installed models. Qwen3 thinking is disabled for editing. Missing models produce an actionable error. The installed app and active Оформление mode now select the existing qwen3.5:9b; the user's prompt was preserved. A native sample preview successfully removed filler words and produced edited Russian text. Original failed transcripts remain preserved and can be processed again.
- Media pause now owns a recording-scoped session and resumes only the same player/item that it paused. The earlier no-resume behavior above is superseded. macOS playback inspection uses the pinned BSD-licensed MediaRemoteAdapter already used in the original app, bundled with notices and limited output fields; explicit Pause/Play commands remain in the signed main process. Native UI checks passed Playing → Paused during recording → Playing after stop, and already Paused → recording → still Paused. Windows uses GSMTC but has not been hardware-tested in this pass.
- All central panels share the rounded outline; other pages use 7.5% opacity versus 23% on Dashboard. Layout and dimensions are unchanged.
- Validation: TypeScript/Vite build, 8 frontend tests, 29 Rust tests, signed macOS bundle, deep/strict signature verification, and native UI checks. Installed to /Applications/No Tipe.app with the existing signing identity. Proof screenshots: artifacts/notype-mode-editor-native-trimmed.png and artifacts/notype-mode-preview-native-trimmed.png.

### Full-screen recorder window eligibility — 2026-09-30

The shared macOS recorder window now sets `NSWindowCollectionBehaviorCanJoinAllApplications` alongside `CanJoinAllSpaces` and `FullScreenAuxiliary`. This opts the regular Tauri NSWindow into other apps' full-screen Spaces/Stage Manager sets rather than relying on auxiliary behavior alone. The setting applies to both island and notch renderers; Dashboard ownership, window level, click-through regions and microphone state are unchanged. macOS 13 is already the application's minimum target. The signed macOS build and native placement checks passed, and the installed app entered/exited Full Screen successfully. The available app-only screenshot does not independently prove overlay visibility above another application's full-screen window.

### Shared interface themes and panel waves (2026-09-30)

The CloudRecorder palette is now the source for interface accents as well as the island, notch and Dashboard spectral passes. Sber adds green, azure and white waves with saturated highlights. Theme color controls the primary actions, switches, selected mode accents, charts, meters, keyboard shading and subtle panel rims. Chromatic aberration retains its neutral recorder material and remains independent of the interface accent.

One persistent panel canvas runs on every main route except Insights. Entering Insights eases the wave out; leaving it reveals light from the top down both sides, with a slight inward movement. A critically damped transition preserves continuity on rapid navigation; the hidden canvas stops rendering. Reduced motion skips the entrance/exit animation. Dictation, delivery, media and shortcut behavior are unchanged.

Validation: frontend build, 8 frontend tests and 29 Rust tests passed; all eight palettes were checked in the shared component review, including chromatic color independence. Native macOS rendering was checked for the Sber island preview and Dashboard. The signed macOS app was rebuilt and installed. Visual QA files are under artifacts/theme-review.html, artifacts/theme-checks.json and artifacts/sber-dashboard-native.png.

### Panel-wave preference and responsive clearance — 2026-09-30

Appearance includes “Waves only on Dashboard”. The persisted `dashboardEffectOnly` preference defaults to false for existing users and survives backup/restore. Dashboard keeps its effect, Insights remains effect-free, and other pages follow the preference through the existing smooth shader transition. Floating recorder visibility and dictation behavior are unchanged.

When the central panel is narrower than 1136 px, an active wave reserves its actual 95–156 px edge strip plus 12 px of clearance. Top spacing grows progressively as the panel narrows. The extra spacing releases after the departing effect begins receding. Wider panels retain the centered 800 px content column and existing keyboard scaling; reduced motion disables spacing animation.

Validation: frontend build and 8 frontend tests passed; the focused Rust preference migration/backup test passed. Browser checks at 896 and 1811 CSS px verified the switch, Dashboard/Insights exceptions, 800 px wide-screen content and zero horizontal overflow. A signed macOS bundle was built and passed deep/strict signature verification. The signed bundle was installed to /Applications/No Tipe.app after Mac unlock. Native Appearance showed the new switch; enabling it removed the panel waves while retaining the recorder preview. The switch was left enabled. Visual proof: artifacts/wave-safe-spacing.png.

### Sidebar selection, Dashboard live text and recorder activation — 2026-09-30

Sidebar navigation now uses white text and icons for the active route with no background fill. Hover also has no background fill, including Settings. The Dashboard live-transcript section and its styles were removed; completed transcript history and recorder transcription remain available.

The macOS recorder now converts its own native window into a nonactivating NSPanel. The main window keeps its original class. The recorder accepts the first mouse click, cannot become a key/main window, and retains its webview, delegate, placement and click-through regions. A separate manually reference-counted native file restores the original window class before deallocation so AppKit can remove its original KVO observers safely. This replaces the earlier regular-NSWindow presentation implementation. Closing the main interface continues to preserve the running app and menu-bar icon through the existing keep-in-tray setting.

Validation: 11 frontend tests, the TypeScript/Vite build, 35 Rust tests (1 ignored), and the native cloud placement/panel lifecycle tests passed. The real app-shell browser fixture enables live transcription during a recording and confirms no live text on Dashboard; the active sidebar text/icon are white with a transparent background. Native verification closed the main window, opened the recorder controls/settings, and observed Telegram remain the foreground application without a NoType activation event. The recorder remained available during a paused recording and the running app retained one menu-bar status item. The installed and saved macOS app passed deep/strict signature verification. The saved build is Builds/20260930-sidebar-cloud/No Tipe Next.app; the previous installed build is retained beside it. Visual proof: artifacts/sidebar-dictation-after.png.


## Dictation focus and microphone routing — 2026-09-30

macOS delivery now resolves the currently focused editable field after shortcut release. The recording-time field remains only a context source. AXSelectedText is used when supported and verifiable, without touching the clipboard. Other editors receive one Cmd+V; all previous pasteboard items/formats are restored immediately after insertion is verified, before reporting completion. Verification still reads the receiving field if focus moves after insertion. Newer clipboard copies are preserved, empty results do not clear the clipboard, and an absent/unsupported field retains the manual-copy fallback. The clipboard delay setting now applies only to Windows.

The macOS input catalog reads CoreAudio transport metadata before opening a stream. Bluetooth/Bluetooth LE and wired/wireless Continuity phone inputs are excluded, including previously saved selections. Automatic selection keeps an eligible system input or falls back to the built-in/wired input. An absent eligible input fails before opening a headset/phone microphone. System input/output defaults are never changed. Aggregates and unclassified transports are excluded because they cannot establish an independent input route. Media pause remains opt-in; the installed user preference was switched off as requested.

Validation: `python3 scripts/test-native.py` passes 34 native checks (11 insertion-evidence, 12 paste-session and 11 audio-device checks), using a private pasteboard for session tests. Four Rust input-selection regressions cover automatic/unsafe saved inputs, explicit USB choice, disconnected input and no eligible input. The full Rust suite passed 39 tests with one existing model-dependent test ignored; 11 frontend tests and the TypeScript/Vite build passed. The signed debug macOS bundle passed deep/strict signature verification with the existing certificate requirement. Installed at `/Applications/No Tipe.app` with the same signing requirement. Native UI confirmed Microphone/Accessibility Allowed, only the MacBook microphone in the eligible device list, automatic input and media pause off. A short local recording started the built-in input; CoreAudio snapshots before/during/after show the same output device, transport and 48 kHz rate, and unchanged system defaults. The test recording was discarded and the application reopened idle. Route proof is in `artifacts/dictation-audio-{before,recording,after}.json`. This verifies the available built-in output route; Bluetooth headphone listening and live insertion across external editors still require observation on those devices/apps. Windows behavior was not changed.

### Subtle recorder material and light controls — 2026-09-30

Recorder material preserves the installed Type renderer’s original background gradient and face attenuation, with a small luminance-preserving theme tint. The glass bevel and the lower/side contour remain visible even at zero light. A fixed field of curved Gaussian sources adds emission through nonlinear energy curves; it never moves a light boundary or masks the base material. The same treatment applies to island and notch, where local coordinates follow the current dock, side controls and language lobes. Completion uses the full original green material tint; error retains the semantic red. Wave brightness changes emitted energy independently of material lighting and geometry. Success/error indicators remain visible when waves are hidden.

Appearance includes Recorder light (0–200%, 28% default), Wave brightness (0–200%, 35% default), Show dictation waves, and Reset light and waves. The preview updates while dragging; persistence commits on pointer release, keyboard adjustment or blur. Settings are included in live snapshots and backups, with defaults for older preferences and validation for the 0–2 range. The Swift recorder has the same controls and backup compatibility. Background waves share brightness; the dictation visibility switch affects the recorder.

The native UI controller is maintained in Scripts/cloud-recorder-controller.js. Regeneration preserves the existing transcript viewport and translation behavior. Python and cross-platform generators produce identical artifacts when rerun. The current frontend build and 14 tests, and 40 Rust tests (one fixture-dependent test ignored), passed. The existing Swift settings/backup implementation previously passed six CloudRecorderTests. Browser WebGL checks cover all eight themes, bottom-up emission at 0/28/100%, the visible lower/side contour at zero light, independent wave brightness and visibility, unchanged control geometry, notch compilation, and the green completion face and lower rim separately from the check. Native Appearance confirmed the bottom-up help text and restored material. The user’s current Siri palette, 100% light, 100% wave brightness and enabled waves were preserved. The signed macOS bundle was installed at /Applications/No Tipe.app and passed deep/strict signature verification with the same signing requirement. Evidence is in artifacts/shader-recovery/bottom-up-checks.json and bottom-up-native.png. Windows runtime verification was not performed.


### Hardware and virtual notch display support — 2026-09-30

The top recorder now shares one contour and interaction layout across displays. Hardware screens use their actual camera dimensions; flat screens use a 112 × 32 pt virtual dock with the same side controls, transcript and settings. The central virtual body finishes recording. WebGL fallback retains the virtual body and visible controls.

Native placement publishes display identity and backing scale alongside camera geometry. Pointer-based display selection retains the originating display while a mouse button is held and recovers when that display is disconnected. Flat displays are centered on the physical frame, including side-Dock configurations. Display changes clear stale notch hit regions until the renderer reports the new layout. Camera and top activation-lane exclusions remain physical-only.

Validation: 14 frontend tests, 40 Rust tests passed (one model-dependent test ignored), native monitor/geometry/hit-testing/NSPanel checks, 35 browser display/state scenarios, live-text and translation layouts, and explicit WebGL-unavailable preview. Signed macOS debug bundle installed at /Applications/No Tipe.app with deep/strict verification. Actual switching between a laptop with a camera cutout and an external display, and Windows hardware, remain unverified. Evidence: artifacts/notch-displays-20260930/.


### Stable layout when switching Insights — 2026-09-30

Panel-wave visibility now switches immediately, including the static fallback. The persistent canvas keeps its wave phase and stops rendering while hidden; returning to another page resumes the effect without an opacity entrance or exit animation. This supersedes the navigation fades described above.

Responsive shader clearance is reserved independently of visibility on every route. Hiding the effect no longer releases the side/top spacing, and showing it no longer animates the content padding. The existing wide-panel content widths remain intact.

Validation: 14 frontend tests and TypeScript/Vite build passed. Twelve browser measurements at 896, 1208 and 1811 CSS px confirmed stable side clearance, identical geometry on repeated visits, immediate visibility, working WebGL and no horizontal overflow. The signed macOS debug bundle passed deep/strict verification with the installed certificate requirement and was installed at /Applications/No Tipe.app. Native Insights and the return to Dashboard were inspected. Evidence: artifacts/insights-wave-stability/. The saved build and previous installed bundle are under Builds/20260930-insights-wave/.

### Recorder light maximum — 200%

The light slider, native bridge, shaders, validation and Swift backup clamping accept 0–200%. The light response now uses fixed curved sources and nonlinear energy curves over the entire 0–200% range, with the base material intact. Wave brightness independently accepts the same 0–200% range. The 200% boundary roundtrips through Rust backups and Swift preferences, and browser pixel checks verify additional light above 100%. Frontend build and 14 tests, the targeted Rust preferences test, six Swift CloudRecorderTests and 29 WebGL checks passed. The signed update was installed with the same signing requirement. The Mac was locked during installation, so native restart and inspection remain pending; the existing running process was preserved.


### Simplified Transcribe workspace — 2026-09-30

The React Transcribe screen now places one upload area directly on the page, with a compact model/language summary above it. Selecting a file replaces the upload area with a flat file/action row; completed text appears on the page with Copy text, duration, word count and a saved-to-history status. Active mode model/language overrides are reflected in the summary. Recognition and processing errors retain retry/original-text behavior. Native Tauri drag/drop is wired to the same single-file selection path as the picker, with explicit feedback for unsupported or multiple files and listener cleanup on navigation.

Mobbin references: Mistral AI https://mobbin.com/screens/5d20ce16-a72c-4263-8a59-143ae60e8550 and Descript https://mobbin.com/screens/84c24de9-9e8c-4183-8bdc-d07ff8d18214.

Validation: 14 existing frontend tests, TypeScript/Vite build and signed macOS debug bundle passed. Browser checks at observed 896/1208 CSS px confirm no nested panels, no horizontal overflow, picker cancellation, long filenames, processing/recognition failures, copied delivered text, drag/drop validation and listener cleanup. The development-only fixture simulates Tauri commands/events; it does not verify OS file picking, native dragging or actual recognition. The Mac was locked during this pass, so native visual inspection remains pending. The update is installed at /Applications/No Tipe.app with the same signing requirement. The already running process was preserved; restart applies the new screen. Saved/previous bundles: Builds/20260930-transcribe-195738/. Evidence: artifacts/transcribe-redesign-20260930/.


## Browser dictation delivery — 2026-09-30

macOS delivery now queries focus within the foreground application and resolves a unique editable descendant of a focused wrapper. Explicit nested focus takes priority; ambiguous, disabled, read-only and secure fields are excluded. The field is still captured at insertion time after shortcut release.

Web editors are identified by their AXWebArea ancestor and receive one normal Cmd+V instead of AXSelectedText. Browser accessibility can advertise a writable selection without committing that change to the editor. Native editable fields keep direct insertion when it is verifiable. Keyboard delivery now includes explicit Command-down and Command-up events from a private event source, ending with cleared modifier flags. Waiting for shortcut release checks the actual left/right modifier keys instead of aggregate flags, which can retain a synthesized Command state. Clipboard restoration still requires verified insertion; newer copies are preserved.

Validation: 63 macOS native checks pass (11 insertion-evidence, 14 paste-session, 15 focus/web detection, 12 keyboard-event, 11 audio-route checks), with no real keyboard events posted by tests and a private pasteboard for session checks. Fourteen frontend tests and the TypeScript/Vite build pass. The signed debug bundle was saved to Builds/20260930-input-delivery-fix/No Tipe Next.app, installed at /Applications/No Tipe.app with the existing certificate requirement, and reopened. TextEdit direct insertion and a Dia Cmd+V insertion were verified during diagnosis. The user subsequently reported that live browser dictation still only copies to the clipboard; this fix is not confirmed. Temporary diagnostic commands, buttons and target activation hooks were removed. Evidence and the prior source files are in artifacts/input-delivery-fix-20260930.

Follow-up investigation: the application now retains the last delivery's result, reason, foreground app identifier, editor role, Accessibility status, modifier key state and delivery phase in the local `lastDelivery` metadata entry. It records no dictated text, field values, selected text, clipboard contents, window titles or URLs. The active mode was verified to use paste output with auto-send disabled. Native checks and the signed debug build passed. The running installed executable contains revision `delivery-20260930-2`; a new real browser dictation is required to capture the failing phase. Source snapshots are in artifacts/input-delivery-investigation-20260930/before.

The recorded failure at 21:49 Moscow time resolved an AXTextArea in Codex with Accessibility allowed, a readable baseline and known selection, and no held modifiers. Its AX tree was classified as non-web. AXSelectedText returned success, but verification observed no insertion and no paste shortcut was posted. Revision `delivery-20260930-3` removes direct AXSelectedText delivery for all editors. Every eligible current field receives one normal Cmd+V, followed by the existing verification and clipboard restoration. AXWebArea ancestry is now diagnostic metadata only, so an embedded web editor with an incomplete AX tree takes the same delivery path.

Validation: 65 native checks pass, including the silent no-op setter without AXWebArea, original clipboard formats, focus changes, newer copies, and an ignored paste that is never retried. Concurrent unfinished Insights and file-transcription changes prevented a whole-workspace build. The signed update was therefore built in an isolated source copy using the last successful frontend and preceding file-transcription sources, without rewriting those shared sources. The bundle was saved to Builds/20260930-paste-command/No Tipe.app, installed at /Applications/No Tipe.app with the same signing requirement, verified byte-for-byte, and reopened idle. The previous installed bundles are archived alongside it. Live confirmation of revision 3 is pending; reason-only evidence and build inputs are in artifacts/input-paste-command-20260930.


### Concise transcription copy — 2026-09-30

Removed the Transcribe subtitle, upload explanation, automatic-history reminder and duplicate file-status text. Model/language/mode labels use compact values with full hover descriptions; supported formats are in the upload caption tooltip. Visible actions are Choose file, Replace, Transcribe, New file and Copy, retaining their descriptive accessibility names. Completion has one Saved status rather than a duplicate toast. Empty-screen visible text was reduced from 44 to 12 whitespace-separated words in the browser preview.

TypeScript/Vite and signed macOS debug bundle passed, and the installed build passed deep/strict signature verification with the same signing requirement. Browser empty/selected/working/result states were inspected with the existing development-only Tauri fixture. Dictation was active in the native app during inspection, so the running process was preserved; the new screen applies after restart. Evidence: artifacts/transcribe-copy-20260930/. Saved/previous builds: Builds/20260930-transcribe-copy-213813/.


### Curved material and wave brightness up to 200%

The shared fixed Gaussian field replaces the moving cutoff in both island and notch. Twenty-four expanded-menu GPU checks verify smooth monotonic profiles throughout 0–200%, a stationary lower source and a continuous response through 100%. Wave brightness now independently accepts 0–200% in both settings UIs, the native bridge, Rust validation and Swift backup clamping. The existing response below 100% is preserved; extra wave energy above 100% passes through the shared soft limiter. Thirty-two GPU checks passed, including stronger waves at 200% in island and notch without white clipping. Frontend build and 14 tests, the Rust preference/backup boundary test and six Swift CloudRecorderTests passed. The signed macOS update was installed and restarted with the same signing requirement; installed executable bytes match the built bundle. Evidence: artifacts/shader-recovery/curved-light-checks.json and wave-200-checks.json.


### Normalized wave brightness maximum

Wave brightness now displays 0–100%, with full scale mapped to renderer energy 4.0, twice the preceding maximum of 2.0. Former 200% equals new 50%. Only the displayed scale changes for existing settings: preference and backup values retain their energy units, including the original 0.35 default. The backend, native bridge and shared wave shader accept up to 4.0; both React and SwiftUI normalize their percentage labels. Recorder material light remains 0–200%. Actual Settings UI checks confirm that the upper slider endpoint displays 100% and commits energy 4.0; 32 GPU checks verify extra wave light in island and notch, soft highlights, independent visibility and intact material. The Rust preference/backup boundary test, six Swift CloudRecorderTests and 15 frontend tests passed. Evidence: artifacts/shader-recovery/wave-normalized-ui-checks.json, wave-normalized-checks.json and wave-normalized-settings.png.


### No Tipe identity — 2026-09-30

The application display name is No Tipe across the sidebar, dashboard key, Pro label, system menus, recorder title, permission descriptions, onboarding, help copy, localization catalogs, diagnostics and export filenames. The F key is replaced by a five-stroke voice waveform. Editable SVG sources generate the macOS/Windows application icons, monochrome macOS template tray icon, favicon and Swift asset catalog with `npm run prepare:brand`. Seventy-four branded localization keys were updated without changing the number of catalog entries.

The bundle identifier, database format, storage paths, Keychain services and legacy import paths remain compatible. New NO_TIPE_* command variables are available while existing NOTIPE_* runtime aliases continue to work. The signed app is installed at /Applications/No Tipe.app, with the prior application saved under Builds/20260930-no-tipe. The login item now targets the new path. A compatibility alias at the previous application path supports existing shortcuts.

Validation: 40 Rust tests passed (one local-model fixture test ignored), 15 current frontend tests passed, all 320 Swift source files passed syntax parsing, and both localization catalogs passed duplicate-key validation. The last successful frontend distribution was checked across all eight main sections and all four settings tabs. A signed macOS bundle was produced and passed deep/strict signature verification with the original certificate requirement; its installed icon/executable matched the built bundle. The active dictation was preserved through installation. After it ended, the application was reopened at the new path; the native window, sidebar mark and application menu visibly show No Tipe, with the library and preferences retained.

Concurrent work on Insights currently references an incomplete stylesheet, so the final bundle uses the last successful frontend distribution. A subsequent integrated build should include that screen once its parallel implementation is complete. Full Swift Xcode tests were unavailable because the active developer installation contains Command Line Tools only. Evidence is in CrossPlatform/artifacts/rebrand-notipe-20260930.

The signed macOS bundle was installed at /Applications/No Tipe.app and restarted. Its signing requirement is unchanged and installed executable bytes match the verified bundle. Native Appearance confirmed that the existing energy 2.0 is now shown as 50%, with the Sber theme, 47% material light and wave visibility preserved. Native evidence: artifacts/shader-recovery/wave-normalized-native.png.


### 2026-09-30 — File transcription settings

The Transcribe screen exposes only speech model, language and processing level (None, Light, Full). Its Settings action opens a separate Transcription settings page with progressive text, output style, saved modes/custom rules, translation and text service/model/endpoint. These file settings persist locally and do not change dictation preferences. None keeps recognized text; Light corrects punctuation and grammar without custom rules or translation; Full applies configured rules and translation.

File processing can publish partial text and translations, preserves the source and saves results to history. Whisper publishes recognized segments; other services publish completed 24-second chunks with two seconds of overlap. Final formatting runs on the complete transcript. Verification covered the three main controls, page navigation, settings persistence, per-request progress, cancellation and mocked translation alongside real local GigaAM recognition of synthetic speech.


### Insights and concise copy — 2026-09-30

Studied Wispr Flow through Mobbin (https://mobbin.com/flows/aeb81b1d-124c-49d5-9e41-ce40acc34a33) and its desktop Usage documentation. Insights now includes weighted recent dictation speed, typing-time comparison, period changes, metric-selectable activity, a responsive daily calendar, streaks, word milestones and local summary copying. Periods use half-open local-day ranges, comparisons end at the same time of day, all-time charts preserve the full recorded range, and cancelled requests cannot replace a newer period. Missing or failed data stays distinct from real zeros. Statistics survive history deletion; imported audio contributes to totals.

Following copy review, removed the subtitle, motivational phrases, default chart total, repeated session total, model count, average session caption, typing benchmark caption, speed sample caption, milestone explanation and local-storage footer. Visible copy uses metric labels, values and compact controls; formulas, date details and comparison context remain on demand. Cards and chart spacing were reduced.

Validation: 69 frontend tests and TypeScript/Vite build passed. Earlier metrics validation passed 50 Rust tests with two fixture-dependent tests ignored. The signed macOS debug bundle passed deep/strict verification and was installed with the same designated requirement, preserving the prior bundle under Builds/20260930-insights-copy/. Browser checks covered 950px and wide layouts, empty data, formula access, keyboard selection and copied summaries. Native Insights confirmed 23h 38m saved, 118 WPM, 82,109 words and 3,127 sessions for the selected month. Evidence and source snapshots are in artifacts/insights-redesign-20260930/.


### Floating recorder size — 2026-09-30

Settings → Appearance → Recorder layout adds Recorder size from 60–100% and a separate reset. The appearance preview follows the slider while it moves; releasing it saves the preference and updates the native floating pill. Only the compact central dictation pill and its waves change size. Detached control plates stay 44px with a 10px gap; expanded transcript, settings and language menus retain their normal dimensions, text and icons. Shader and mouse geometry use viewport pixels without scaling the recorder root. The notch retains its existing dimensions. Preferences and backups preserve the size, and older preferences default to 100%. The shared Swift recorder also exposes the setting and includes it in backups.

Validation: TypeScript/Vite and signed macOS debug bundle passed, 69 frontend tests passed, and the Rust preference/backup regression passed including scale defaults, range rejection and persistence. Edited Swift sources passed syntax parsing. 123 renderer geometry, WebGL and click-region checks passed across 60%, 80% and 100% in eight recording/completion states. Native Settings shows the new slider and reset. The signed app is installed at /Applications/No Tipe.app with the existing designated requirement; executable bytes match the saved build. Source snapshots, the prior app and QA evidence are under Builds/20260930-recorder-scale/.


### Available model selectors — 2026-09-30

Transcribe and mode speech selectors now share SpeechModelSelect and list only installed local models or cloud models with configured credentials. The full catalog remains in AI Models for downloading and connection. Unavailable saved selections show a placeholder without changing preferences; modes retain Application default. AI Models prevents selecting unconnected cloud models. Ollama selectors also omit unavailable saved names and clear stale options while refreshing or after connection failure.

Validation: all 29 current frontend tests (eight files), TypeScript/Vite and the signed macOS debug bundle passed. Browser fixtures covered mixed availability, an empty catalog, newly available models, a stale saved mode and local text-service failure. Native inspection showed only GigaAM v3 in the speech menu. The final signed update was installed at /Applications/No Tipe.app, verified with the same signing requirement and reopened idle. Prior bundles are preserved under Builds/20260930-model-availability; source backups, build logs and verification are in artifacts/model-availability-20260930.


### Personal snippets — 2026-09-30

Added Snippets to the React/Tauri No Tipe application, following Wispr Flow's documented trigger matching and JSON import behavior: https://docs.wisprflow.ai/articles/5784437944-create-and-use-snippets and https://docs.wisprflow.ai/articles/8955301725-How-Do-I-Bulk-Import-Dictionary-Items-and-Snippets. The library supports creation, editing, deletion, copy, enable/disable, search, sorting, import preview and plain-text JSON export. Snippets are stored locally in SQLite and included in backups; old backups remain compatible. Team sharing is outside the app's current personal-workspace architecture.

Spoken phrases accept up to 60 Unicode characters and expansions up to 4,000. A phrase spoken alone ignores case, spacing and punctuation and inserts the saved text literally. Inline phrases use case-insensitive matching with Unicode word boundaries and longest-overlap priority; expansions are not recursively matched. Dictionary replacement and AI processing operate around protected snippet markers, with a literal fallback if a provider damages or duplicates a marker. Whole-phrase snippets skip text processing. The editor supports bold, italic, links and textual numbered/bulleted lists. macOS publishes HTML and plain text for formatted whole-phrase snippets; code editors and terminals receive plain text. Inline expansions and Windows delivery use plain text.

Import accepts a JSON array of objects with `name` and `text`, up to 3 MiB and 1,000 valid unique entries. Invalid entries and normalized phrase collisions with snippets or dictionary entries are skipped in the preview. The final import validates again and commits atomically. Imported and exported JSON carries plain text; full application backups preserve formatting.

Validation: all 29 tests in the eight current frontend source files, 62 Rust tests with two existing fixture-dependent tests ignored, native paste/session/focus/keyboard regressions and the signed TypeScript/Vite/macOS debug build passed. Browser checks covered save/reopen, bold and links, blank lines/lists, duplicate rejection, enabled filtering, search, import preview and a narrow window. Installed at `/Applications/No Tipe.app`, verified with the existing designated signing requirement, reopened idle and inspected in the native Snippets screen. Live microphone dictation was not exercised for this change. Evidence, test logs, source snapshots and the previous app/database are under `artifacts/snippets-20260930/`.

Correction validation: 107 frontend tests and the TypeScript/Vite build passed. 144 renderer geometry, WebGL and click-region checks passed across 60%, 80% and 100% in eight recorder states, including unchanged side plates and expanded panels. The signed macOS bundle was installed and reopened with the existing designated requirement; executable bytes match the saved build. The previous app, source snapshots and QA evidence are under Builds/20260930-pill-only-scale/.


### View Insights theme materials — 2026-09-30

View Insights now uses a dedicated material for each theme, with a layered face, colored reflections and a complementary rim. Siri uses a light pearlescent face with pink and cyan reflections; Indigo and Blue use enamel, Cyan icy mint, Purple lilac satin, Rose rose satin, Amber champagne and Sber black graphite. Text and icon colors follow each material. Other primary controls retain their existing theme colors.

Validation: all 30 current frontend tests passed, including conservative material contrast bounds of at least 4.5:1 at normal and hover brightness. TypeScript/Vite and the signed macOS debug bundle passed. All eight materials were compared visually; the Siri keycap was checked in the browser dashboard and the installed native app. The signed app was installed and reopened idle with the same signing requirement. Prior bundle: Builds/20260930-insights-button-materials. Evidence, screenshots, source backups and diffs: artifacts/insights-button-materials-20260930.


### Saturated Insights keycaps and white pearl — 2026-10-01

Replaced the muted Insights materials with saturated electric indigo/blue, emerald mint, vivid violet, cherry red and mandarin orange. Siri now uses a mostly white pearlescent face with very faint reflections. Sber retains black graphite. Labels keep at least 4.5:1 contrast across conservative gradient bounds, including hover.

Validation: all 30 current frontend tests passed; TypeScript/Vite and the signed macOS bundle passed. Eight themes were compared visually. The final integrated build was installed with the same signing requirement and reopened after dictation ended; native Cyan visibly shows the emerald keycap. Earlier concurrent installation used an older palette, so final verification checks the integrated bundle hash and native rendering. Bundles: Builds/20260930-insights-button-saturation-v2. Evidence: artifacts/insights-button-saturation-v2.

### Empty dictation capture — 2026-10-01

A captured zero-frame WAV was reaching AVAudioFile.read(into:) in the GigaAM helper and surfaced AVFAudio error -50 after stopping dictation. Captures shorter than one 20 ms analysis window now return to idle before recognition or History insertion, and their temporary WAV is discarded. Provider entry points reject empty samples before loading a model or accessing credentials; the native audio reader returns an empty sample array without a zero-frame read.

Validation: 65 Rust tests passed (two existing model/fixture tests remain ignored). Native sample extraction passed at 0, 171, 320 and 16,000 samples. The original failing file now reports insufficient audio, and a single helper successfully handled empty → real dictation → empty. TypeScript/Vite and the signed macOS bundle passed. Installed at /Applications/No Tipe.app and reopened; signing requirement unchanged and both app/helper executables match the saved build. Evidence and the previous app are under Builds/20261001-empty-dictation/.


### Snippets design alignment — 2026-10-01

Removed the colored promotional introduction, its persistence flag and all associated styles. Snippets now uses the shared page width and Dictionary heading, table, row, hover-action and empty-state styles. Search uses a standard input; the filter and sorting use existing Select controls. The redundant Personal/Enabled tab strip was replaced with an All snippets/Enabled only filter. Row text is 14px with the same spacing and action icons as Dictionary; editor labels, borders and focus treatment follow the existing controls.

TypeScript/Vite and the signed macOS debug bundle passed. Browser checks covered populated rows, hidden actions, enabled filtering and the editor at normal and narrow widths. The signed app was installed at `/Applications/No Tipe.app`, verified byte-for-byte, reopened idle and checked in the native empty Snippets screen. Source backups, the previous and updated bundles, build log and screenshots are in `artifacts/snippets-design-20261001/`.


### Compact Insights with activity calendar — 2026-10-01

Insights keeps four compact metric cards, the selectable activity chart, activity cubes, streaks, word-goal progress and model usage. The calendar and milestone share one row. Typing comparisons, speed samples, period changes, longest streak and model counts are available through hover/focus hints rather than permanently displayed secondary statistics. Models use a disclosure row. The chart no longer repeats active days and daily averages, and day details appear over the selected bar. Hint buttons remain keyboard-accessible, with Escape dismissal; calendar history navigation remains available on hover/focus.

Validation: TypeScript/Vite and signed macOS debug bundle passed. All 30 tests in the eight current source test files passed using the artifact exclusion; the unrestricted test command also scanned archived sources and failed on an archived theme fixture missing its generated JSON. Browser checks verified compact/wide geometry, no horizontal overflow, hover/focus hints, Escape and arrow-key chart selection, period changes, empty data and failed requests distinct from zero activity. Native inspection confirmed the restored calendar, milestone and four cards, with 23h 49m saved, 82,712 words, 118 WPM and 3,162 sessions for the selected range at inspection time. The signed app was installed at /Applications/No Tipe.app with the same designated requirement and restarted idle. Saved/previous bundles: Builds/20261001-insights-balanced/. Evidence: artifacts/insights-compact-20260930/native-balanced-crop.png.


### Dock restores the main window — 2026-10-01

macOS application reopening now explicitly shows, unminimizes and focuses the main window, even when the recorder panel is visible. The single-instance callback and tray Open use the same helper. Recorder clicks and dictation actions retain their nonactivating behavior.

Validation: TypeScript/Vite and the signed macOS debug bundle passed; native paste, focus, keyboard, audio and recorder activation/placement checks passed. System reopening through Finder restored a hidden main window. Direct Dock clicking and minimized restoration were not separately verified through the UI. The signed update was installed; the later concurrent installed app also retains the reopening handler. Evidence and bundles: artifacts/dock-reopen-20261001/.


### Insights reference composition — 2026-10-01

Your usage follows the supplied Wispr screen: speed with a semicircular gauge, fixes with two details, a double-width word total card, six desktop usage categories, and a seven-row activity/streak calendar. Cards, typography, borders and accent colors follow No Tipe's dark theme. The gauge compares real speech speed with the user's typing baseline. The desktop footer exposes estimated time saved; the all-time badge shows the share of words dictated this month. Activity charts, models and milestones remain available under Your voice. Secondary explanations use hover/focus info icons. Insights alone uses the full panel width to keep the reference's 1:1:2 and 1:1 grids; other page geometry remains separate.

Session metrics now retain captured macOS application identifiers, dictionary replacement matches and measured AI word edits. Existing AI edits are recovered from retained original/processed text and persisted independently of History. Unknown historical dictionary/application data stays unavailable. Application categories use captured bundle IDs; browsers stay in Other tasks. Upserts enrich existing metrics without changing their original totals or counting sessions twice, and metadata survives backups and History deletion. Retrying processing updates the correction count. Large differing documents skip the bounded word-edit calculation instead of reporting an approximate count.

Validation: TypeScript/Vite and the signed macOS debug bundle passed. Current-source frontend tests: 31 passed using the artifact exclusion. Rust: 69 passed, two pre-existing model/fixture tests ignored. Browser checks verified all five cards, responsive reflow at a 950 px app width, no clipped category rows, functional tabs and keyboard navigation, focus hints/Escape, populated/empty/legacy/error states, period changes, request recovery and summary copying. Native inspection confirmed 118 WPM, 30,881 measured word edits, 105,484 words and a 15-day streak (35-day record) at inspection time. The signed app was installed at /Applications/No Tipe.app, restarted idle, and its executable matched the saved build. Saved and previous bundles: Builds/20261001-insights-reference/. Native evidence: artifacts/insights-reference-20261001/native-crop.png. The native capture was cropped only to remove empty white capture padding.


### Snippet editor follows the shared controls — 2026-10-01

The snippet editor now uses the Models/Settings surface tokens, 30px input, common close icon and NoType buttons. Removed all three explanatory paragraphs and the redundant library empty-state hint. Replaced glyph strings with conventional SVG bold, italic, bulleted/numbered list and link icons, with pressed states. Mouse formatting preserves the selection; Cmd/Ctrl+B/I and the link URL Enter action are supported.

Validation: TypeScript/Vite, existing snippet validation tests and the signed macOS debug build passed. Browser checks covered formatting, list conversion, linking and fitting the minimum window without overflow. The current installed binary matches the saved signed build; the new native modal was checked without another process restart. No test data was saved to the library. Sources, bundle, logs, diffs and screenshots: artifacts/snippet-modal-20261001/.


### Voice profile and Insights typography — 2026-10-01

Your voice now follows the supplied reference: a profile and portrait, creation date and update progress, catchphrase, most used word, most corrected word, and peak weekday/hour with an observed application when available. Data is measured from retained completed transcripts and persistent session metrics. First creation requires 2,000 lifetime and retained words; later updates unlock after 10,000 new words. Analysis samples the latest 20,000 retained words. Phrase/word findings require multiple independent sessions, and correction pairs use bounded word alignment, excluding punctuation, case and cross-script translation pairs. Imported files carry a new source flag and are excluded; older records without a source flag remain eligible. Peak times use the current local timezone. Physical location is never inferred.

Profiles persist locally. Deleting or expiring a source transcript removes its cached report while retaining aggregate usage totals. Generation runs off the UI thread and a mutex prevents duplicate requests. Failed generation keeps the previous report. Description enrichment uses only a configured loopback Ollama endpoint, without redirects; remote providers never receive history from this feature. Recurring-topic/length descriptions work without an installed model, and a retry can refine the description without resetting the 10,000-word countdown. The clipboard action copies the profile text. Activity charts, model breakdown and milestones are now under the collapsed Activity & models disclosure on Your usage.

The follow-up typography correction removes uppercase and tracked lettering throughout Insights. Main card and category labels use 14px; calendar text is 13px, and smaller windows reflow without shrinking labels to 8–10px. Dates, calendar months and numeric grouping explicitly use en-US while original words/phrases retain their source language. Month captions use each week's midpoint to prevent a one-day previous month label colliding with the next month.

Validation: 36 current-source frontend tests passed with artifacts excluded; Rust: 75 passed, two pre-existing tests ignored. TypeScript/Vite and the signed macOS debug bundle passed. Browser fixture checks covered initial readiness and countdown, generation while changing tabs, empty state, failed generation, retaining the prior profile during an update, local-description retry, copying, keyboard hints/Escape and a 950px app width without clipped cards or rows. The actual installed app created and retained a profile from 20,000 words across 593 recent dictations. All four findings were present. The configured qwen3.5:9b model is not installed in the local Ollama service, so the native description uses measured recurring topics. UI captions and date/month labels were verified on the Russian macOS locale. The signed installed executable matched Builds/20261001-voice-profile-final/No Tipe.app. Previous app bundles were preserved. Native screenshots, saved source, fixture and build logs: artifacts/voice-profile-20261001/. Screenshot crops remove only empty white capture padding.

Research reference for first-profile requirements and retained-history behaviour: https://docs.wisprflow.ai/articles/7470830521-voice-profile-updates-when-the-update-your-voice-profile-notification-appears. The 10,000-word update interval follows the supplied screen and is this app's explicit policy.


### Page state survives navigation — 2026-10-01

Visited pages now retain their React trees for the current app session and have independent scroll viewports. Unvisited pages remain unmounted. Dashboard metric selection, Insights tabs and cached periods, chart/disclosure state, History search, model/settings sections and file transcription results survive sidebar navigation. Your voice stays mounted after its first visit, so loading and generation can finish while another page or tab is visible. Dashboard metrics animate only when the statistic changes; returning to the page displays the current number immediately.

All-time Insights use the bootstrap statistics already in memory. Other periods cache current and previous statistics and update after statistics change or the local calendar day changes. Unchanged bootstrap statistics keep the same identity. Voice profile freshness follows library refreshes, including history deletion that retains lifetime totals. History deletion refreshes the shared library. Background pages continue receiving relevant data events, while global keyboard capture, file drag/drop, permission polling, tooltips and modal dialogs respect the active page. The appearance preview stops rendering while Settings is hidden.

Validation: 36 current-source frontend tests passed; TypeScript/Vite and the signed macOS debug bundle passed. Browser fixtures checked request counts across page/tab/period switches, immediate numbers without replayed entrance animation, independent scrolling, fresh and failed data updates, source-history invalidation, background generation/transcription, hidden input handlers, preserved settings/search and a 950px window. The signed bundle was installed at /Applications/No Tipe.app with the same signing requirement; its executable matches Builds/20261001-page-memory/No Tipe.app. The previous bundle is preserved alongside it. Native UI verification and restart were unavailable because the Mac was locked; the existing process was left running. Sources, diffs, fixtures and validation logs: artifacts/page-memory-20261001/.


### Voice profile uses the Dashboard wave — 2026-10-01

Your voice now enables the existing DashboardWave canvas on the main panel. Tab state is reported to App, so the same canvas, animation phase, audio response and theme stay shared. The effect is enabled on Dashboard and Your voice even when the background-wave restriction is checked. Your usage keeps its clear analytical layout. The setting is now labelled Limit background waves, with Dashboard and Your voice explicitly named in its description. User palette, chromatic effect, brightness and reduced-motion handling are unchanged.

The profile is a centered heading and description with Dashboard's text gradient. Its previous card frame and character illustration were removed. Side gutters clear the shared shader's 95–156px reach. Existing findings, peak time, update progress, copying and keyboard hints remain. The profile tooltip explicitly identifies prepared text-pattern descriptions or local model generation.

Current generation rules remain unchanged: a maximum of 20,000 recent retained words, four recurring-topic dictionaries (design, systems, writing, planning), a candidate requiring at least three distinct matching terms and appearing in at least five dictations, followed by the candidate with the highest session count. Six hand-written descriptions include the four topic profiles and two length-based fallbacks. No user-validation study of these archetypes has been performed. A configured local Ollama model can replace only the title and paragraph, using measured context and up to 40 short transcript excerpts. The current saved report uses the design template; its configured local model is unavailable. Acoustic voice characteristics are not analysed.

Validation: TypeScript/Vite and the signed macOS debug app bundle passed; 36 existing frontend tests passed with artifacts excluded. Browser checks confirmed the live WebGL shader, a single shared wave canvas, correct Dashboard/Usage/Voice visibility, theme rendering with the user's Siri palette and brightness 1.84, keyboard tooltip/Escape, retained tab transitions, and 950px reflow with no horizontal clipping. At that width the findings reflow to a single column while keeping readable text. Signed build: Builds/20261001-voice-profile-waves/No Tipe.app. Native installation and verification are pending because macOS reported a locked screen and required manual unlocking. Sources, fixture, screenshot and build log: artifacts/voice-profile-waves-20261001/.


### Voice waves stay inside the profile card — 2026-10-01

Corrects the preceding full-panel wave implementation. The original profile-card composition is restored: a left-aligned 32px title, sentence-case Voice profile label and description, the portrait on the right, the original full-width page spacing and two-column findings/peak grid. The shared Dashboard shader now renders in a clipped, rounded decorative layer inside the profile card with a 48px edge reach. The text and portrait sit above it; hints remain outside the clipping layer. Insights disables the main-panel effect on both tabs. The profile wave pauses when its tab/page is hidden and retains the user's palette, brightness, audio response and reduced-motion behaviour. The background-wave restriction setting again refers only to Dashboard. Profile data and generation rules are unchanged.

Validation: TypeScript/Vite and the signed macOS debug bundle passed; all 36 existing frontend tests passed. Browser checks confirmed real WebGL, clipping to the 916 × 226px profile card, the restored composition, English captions, an unclipped info tooltip and a 950px app width without horizontal text/portrait overflow. Switching to Usage or another page hides and pauses the card wave; Dashboard still uses its original main-panel wave. The signed app was atomically installed at /Applications/No Tipe.app with the same designated signing requirement; its executable SHA256 matches Builds/20261001-voice-profile-card-waves/No Tipe.app. The previous installed bundle was preserved alongside it. The existing native process was not interrupted. Native restart and visual verification remain pending because the Mac is locked. Browser preview, source snapshots, diffs and validation logs: artifacts/voice-profile-card-waves-20261001/.


### Profile card wave continues along the bottom — 2026-10-01

The profile portrait and its unused styling are removed. The existing card composition remains left-aligned. An optional fourth shader pass mirrors the top wave along the bottom edge; only the profile card enables it. Dashboard keeps its three-edge field. The effect remains clipped inside the card, behind the copy, and pauses when the retained view is hidden.

Validation: TypeScript/Vite and the signed macOS debug bundle passed. Browser WebGL inspection showed the visible lower wave and no errors. The actual app was quit after verifying Start dictation was off, updated with the same signing requirement, restarted, and checked on Your voice. The native screenshot shows the four-edge wave, no illustration, preserved saved profile and findings, and the original two-column composition. Installed executable SHA256 matches Builds/20261001-voice-profile-four-edges/No Tipe.app; the prior bundle is preserved alongside it. Evidence and source snapshots: artifacts/voice-profile-four-edges-20261001/native.png and source/. This native check also completes the previously pending restart and visual verification for the restored profile-card layout.


## 2026-10-01 — one installation and signed GitHub updates

Local builds use `npm run app:update`. The installer stages and verifies the new build, preserves the established bundle identifier and designated signing requirement, replaces `/Applications/No Tipe.app`, verifies startup, and removes the temporary rollback. Failed staging, identity checks or startup restore the prior installation. No dated app copies are retained. Generated bundles of the predecessor identity in Builds/, artifacts/ and the Tauri target directory are unregistered and removed after installation. User data, models, preferences, Keychain and the original separate No Tipe app are preserved. The initial cleanup removed 110 generated bundles (8.26 GiB logical size); LaunchServices now has one No Tipe entry.

The main window checks a configured GitHub Releases repository on startup, every six hours and on a due foreground/network check. A download icon appears next to No Tipe only when the release manifest offers a newer version for this platform. It opens release notes and Update and restart, with download progress and retryable errors. Dictation disables installation; the backend rechecks after download and blocks installation while file transcription, profile generation or model downloads are in progress. Update packages must pass the embedded public key and signed version checks. URLs are restricted to release assets in the configured repository; access tokens are never sent to another manifest-selected host.

Settings → General → App updates configures a repository. An optional token for private releases is stored in the system credential store, never frontend persistence, a backup or the binary. Public releases require no token. The release script embeds the repository into new builds so ordinary users receive checks without configuration. The current developer installation has no production channel configured. No GitHub repository was created, no release was published and no source code was uploaded during this change.

`npm run release:github -- --repo OWNER/REPO --version X.Y.Z` prepares a signed package locally. The version must increase for each published build. Only explicit `--publish` creates a draft, uploads the archive/installer, its signature and latest.json, then publishes it atomically to updater clients. The manifest uses GitHub release asset API URLs, supporting both public and authenticated private repositories. The script verifies its package against the app public key and signed version, and rejects modified bytes before any upload. `--debug` is local verification only and cannot publish. Application bundles are discarded after packaging; transient upload copies are removed. Source snapshots and signing keys are never uploaded.

The private signing key is outside the project at `~/.tauri/no-tipe-updater.key`; only updater.pub is in the project. Keep this key to retain the ability to update installed clients. It must not be committed, printed, regenerated or shared with recipients. Public update packages contain compiled application resources; keeping the source repository private is not protection against reverse engineering.

No Tipe's new license and copyright notice will be configured separately before distribution. A private source repository plus public binary releases is technically supported, but no repository or public release is currently authorized. Third-party dependencies retain their own notices. Before distribution to other Macs, production Apple signing/notarization must also be configured; local builds retain the existing development identity.

Validation: 36 frontend tests, the existing 77 Rust tests, and the additional signing-key test passed (two existing audio-fixture tests remain ignored). TypeScript/Vite, signed macOS build, local replacement, application startup, retained library and microphone/Accessibility permissions were verified. Native GitHub checks were exercised against an existing public repository with no releases, then that temporary configuration was cleared. Browser fixtures covered availability, no newer version, download failure/progress and recording inhibition. A local 0.1.1 package was generated, its signature/version verified and modified bytes rejected. It was not uploaded or installed. A hosted GitHub update/install roundtrip remains unverified until the release repository and distribution rights are settled. Evidence: artifacts/github-updates-20261001/.


### Insights tabs hover through text colour — 2026-10-01

Insights tabs now override the global button hover with a transparent background and white text. The default inactive text and selected-tab underline stay unchanged. Browser pointer testing verified the inactive label changes from rgb(140, 140, 150) to rgb(255, 255, 255), while its background remains rgba(0, 0, 0, 0). Evidence: artifacts/insights-tab-hover-20261001/preview.jpg.

TypeScript/Vite and the signed debug app build passed. The concurrently configured updater initially requested a release-archive private signing key after successfully building the app bundle. A command-scoped local-build.json disables only updater-archive creation for this local .app build; project updater keys and validation remain untouched. The app was closed after verifying dictation was off, installed with the same signing requirement, restarted and opened on Insights. Installed executable SHA256 matches Builds/20261001-insights-tab-hover/No Tipe.app; the previous installed bundle is preserved alongside it. Native evidence, source diff and logs: artifacts/insights-tab-hover-20261001/.


## 2026-10-01 — No Tipe naming cleanup

The current app, executable, Rust crate, native symbols, renderer bridge, adapter binaries, prototype files, design exports and project documentation use No Tipe naming. Source folders are `NoTipe/`, `NoTipeTests/`, `NoTipeUITests/` and `NoTipe.xcodeproj/`; the project root is `/Users/darlingfxx/Projects/no-tipe`. The former dashboard link to the upstream repository is now a working Settings shortcut. New backup exports use `no-tipe-desktop`; import accepts both the new and legacy format.

The installer reads each bundle's `CFBundleExecutable`, so it stops the prior process even when executable names differ. That initial branding pass retained the predecessor identity and storage names. It is superseded by the namespace migration below. User-authored transcripts and historical source snapshot contents are retained. Dependency notices are recorded in `THIRD-PARTY-NOTICES.md`.

Validation: 36 frontend tests, 79 Rust tests (2 optional model integration tests skipped), macOS native regression checks, frontend production build, Python syntax checks and parsing of 326 Swift files passed. The signed application was rebuilt with `npm run app:update`, installed and relaunched. Settings navigation, microphone and Accessibility permissions were verified in the running app. All 4,012 history records, 3,936 metrics, 2 modes and the saved preferences were retained. The old native installation and redundant generated products were removed; no rollback app bundle remains.

After moving the root, the Cargo/Tauri cache was cleared to regenerate plugin permission paths. `npm run app:update` then passed from `/Users/darlingfxx/Projects/no-tipe`, preserving the installed signature and library. The final check found unchanged preferences, modes and supporting collections, plus two additional history records and metrics recorded during the work. The saved Codex project still points to the former folder; update its folder through Edit project. Computer Use cannot operate Codex itself in this session.


### Subtle white rims on Insights graphics — 2026-10-01

Chart accents now have a 0.5px white edge at 12% opacity. Percentage bars, activity calendar cells, legend swatches, activity columns and progress fills use an inset rim without layout changes. The SVG speed gauge uses matching dashed 17px and 16px strokes, leaving a 0.5px outline around its filled arc and round ends at its 200px viewBox size. The former calendar-cell border is replaced by the same fractional inset edge. Labels, measured data, theme fills and component composition are unchanged.

TypeScript/Vite and the signed debug macOS app bundle passed. The Sber browser fixture confirmed the inset half-pixel rim, 12% opacity and matching gauge coverage. The installed app was closed through native UI after verifying dictation was off, atomically replaced with the same designated signing requirement, relaunched and visually checked on Your usage. The installed executable hash is recorded in artifacts/insights-rims-20261001/install.json. The single-app workflow keeps only /Applications/No Tipe.app: temporary rollback was removed after startup and native verification, and generated application bundles were cleaned through the shared installer cleanup routine. Native lifecycle actions used CUA; the build/install steps match the local update workflow. Native evidence: artifacts/insights-rims-20261001/native-crop.png, cropped only to remove empty white capture padding.


### White rims apply only to filled accents — 2026-10-01

Corrects the initial rim scope: inactive calendar cells, the zero-level legend swatch, future days and empty desktop categories have no rim. Positive calendar activity and populated category bars retain the 0.5px white inset at 12% opacity. Activity/progress fills explicitly mark whether they contain a value; zero fills have no rim, and an unavailable/zero speed has no SVG rim pass.

TypeScript/Vite and the signed macOS app build passed. Browser checks verified no box shadow on all five 0% categories, inactive cells and the empty legend; populated elements retain the half-pixel rim. A fully empty fixture also verified no rims on cells, categories, activity columns, milestone or gauge. A concurrent local update installed the shared frontend and cleaned the generated bundle while native verification was in progress. The installed executable contains the exact CSS asset from this build and has the same designated signing requirement; its JS bundle reflects concurrent changes. The restarted native app visibly shows plain empty cells and 0% placeholders while populated green elements keep their subtle edge. Current binary hash and verified stylesheet asset are recorded in artifacts/insights-accent-only-rims-20261001/install.json. The earlier temporary rollback was removed after this native check. Only the installed app remains; no dated app archive was made. Native evidence: artifacts/insights-accent-only-rims-20261001/native-crop.png, cropped solely to remove empty capture padding.


## Independent No Tipe identity — 2026-10-01

The current Tauri bundle, signing checks and Keychain writes use `app.no-tipe.desktop`. The earlier Swift target and its tests use `app.no-tipe.native`, `app.no-tipe.native.Tests` and `app.no-tipe.native.UITests`; they cannot share the current app's identity. Native preference and license keys now use No Tipe names. The predecessor's cloud container and licensing organization are disconnected; a future native licensing organization or portal must be supplied explicitly through `NoTipeLicenseOrganizationID` and `NoTipeLicensePortalURL`.

The first current-app launch stages a complete data copy and snapshots the prior SQLite database, including committed WAL rows, into `no-tipe.sqlite3`. Active audio and model paths are remapped. Publication of the new directory is atomic; migration errors leave the source intact. An existing No Tipe database always wins. Old backups and native import paths remain accepted by compatibility readers. API keys are copied to the new Keychain service on use, while explicit removal suppresses legacy fallback. Update configuration is disconnected during data migration; the prior GitHub update token is not inherited.

The local installer accepts the current and known predecessor identifiers for the installed app, comparing the rest of the designated requirement without relaxing certificate or anchor checks. New packages must have the current identifier. Old generated copies and stale LaunchServices entries are cleaned under the same narrow project-directory limits. macOS permission grants may need renewal because the app identifier changed.

The user confirmed transfer of authorship and rights. The former project attribution document has been replaced by `THIRD-PARTY-NOTICES.md`, which preserves dependency notices. No new Git remote or update repository has been configured; No Tipe's license and copyright notice will be configured separately before distribution.

## Calendar rims follow intensity — 2026-10-01

Insights calendar and its legend now leave levels 0 and 1 without a rim. Levels 2, 3 and 4 retain the 0.5px inset white rim at 2.7%, 5.3% and 8% opacity (CSS minification quantizes these to 8-bit alpha). Disabled future days remain plain. Other infographic accents preserve their existing styling.

Signed release build and distribution checks passed. The shared installer verified startup and removed its rollback. Five calendar levels, empty usage bars and future cells were checked in the browser with no errors at that verification point. A subsequent concurrent local app update retained this correction: its embedded compressed CSS was located in the installed binary and decoded to verify all three rim levels. Native Computer Use could not bind the renamed application; the screenshots are from the development fixture. Evidence: artifacts/insights-level-rims-20261001/. Temporary bundle staging was removed; no application archive was retained.

## 2026-10-04 — fixed public update source

App updates now always use the public `Darlingfxx02/no-tipe-releases` repository without GitHub credentials. Removed the Configure dialog, repository/token settings, local GitHub account connection and their native commands. Saved historical repository metadata and Keychain credentials are retained but never read by the updater. Builds no longer accept a repository override from the environment; manifest and package URLs must belong to the official release repository. Startup checks, the 90-minute schedule and signed installation remain in place.

Validation: 140 frontend tests, 14 frontend script tests, 6 native updater tests, 2 identity migration tests and 11 release-packaging tests passed. `npm run app:update` completed the signed build, distribution checks, replacement, relaunch and removal of generated app bundles. The installed General settings show a single Check for updates action; the automatic startup check and a manual check reached the current-version state (a transient connection failure succeeded on retry).


### Audio retention for recognition recovery — 2026-10-04

Settings → Data no longer offers audio retention durations. A help hint beside Retention explains the fixed policy: successful recognition immediately deletes the app-owned recording; History retains audio only for the ten latest failed requests without any recognized text. Partial results, canceled requests and text-processing or delivery failures retain text without audio. Failed entries still offer recognition retry; a successful retry removes its recording. Pending recognition is protected from cleanup.

Startup applies the policy to recordings from previous builds and removes orphan temporary audio. History deletion and expiration also remove owned retry audio. Backup import applies the same limit, ignores obsolete audioRetentionDays preferences, and never deletes recordings outside the app's audio directory. Compatibility retries use an owned copy of external input audio.

Validation: frontend tests passed (149), script tests passed (14), TypeScript checked, and Rust tests passed (189; 8 environment-dependent tests ignored). Regression cases cover ten-request eviction, active retry protection, success, partial text, cancellation, startup migration, backup compatibility, external input preservation, and history cleanup.

Installed with `npm run app:update` at `/Applications/No Type.app`; signing and distribution checks passed and the generated app bundle was removed. Native Settings → Data shows only transcription-history retention with the audio-policy help trigger. Installed-data verification preserved the text digest and all 4,491 metrics, reduced managed audio files from 789 to 8 retry recordings, and found no successful or partial-text rows with audio. Evidence: `docs/task-status/audio-retention-verification.json`.
