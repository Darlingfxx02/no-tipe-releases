#!/usr/bin/env python3
"""Replace the one installed app; keep rollback only during installation."""
from channels import CHANNELS
import argparse
import hashlib
import os
import plistlib
import re
import signal
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = Path('/Applications/No Type.app')
PREDECESSOR_APPS = (Path('/Applications/No Tipe.app'),)
LAUNCH_AGENTS = Path.home() / 'Library/LaunchAgents'
IDENTIFIER = 'app.no-tipe.desktop'
# Only the installed predecessor may use the old identity. New packages may not.
LEGACY_IDENTIFIER = 'app.voiceink.desktop'
MANAGED_IDENTIFIERS = {IDENTIFIER, LEGACY_IDENTIFIER}
LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
MANAGED = [ROOT / 'Builds', ROOT / 'CrossPlatform/artifacts', ROOT / 'CrossPlatform/src-tauri/target']


def configure_channel(channel):
    global APP, PREDECESSOR_APPS, IDENTIFIER, MANAGED_IDENTIFIERS
    identity = CHANNELS[channel]
    APP = Path('/Applications') / (identity['name'] + '.app')
    IDENTIFIER = identity['identifier']
    PREDECESSOR_APPS = (Path('/Applications/No Tipe.app'),) if channel == 'stable' else ()
    MANAGED_IDENTIFIERS = {IDENTIFIER, LEGACY_IDENTIFIER} if channel == 'stable' else {IDENTIFIER}


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def verify(path, allow_legacy=False):
    data = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
    if data.get('CFBundleIdentifier') not in (MANAGED_IDENTIFIERS if allow_legacy else {IDENTIFIER}):
        raise RuntimeError(f'Unexpected application identifier: {path}')
    run('codesign', '--verify', '--deep', '--strict', path)
    result = run('codesign', '-d', '-r-', path, capture_output=True, text=True)
    return next(line for line in (result.stdout + result.stderr).splitlines() if line.startswith('designated =>'))


def normalize_requirement(requirement):
    # Compare the complete designated requirement, allowing exactly the known
    # bundle rename while retaining all certificate and anchor restrictions.
    return re.sub(r'identifier "(' + '|'.join(re.escape(i) for i in MANAGED_IDENTIFIERS) + r')"',
                  'identifier "' + IDENTIFIER + '"', requirement, count=1)


def executable(path):
    data = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
    name = data.get('CFBundleExecutable')
    if not isinstance(name, str) or not name or Path(name).name != name:
        raise RuntimeError(f'Invalid application executable: {path}')
    return path / 'Contents/MacOS' / name


def digest(path):
    return hashlib.sha256(executable(path).read_bytes()).hexdigest()


def cleanup():
    # Restrict deletion to generated bundles of this exact app, never source,
    # the original native app, frameworks, user data or another project.
    count = size = 0
    for base in MANAGED:
        for parent, folders, _ in os.walk(base, followlinks=False):
            for name in list(folders):
                if not name.endswith('.app'):
                    continue
                folders.remove(name)
                path = Path(parent) / name
                if path.is_symlink():
                    continue
                try:
                    info = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
                except (OSError, ValueError):
                    continue
                if info.get('CFBundleIdentifier') not in MANAGED_IDENTIFIERS:
                    continue
                size += sum(file.stat().st_size for file in path.rglob('*') if file.is_file() and not file.is_symlink())
                subprocess.run([LSREGISTER, '-u', str(path)], capture_output=True)
                shutil.rmtree(path)
                count += 1
    alias = Path('/Applications/VoiceInk Next.app')
    if alias.is_symlink() and alias.resolve() in {APP, *PREDECESSOR_APPS}:
        subprocess.run([LSREGISTER, '-u', str(alias)], capture_output=True)
        alias.unlink()
    # Old temporary rollbacks may already be gone but still be indexed.
    dump = run(LSREGISTER, '-dump', capture_output=True, text=True).stdout
    for block in dump.split('--------------------------------------------------------------------------------'):
        identity = re.search(r'^identifier:\s+(\S+)\s*$', block, re.M)
        if not identity or identity[1] not in MANAGED_IDENTIFIERS:
            continue
        match = re.search(r'^path:\s+(.+?) \(0x[0-9a-f]+\)$', block, re.M)
        if match and not Path(match[1]).exists():
            subprocess.run([LSREGISTER, '-u', match[1]], capture_output=True)
    run(LSREGISTER, '-f', APP, capture_output=True)
    print(f'Removed {count} generated app copies ({size / 1024**3:.2f} GiB logical size).')


def install(source):
    installed = [path for path in (APP, *PREDECESSOR_APPS) if path.exists()]
    if source.resolve() in {path.resolve() for path in (APP, *PREDECESSOR_APPS)}:
        raise RuntimeError('Build source must differ from the installed app')
    signature = verify(source)
    for path in installed:
        if normalize_requirement(verify(path, allow_legacy=True)) != normalize_requirement(signature):
            raise RuntimeError('Signing identity changed; refusing to replace the installed app')
    # Read both bundle manifests so a renamed executable still stops the old app.
    executables = {str(APP / 'Contents/MacOS' / executable(source).name)}
    executables.update(str(executable(path)) for path in installed)
    login_item = LAUNCH_AGENTS / (APP.stem + '.plist')
    login_before = login_item.read_bytes() if login_item.exists() else None
    # The temporary directory is on the same filesystem so renames are atomic.
    with tempfile.TemporaryDirectory(prefix='.no-tipe-install-', dir=APP.parent) as temporary:
        temporary = Path(temporary)
        staging = temporary / 'new.bundle'
        run('ditto', source, staging)
        if verify(staging) != signature or digest(staging) != digest(source):
            raise RuntimeError('Staged build did not match the source')
        def running():
            result = run('ps', '-axo', 'pid=,comm=', capture_output=True, text=True)
            return [int(fields[0]) for line in result.stdout.splitlines() if len(fields := line.strip().split(None, 1)) == 2 and fields[1] in executables]
        for pid in running():
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        # Do not swap a bundle while the old process is still using it.
        import time
        for _ in range(100):
            if not running():
                break
            time.sleep(.1)
        else:
            raise RuntimeError('No Type is still running; installation was not changed')
        previous = []
        swapped = False
        try:
            for index, path in enumerate(installed):
                rollback = temporary / f'previous-{index}.bundle'
                path.rename(rollback)
                previous.append((path, rollback))
            staging.rename(APP)
            swapped = True
            if verify(APP) != signature or digest(APP) != digest(source):
                raise RuntimeError('Installed build verification failed')
            # Reusing the path and version can leave the old icon (or legacy
            # bundle identifier) cached. Refresh registration before launch.
            APP.touch()
            # After an atomic swap the new bundle may not yet be registered.
            # Unregistering it can return 1; force-registration must still run.
            subprocess.run([LSREGISTER, '-u', str(APP)], capture_output=True)
            run(LSREGISTER, '-f', APP, capture_output=True)
            run('open', APP)
            for _ in range(50):
                if running():
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('The updated app did not start; restoring the previous build')
            for _ in range(20):
                time.sleep(.1)
                if not running():
                    raise RuntimeError('The updated app exited during startup; restoring the previous build')
        except BaseException:
            if swapped and APP.exists():
                shutil.rmtree(APP)
            if login_before is not None:
                login_item.write_bytes(login_before)
            elif login_item.exists():
                login_item.unlink()
            for path, rollback in previous:
                rollback.rename(path)
                subprocess.run([LSREGISTER, '-f', str(path)], capture_output=True)
            if installed:
                subprocess.run(['open', str(installed[0])])
            raise
        # Rollback has served its purpose. TemporaryDirectory removes it now.
    retire_predecessor_login_item()
    cleanup()
    print(f'Updated {APP}; no archived application bundles retained.')


def retire_predecessor_login_item():
    # Retire only this product's old entry after the renamed app starts. The
    # application recreates its current entry from the saved login preference.
    path = LAUNCH_AGENTS / 'No Tipe.plist'
    if not path.exists():
        return
    try:
        data = plistlib.loads(path.read_bytes())
        arguments = data.get('ProgramArguments', [])
        expected = any(str(arguments[0]).startswith(str(app / 'Contents/MacOS') + '/') for app in PREDECESSOR_APPS) if arguments else False
    except (OSError, ValueError, TypeError):
        return
    if data.get('Label') == 'No Tipe' and expected:
        subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}', str(path)], capture_output=True)
        path.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'CrossPlatform/src-tauri/target/debug/bundle/macos/No Type.app')
    parser.add_argument('--channel', choices=CHANNELS, default='stable')
    parser.add_argument('--cleanup-only', action='store_true')
    args = parser.parse_args()
    configure_channel(args.channel)
    if args.cleanup_only:
        verify(APP, allow_legacy=True)
        cleanup()
    else:
        install(args.source)
