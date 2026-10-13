#!/usr/bin/env python3
"""Run macOS paste/route regression checks without changing the user's clipboard."""
import subprocess
import sys
import tempfile
from pathlib import Path

if sys.platform != "darwin":
    sys.exit("Native checks require macOS")
native = Path(__file__).resolve().parents[1] / "native"
cases = [
    ("paste-evidence", ["Paste.m", "PasteEvidenceTests.m"], ["AppKit", "ApplicationServices"]),
    ("paste-sessions", ["PasteSessionTests.m"], ["AppKit", "ApplicationServices"]),
    ("paste-focus", ["PasteFocusTests.m"], ["AppKit", "ApplicationServices"]),
    ("paste-keyboard", ["PasteKeyboardTests.m"], ["AppKit", "ApplicationServices"]),
    ("audio-devices", ["AudioDevices.m", "AudioDeviceTests.m"], ["Foundation", "CoreAudio"]),
]
with tempfile.TemporaryDirectory(prefix="no-tipe-native-") as directory:
    for name, sources, frameworks in cases:
        binary = str(Path(directory) / name)
        command = ["xcrun", "clang", "-fobjc-arc", "-fblocks"]
        for framework in frameworks:
            command += ["-framework", framework]
        subprocess.run(command + [str(native / source) for source in sources] + ["-o", binary], check=True)
        subprocess.run([binary], check=True)
    # The panel shim restores Tao's dealloc under manual reference counting.
    panel_object = str(Path(directory) / "cloud-panel.o")
    subprocess.run(["xcrun", "clang", "-fno-objc-arc", "-c", str(native / "CloudPanel.m"), "-o", panel_object], check=True)
    for name, sources in [
        ("cloud-activation", ["CloudActivationTests.m"]),
        ("cloud-placement", ["Permissions.m", "CloudPlacementTests.m"]),
    ]:
        binary = str(Path(directory) / name)
        command = ["xcrun", "clang", "-fobjc-arc", "-fblocks"]
        for framework in ["AppKit", "AVFoundation", "ApplicationServices"]:
            command += ["-framework", framework]
        subprocess.run(command + [str(native / source) for source in sources] + [panel_object, "-o", binary], check=True)
        subprocess.run([binary], check=True)
