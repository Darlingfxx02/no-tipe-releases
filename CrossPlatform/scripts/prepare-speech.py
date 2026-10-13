#!/usr/bin/env python3
"""Prepare the pinned ASR-only sherpa-onnx runtime; no TTS libraries are linked."""
import hashlib
import json
import platform
import shutil
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.13.8'
SOURCE_SHA256 = 'b0374cc56dbc186d442ae73d5de743bb092470b640c4c50ce7b029044c0c4fa8'
ARCHIVES = {
    ('Darwin', 'arm64'): ('osx-arm64-static-no-tts-lib', '3d7f9b8a496694af13d9802c33b8133231e397bdef302f543d19468765e83136'),
    ('Darwin', 'x86_64'): ('osx-x64-static-no-tts-lib', '8ffc3ede9f997fec547b5c99b8e2073b8e04fd48a5f65e1a6d5d314ad0106ad9'),
    # Match Rust/cc's dynamic MSVC CRT even though the ASR libraries are static.
    ('Windows', 'amd64'): ('win-x64-static-MD-Release-no-tts-lib', '542348e56e827b59c6d249fd0dfd38dc34b7bd0c521a1ebe9eb6e2db154fa15d'),
    ('Windows', 'arm64'): ('win-arm64-static-MD-Release-no-tts-lib', '2cd45adcfe4eb4f9f6ae9b37eab03609ab0f9eb624d126a7e10e36eb666a4703'),
}

def obtain(url, destination, checksum):
    if not destination.exists():
        pending = destination.with_suffix(destination.suffix + '.part')
        subprocess.run(['curl', '-fsSL', '--retry-all-errors', '--retry', '4', '--connect-timeout', '15',
                        '--max-time', '180', '-o', str(pending), url], check=True)
        pending.replace(destination)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != checksum:
        destination.unlink()
        raise RuntimeError('Speech runtime checksum mismatch; rebuild to download it again')

def main():
    key = (platform.system(), platform.machine().lower())
    if key not in ARCHIVES:
        raise RuntimeError(f'The speech runtime does not support {key}')
    suffix, checksum = ARCHIVES[key]
    name = f'sherpa-onnx-v{VERSION}-{suffix}'
    cache = Path.home() / '.cache/no-tipe/sherpa-onnx' / VERSION
    cache.mkdir(parents=True, exist_ok=True)
    output = ROOT / 'src-tauri/speech-runtime'
    stamp = {'version': VERSION, 'archive': name, 'sha256': checksum}
    stamp_path = output / 'build.json'
    extension = '.lib' if platform.system() == 'Windows' else '.a'
    prefix = '' if platform.system() == 'Windows' else 'lib'
    output.mkdir(parents=True, exist_ok=True)
    notices = [path.read_text() for path in sorted((ROOT / 'native/speech-licenses').glob('*.txt'))]
    if not notices:
        raise RuntimeError('Speech runtime license notices are missing')
    (output / 'sherpa-onnx-NOTICES.txt').write_text('\n\n'.join(notices))
    if stamp_path.is_file() and json.loads(stamp_path.read_text()) == stamp and (output / 'include/c-api.h').is_file() and (output / 'lib' / f'{prefix}onnxruntime{extension}').is_file():
        print('Bundled speech runtime is current.', flush=True)
        return
    archive = cache / (name + '.tar.bz2')
    obtain(f'https://github.com/k2-fsa/sherpa-onnx/releases/download/v{VERSION}/{archive.name}', archive, checksum)
    output.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            parts = PurePosixPath(member.name).parts
            if member.issym() or member.islnk() or '..' in parts or member.name.startswith('/'):
                raise RuntimeError('Unsafe speech runtime archive')
            if member.isfile() and len(parts) == 3 and parts[:2] == (name, 'lib'):
                target = output / 'lib' / parts[-1]
                target.parent.mkdir(exist_ok=True)
                with tar.extractfile(member) as source, target.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
    source = cache / 'source.tar.gz'
    obtain(f'https://codeload.github.com/k2-fsa/sherpa-onnx/tar.gz/refs/tags/v{VERSION}', source, SOURCE_SHA256)
    with tarfile.open(source) as tar:
        header = tar.extractfile(f'sherpa-onnx-{VERSION}/sherpa-onnx/c-api/c-api.h').read()
    (output / 'include').mkdir(exist_ok=True)
    (output / 'include/c-api.h').write_bytes(header)
    stamp_path.write_text(json.dumps(stamp))
    print('Prepared the bundled ASR speech runtime.', flush=True)

if __name__ == '__main__':
    main()
