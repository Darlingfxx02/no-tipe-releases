#!/usr/bin/env python3
"""Prepare pinned Windows Vulkan build tools and an app-local loader.

The SDK is copied into build output without changing system drivers, PATH or
registry. Only the small, statically CRT-linked loader and its notices ship.
"""
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
SDK_VERSION = '1.4.321.0'
SDK_SHA256 = '14ebc56ef981e03a292adadd2559fbbfcd0289ec157bfd0f0d5f9fdcb40042a9'
SOURCES = {
    'Vulkan-Headers': ('2cd90f9d20df57eac214c148f3aed885372ddcfe',
                       '60c1aa8993ca8e1cb0d20d8ceb1fa0e538525fb7f12535e99de3b31bcfc49d11'),
    'Vulkan-Loader': ('da8d2caad9341ca8c5a7c3deba217d7da50a7c24',
                      'e93eb4da6488d22f15f5b03ddcfcf9d030d86a21ba45991f0848f27285015272'),
}


def download(url, destination, expected):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.is_file() or sha256(destination) != expected:
        temporary = destination.with_suffix(destination.suffix + '.partial')
        try:
            print(f'Downloading pinned {destination.name}…', flush=True)
            request = urllib.request.Request(url, headers={'User-Agent': 'No-Type-build'})
            with urllib.request.urlopen(request, timeout=90) as response, temporary.open('wb') as output:
                shutil.copyfileobj(response, output)
            if sha256(temporary) != expected:
                raise RuntimeError(f'Checksum mismatch: {destination.name}')
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
    return destination


def sha256(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def extract(archive, destination):
    with tarfile.open(archive) as source:
        members = source.getmembers()
        for member in members:
            path = PurePosixPath(member.name)
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()) or path.is_absolute() or '..' in path.parts:
                raise RuntimeError('Unsafe Vulkan source archive')
        roots = {PurePosixPath(member.name).parts[0] for member in members}
        if len(roots) != 1:
            raise RuntimeError('Expected one Vulkan source directory')
        source.extractall(destination)
    return destination / roots.pop()


def main():
    if platform.system() != 'Windows':
        return
    target = ROOT / 'src-tauri/target'
    refresh_toolchain(target)
    sdk = target / 'vulkan-sdk'
    output = target / 'vulkan-runtime'
    cache = Path.home() / '.cache/no-tipe/vulkan' / SDK_VERSION
    cache.mkdir(parents=True, exist_ok=True)
    stamp = {'sdk': SDK_VERSION, 'sdk_sha256': SDK_SHA256, 'sources': SOURCES,
             'architecture': 'x64', 'crt': 'static'}
    stamp_file = output / 'build.json'
    required = ['Bin/glslc.exe', 'Lib/vulkan-1.lib', 'Include/vulkan/vulkan.hpp']
    if stamp_file.is_file() and json.loads(stamp_file.read_text()) == json.loads(json.dumps(stamp)) and all((sdk / file).is_file() for file in required) and all((output / file).is_file() for file in ['vulkan-1.dll', 'Vulkan-NOTICES.txt']):
        copy_for_tests(output, target)
        print('Windows Whisper Vulkan runtime is current.', flush=True)
        return
    if not all((sdk / file).is_file() for file in required):
        installer = download(f'https://sdk.lunarg.com/sdk/download/{SDK_VERSION}/windows/vulkan_sdk.exe',
                             cache / 'vulkan-sdk.exe', SDK_SHA256)
        subprocess.run([str(installer), '--root', str(sdk), '--accept-licenses',
                        '--default-answer', '--confirm-command', 'install', 'copy_only=1'], check=True)
    if not all((sdk / file).is_file() for file in required):
        raise RuntimeError('Pinned Vulkan SDK is incomplete')
    sources = {}
    for name, (commit, checksum) in SOURCES.items():
        archive = download(f'https://api.github.com/repos/KhronosGroup/{name}/tarball/{commit}',
                           cache / (name + '.tar.gz'), checksum)
        directory = cache / (name + '-source')
        if not directory.is_dir():
            temporary = cache / (name + '-extract')
            temporary.mkdir(exist_ok=True)
            extract(archive, temporary).rename(directory)
            temporary.rmdir()
        sources[name] = directory
    headers = target / 'vulkan-headers'
    headers_build = target / 'vulkan-headers-build'
    subprocess.run(['cmake', '-S', str(sources['Vulkan-Headers']), '-B', str(headers_build),
                    '-A', 'x64', f'-DCMAKE_INSTALL_PREFIX={headers}', '-DVULKAN_HEADERS_ENABLE_TESTS=OFF'], check=True)
    subprocess.run(['cmake', '--install', str(headers_build), '--config', 'Release'], check=True)
    loader_build = target / 'vulkan-loader-build'
    subprocess.run(['cmake', '-S', str(sources['Vulkan-Loader']), '-B', str(loader_build),
                    '-A', 'x64', f'-DVULKAN_HEADERS_INSTALL_DIR={headers}',
                    '-DBUILD_TESTS=OFF', '-DUPDATE_DEPS=OFF'], check=True)
    subprocess.run(['cmake', '--build', str(loader_build), '--config', 'Release',
                    '--parallel', str(min(os.cpu_count() or 2, 8))], check=True)
    loader = loader_build / 'loader/Release/vulkan-1.dll'
    if not loader.is_file():
        raise RuntimeError('The Windows Vulkan loader was not built')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(loader, output / 'vulkan-1.dll')
    notices = []
    for name, source in sources.items():
        notices.append(name + ' (Vulkan SDK ' + SDK_VERSION + ')')
        for license_file in sorted(source.glob('LICENSE*')):
            if license_file.is_file():
                notices.append(license_file.name + '\n' + license_file.read_text(encoding='utf-8'))
        # The loader's Apache license explicitly excludes a few MIT sources.
        # Preserve their complete original permission/copyright headers too.
        if name == 'Vulkan-Loader':
            for file in sorted((source / 'loader').rglob('*')):
                if file.is_file() and file.suffix in ['.c', '.h']:
                    header = re.match(r'\s*/\*.*?\*/', file.read_text(encoding='utf-8'), re.S)
                    if header and 'Permission is hereby granted' in header.group():
                        notices.append(str(file.relative_to(source)) + '\n' + header.group())
    (output / 'Vulkan-NOTICES.txt').write_text('\n\n'.join(notices), encoding='utf-8')
    stamp_file.write_text(json.dumps(stamp), encoding='utf-8')
    copy_for_tests(output, target)
    print('Prepared Windows Whisper GPU acceleration and CPU fallback.', flush=True)


def refresh_toolchain(target):
    # CMake only reads a new toolchain during its initial configuration. A
    # restored Cargo cache may still contain the old nested shader paths.
    # Invalidate only Whisper's generated output when our toolchain changes.
    expected = sha256(ROOT / 'cmake/windows-whisper.cmake')
    stamp = target / 'whisper-toolchain.sha256'
    if stamp.is_file() and stamp.read_text() == expected:
        return
    for profile in ['debug', 'release']:
        for directory in (target / profile / 'build').glob('whisper-rs-sys-*/out/build'):
            shutil.rmtree(directory)
        for directory in (target / profile / '.fingerprint').glob('whisper-rs-sys-*'):
            shutil.rmtree(directory)
    target.mkdir(parents=True, exist_ok=True)
    stamp.write_text(expected)
    print('Refreshed Windows Whisper CMake configuration.', flush=True)


def copy_for_tests(output, target):
    # Cargo tests execute next to deps/, rather than the Tauri resource folder.
    for configuration in ['debug', 'release']:
        for directory in [target / configuration, target / configuration / 'deps']:
            directory.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(output / 'vulkan-1.dll', directory / 'vulkan-1.dll')


if __name__ == '__main__':
    main()
