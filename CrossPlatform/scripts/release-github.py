#!/usr/bin/env python3
"""Build a signed release; publish binary assets only with --publish."""
from channels import CHANNELS, build_config
import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def verify_windows_package(package, version, expected_sha256, channel='stable'):
    package = package.resolve()
    if package.name != f"{CHANNELS[channel]['asset']}_{version}_windows-x86_64-setup.exe" or not package.is_file():
        raise RuntimeError('Expected the Windows installer for the requested release version')
    if not expected_sha256 or not re.fullmatch(r'[0-9a-fA-F]{64}', expected_sha256):
        raise RuntimeError('Provide the SHA-256 from the private Windows build artifact')
    with package.open('rb') as installer:
        header = installer.read(64)
        if len(header) != 64 or header[:2] != b'MZ':
            raise RuntimeError('The Windows installer must be a PE executable')
        installer.seek(int.from_bytes(header[60:64], 'little'))
        if installer.read(4) != b'PE\x00\x00':
            raise RuntimeError('The Windows installer has an invalid PE header')
        installer.seek(0)
        digest = hashlib.sha256()
        for block in iter(lambda: installer.read(1024 * 1024), b''):
            digest.update(block)
        digest = digest.hexdigest()
    if digest != expected_sha256.lower():
        raise RuntimeError('The downloaded Windows installer does not match the build artifact SHA-256')
    return package


def verify_destination(repo, allow_public=False, channel='stable'):
    expected = CHANNELS[channel]['repo']
    if repo.lower() != expected.lower():
        raise RuntimeError(f'Release packages must go to {expected}, separately from source')
    source = subprocess.run(['git', 'remote', 'get-url', 'origin'], cwd=ROOT.parent, capture_output=True, text=True)
    if source.returncode == 0:
        remote = source.stdout.strip().removesuffix('.git').rstrip('/')
        if remote.lower() in {f'https://github.com/{repo}'.lower(), f'git@github.com:{repo}'.lower()}:
            raise RuntimeError('Release packages must go to the separate binary release repository, not the source repository')
    metadata = json.loads(run('gh', 'api', f'repos/{repo}', capture_output=True, text=True).stdout)
    if channel == 'dev' and not metadata.get('private'):
        raise RuntimeError('Developer releases must remain private, even with --public')
    if not metadata.get('private') and not allow_public:
        raise RuntimeError('Public binary distribution requires explicit authorization and --public. Publish packages only to the separate release repository.')
    return metadata


def verify_source_version(version, root=ROOT, channel='stable'):
    if channel == 'dev':
        config = json.loads((root / 'src-tauri/tauri.dev.conf.json').read_text(encoding='utf-8'))
        if config['version'] != version or config['identifier'] != CHANNELS['dev']['identifier']:
            raise RuntimeError('Set tauri.dev.conf.json to the requested developer version before building')
        return
    # Stable builds keep package, Cargo, diagnostics and bundle versions aligned.
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    config = json.loads((root / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8'))['version']
    cargo = re.search(r'^version\s*=\s*"([^"]+)"', (root / 'src-tauri/Cargo.toml').read_text(encoding='utf-8'), re.M).group(1)
    if {package, config, cargo} != {version}:
        raise RuntimeError('Set package.json, Cargo.toml and tauri.conf.json to the requested release version before building')


def run(*args, **kwargs):
    args = [str(arg) for arg in args]
    if os.name == 'nt' and args[0] == 'npm':
        # Avoid relying on cmd.exe resolving an extensionless npm executable.
        executable = shutil.which('npm.cmd', path=kwargs.get('env', os.environ).get('PATH'))
        if not executable:
            raise RuntimeError('Install Node.js and make npm.cmd available on PATH')
        args[0] = executable
    return subprocess.run(args, check=True, cwd=ROOT, **kwargs)


def manifest(version, notes, target, signature, asset_url, previous=None):
    platforms = {}
    if previous:
        if previous.get('version') != version or not isinstance(previous.get('platforms'), dict):
            raise RuntimeError('The draft update manifest has a different version or invalid platforms')
        platforms.update(previous['platforms'])
    platforms[target] = {'signature': signature.strip(), 'url': asset_url}
    return {'version': version, 'notes': notes,
            'pub_date': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platforms': platforms}


def validate_manifest(value, version, repo, assets):
    if value.get('version') != version or not value.get('platforms'):
        raise RuntimeError('Missing update platforms or incorrect manifest version')
    asset_urls = {asset['url'] for asset in assets}
    for target, package in value['platforms'].items():
        if target not in {'darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'}:
            raise RuntimeError(f'Unsupported update target: {target}')
        parsed = urlparse(package.get('url', ''))
        prefix = f'/repos/{repo}/releases/assets/'
        if (parsed.scheme != 'https' or parsed.netloc != 'api.github.com'
                or parsed.query or parsed.fragment or not parsed.path.startswith(prefix)
                or not parsed.path[len(prefix):].isdigit() or package['url'] not in asset_urls
                or not package.get('signature', '').strip()):
            raise RuntimeError(f'Invalid release asset or missing signature for {target}')


def release_metadata(repo, tag):
    result = subprocess.run(['gh', 'api', f'repos/{repo}/releases/tags/{tag}'],
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if '(HTTP 404)' in result.stderr:
        # GitHub's tag endpoint omits drafts until their Git tag exists.
        # The authenticated release list includes them; reuse an existing
        # draft rather than creating another or losing its platform assets.
        drafts = subprocess.run(['gh', 'api', '--paginate', '--slurp',
                                 f'repos/{repo}/releases?per_page=100'],
                                cwd=ROOT, capture_output=True, text=True)
        if drafts.returncode != 0:
            raise RuntimeError('Could not list draft releases. Check GitHub access before building.')
        return next((release for page in json.loads(drafts.stdout)
                     for release in page if release.get('tag_name') == tag), None)
    raise RuntimeError('Could not read the release. Check GitHub access before building.')


def upload_release(repo, version, notes, target, package, signature, publish, allow_public=False, channel='stable'):
    verify_destination(repo, allow_public, channel)
    tag = f'v{version}'
    release = release_metadata(repo, tag)
    if release and not release['draft']:
        raise RuntimeError('This version is already published. Use a higher version for a new build.')
    with tempfile.TemporaryDirectory(prefix='no-tipe-release-') as temporary:
        temporary = Path(temporary)
        body = temporary / 'notes.txt'
        body.write_text(notes, encoding='utf-8')
        previous = None
        if release:
            if any(asset['name'] == 'latest.json' for asset in release['assets']):
                run('gh', 'release', 'download', tag, '--repo', repo, '--pattern', 'latest.json', '--dir', temporary)
                previous = json.loads((temporary / 'latest.json').read_text(encoding='utf-8'))
                validate_manifest(previous, version, repo, release['assets'])
        else:
            run('gh', 'release', 'create', tag, '--repo', repo, '--draft', '--title', f"{CHANNELS[channel]['name']} {version}", '--notes-file', body)
        name = f"{CHANNELS[channel]['asset']}_{version}_{target}" + ('.app.tar.gz' if target.startswith('darwin-') else '-setup.exe')
        upload = temporary / name
        try:
            os.link(package, upload)
        except OSError:
            shutil.copy2(package, upload)
        upload_sig = temporary / (name + '.sig')
        upload_sig.write_bytes(signature.read_bytes())
        # Only drafts can be replaced; failed packaging never changes a live channel.
        run('gh', 'release', 'upload', tag, upload, upload_sig, '--repo', repo, '--clobber')
        release = release_metadata(repo, tag)
        if not release or not release['draft']:
            raise RuntimeError('The release must remain a draft while its update manifest is assembled')
        asset_url = next(asset['url'] for asset in release['assets'] if asset['name'] == name)
        value = manifest(version, notes, target, signature.read_text(encoding='utf-8'), asset_url, previous)
        validate_manifest(value, version, repo, release['assets'])
        latest = temporary / 'latest.json'
        latest.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
        run('gh', 'release', 'upload', tag, latest, '--repo', repo, '--clobber')
        if publish:
            verify_destination(repo, allow_public, channel)
            run('gh', 'release', 'edit', tag, '--repo', repo, '--notes-file', body, '--draft=false', '--latest')
    print(f'{"Published signed update" if publish else "Prepared draft"}: https://github.com/{repo}/releases/tag/{tag}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', choices=CHANNELS, default='stable')
    parser.add_argument('--repo', required=True, help='GitHub binary release repository, owner/name')
    parser.add_argument('--version', required=True, help='New numeric version in the selected channel, e.g. 0.1.10')
    parser.add_argument('--notes-file', type=Path, help='Release notes in UTF-8')
    parser.add_argument('--public', action='store_true', help='Explicitly allow the binary-only release repository to be public; never changes repository visibility')
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument('--publish', action='store_true', help='Upload signed assets and publish a GitHub release')
    destination.add_argument('--draft', action='store_true', help='Upload signed assets to a private draft; preserve other platforms')
    parser.add_argument('--debug', action='store_true', help='For local updater verification only; cannot publish debug builds')
    parser.add_argument('--windows-package', type=Path, help='Sign and upload a Windows installer built by the private CI workflow')
    parser.add_argument('--sha256', help='Expected SHA-256 of --windows-package, from the CI artifact')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo) or not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', args.version):
        parser.error('Use owner/name and a stable semantic version X.Y.Z')
    if args.repo.lower() != CHANNELS[args.channel]['repo'].lower():
        parser.error(f"Use the binary-only repository {CHANNELS[args.channel]['repo']}")
    if args.debug and (args.publish or args.draft):
        parser.error('Debug builds must not be uploaded')
    if args.windows_package and args.debug:
        parser.error('Prebuilt Windows installers must be release builds')
    if bool(args.windows_package) != bool(args.sha256):
        parser.error('--windows-package and --sha256 must be supplied together')
    if not all((ROOT.parent / name).is_file() for name in ['LICENSE', 'NOTICE']):
        parser.error('Configure the application LICENSE and NOTICE before packaging')
    if args.publish or args.draft:
        verify_destination(args.repo, args.public, args.channel)
    key = Path(os.environ.get('TAURI_SIGNING_PRIVATE_KEY', str(Path.home() / ('.tauri/no-type-dev-updater.key' if args.channel == 'dev' else '.tauri/no-tipe-updater.key'))))
    if not key.is_file():
        parser.error('Set TAURI_SIGNING_PRIVATE_KEY to your updater signing key file outside this repository')
    if key.resolve().is_relative_to(ROOT.parent.resolve()):
        parser.error('The private signing key must be stored outside the project')
    env = os.environ.copy()
    env['PATH'] = str(Path.home() / '.cargo/bin') + os.pathsep + env['PATH']
    flags = env.get('CARGO_ENCODED_RUSTFLAGS', '').split('\x1f') if env.get('CARGO_ENCODED_RUSTFLAGS') else env.get('RUSTFLAGS', '').split()
    flags.append(f'--remap-path-prefix={Path.home()}=/build')
    env['CARGO_ENCODED_RUSTFLAGS'] = '\x1f'.join(flags)
    env.pop('RUSTFLAGS', None)
    env['TAURI_SIGNING_PRIVATE_KEY'] = str(key)
    env.setdefault('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '')
    xcode = Path('/Users/darlingfxx/Downloads/Xcode-beta.app/Contents/Developer')
    if 'DEVELOPER_DIR' not in env and xcode.is_dir():
        env['DEVELOPER_DIR'] = str(xcode)
    version_tuple = lambda value: tuple(map(int, value.removeprefix('v').split('.')))
    try:
        verify_source_version(args.version, channel=args.channel)
    except RuntimeError as error:
        parser.error(str(error))
    notes = args.notes_file.read_text(encoding='utf-8') if args.notes_file else f"{CHANNELS[args.channel]['name']} {args.version}"
    if args.publish or args.draft:
        existing = release_metadata(args.repo, f'v{args.version}')
        if existing and not existing['draft']:
            parser.error('This version is already published. Use a higher version for a new build.')
        previous = subprocess.run(['gh', 'api', f'repos/{args.repo}/releases/latest'], capture_output=True, text=True)
        if previous.returncode != 0 and '(HTTP 404)' not in previous.stderr:
            parser.error('Could not check the latest release; verify GitHub access before building')
        if previous.returncode == 0 and version_tuple(args.version) <= version_tuple(json.loads(previous.stdout)['tag_name']):
            parser.error('The new version must be higher than the latest published release')
    if args.windows_package:
        package = verify_windows_package(args.windows_package, args.version, args.sha256, args.channel)
        signer_env = env.copy()
        signer_env.pop('TAURI_SIGNING_PRIVATE_KEY', None)
        run('npm', 'run', 'tauri', '--', 'signer', 'sign', '--private-key-path', key,
            '--app-version', args.version, package, env=signer_env, capture_output=True)
        signature = Path(str(package) + '.sig')
        if not signature.is_file():
            raise RuntimeError('Tauri did not generate the Windows updater signature')
        subprocess.run(['cargo', 'run', '--quiet', '--locked', '--example', 'verify-update', *(['--features', 'dev-channel'] if args.channel == 'dev' else []), '--', str(package), args.version],
                       cwd=ROOT / 'src-tauri', env=env, check=True)
        print(f'Signed update package: {package}')
        if args.publish or args.draft:
            upload_release(args.repo, args.version, notes, 'windows-x86_64', package, signature, args.publish, args.public, args.channel)
        else:
            print('Prepared locally. Nothing was uploaded. Use --draft to stage the signed package privately.')
        return
    if platform.system() == 'Darwin':
        run('npm', 'run', 'prepare:native', env=env)
        bundles = 'app'
        target = 'darwin-aarch64' if platform.machine() == 'arm64' else 'darwin-x86_64'
    elif platform.system() == 'Windows':
        if platform.machine().lower() not in {'amd64', 'x86_64'}:
            parser.error('The Windows release workflow currently supports x64 only')
        bundles, target = 'nsis', 'windows-x86_64'
    else:
        parser.error('This release workflow currently supports macOS and Windows')
    # A file avoids JSON quoting differences between Windows cmd and Unix shells.
    with tempfile.TemporaryDirectory(prefix='no-tipe-build-') as temporary:
        config = Path(temporary) / 'release.json'
        config.write_text(json.dumps(build_config(args.channel, args.version, updater=True)), encoding='utf-8')
        build = ['npm', 'run', 'tauri', '--', 'build', '--bundles', bundles, '--config', config]
        if args.debug:
            build.append('--debug')
        build.extend(['--', '--locked'])
        run(*build, env=env)
    profile = 'debug' if args.debug else 'release'
    output = ROOT / f'src-tauri/target/{profile}/bundle'
    if bundles == 'app':
        package = output / f"macos/{CHANNELS[args.channel]['name']}.app.tar.gz"
    else:
        candidates = list((output / 'nsis').glob(f'*{args.version}*-setup.exe'))
        if len(candidates) != 1:
            raise RuntimeError('Expected exactly one Windows NSIS installer for this version')
        package = candidates[0]
    signature = Path(str(package) + '.sig')
    if not package.is_file() or not signature.is_file():
        raise RuntimeError('Tauri did not generate a signed updater package')
    if not args.debug:
        run(sys.executable, 'scripts/verify-distribution.py', '--frontend', ROOT / 'dist')
        if bundles == 'app':
            run(sys.executable, 'scripts/verify-distribution.py', '--bundle', output / f"macos/{CHANNELS[args.channel]['name']}.app", '--channel', args.channel)
    subprocess.run(['cargo', 'run', '--quiet', '--locked', '--example', 'verify-update', *(['--features', 'dev-channel'] if args.channel == 'dev' else []), '--', str(package), args.version], cwd=ROOT / 'src-tauri', env=env, check=True)
    if bundles == 'app':
        # The updater archive is sufficient; do not leave another discoverable
        # .app in the source tree after every release build.
        import plistlib
        bundle = output / f"macos/{CHANNELS[args.channel]['name']}.app"
        if plistlib.loads((bundle / 'Contents/Info.plist').read_bytes()).get('CFBundleIdentifier') != CHANNELS[args.channel]['identifier']:
            raise RuntimeError('Unexpected bundle identity')
        subprocess.run(['/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', '-u', str(bundle)], capture_output=True)
        shutil.rmtree(bundle)
    print(f'Signed update package: {package}')
    if not args.publish and not args.draft:
        print('Prepared locally. Nothing was uploaded. Use --draft to stage the signed package privately.')
        return
    upload_release(args.repo, args.version, notes, target, package, signature, args.publish, args.public, args.channel)


if __name__ == '__main__':
    main()
