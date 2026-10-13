#!/usr/bin/env python3
"""Build the pinned, self-contained llama.cpp runtime shipped with No Type."""
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
COMMIT = 'd2e54583c7452353eb35d40431281f6ee984332f'  # llama.cpp v0.5.0
ARCHIVE_SHA256 = '8aeb94872f97ddc9c80bca3824d95aba00bdb17d1d28813db22150fb6caf6d15'


def write_architectures(source, destination):
    values = re.findall(r'\{ LLM_ARCH_[A-Z0-9_]+,\s*"([^\"]+)"', (source / 'src/llama-arch.cpp').read_text())
    data = (json.dumps(values, indent=2) + '\n').encode('utf-8')
    if not destination.is_file() or destination.read_bytes() != data:
        destination.write_bytes(data)


def main():
    cache = Path.home() / '.cache/no-tipe/llama.cpp' / COMMIT
    cache.mkdir(parents=True, exist_ok=True)
    source = cache / ('llama.cpp-' + COMMIT)
    output = ROOT / 'src-tauri/local-text'
    binary_name = 'no-tipe-text.exe' if sys.platform == 'win32' else 'no-tipe-text'
    stamp = {'commit': COMMIT, 'platform': sys.platform, 'architecture': platform.machine()}
    stamp_path = output / 'build.json'
    architectures = ROOT / 'src-tauri/text-model-architectures.json'
    if source.exists():
        write_architectures(source, architectures)
    if stamp_path.exists() and json.loads(stamp_path.read_text()) == stamp and (output / binary_name).is_file():
        print('Bundled text runtime is current.', flush=True)
        return
    archive = cache / 'source.tar.gz'
    if not archive.exists():
        print('Downloading pinned llama.cpp source for the build…', flush=True)
        urllib.request.urlretrieve('https://codeload.github.com/ggml-org/llama.cpp/tar.gz/' + COMMIT, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        archive.unlink()
        raise RuntimeError('llama.cpp source checksum mismatch; run the build again')
    if not source.exists():
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                if member.issym() or member.islnk() or '..' in PurePosixPath(member.name).parts or member.name.startswith('/'):
                    raise RuntimeError('Unsafe llama.cpp source archive')
            tar.extractall(cache)
    write_architectures(source, architectures)
    env = os.environ.copy()
    xcode = Path('/Users/darlingfxx/Downloads/Xcode-beta.app/Contents/Developer')
    if sys.platform == 'darwin' and 'DEVELOPER_DIR' not in env and xcode.exists():
        env['DEVELOPER_DIR'] = str(xcode)
    build = cache / ('build-' + sys.platform + '-' + platform.machine())
    args = ['cmake', '-S', str(source), '-B', str(build), '-DCMAKE_BUILD_TYPE=Release',
            '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DLLAMA_BUILD_TESTS=OFF',
            '-DLLAMA_BUILD_EXAMPLES=OFF', '-DLLAMA_BUILD_TOOLS=ON', '-DLLAMA_BUILD_SERVER=ON',
            '-DLLAMA_BUILD_APP=OFF', '-DLLAMA_CURL=OFF', '-DLLAMA_OPENSSL=OFF',
            '-DLLAMA_BUILD_WEBUI=OFF']
    if sys.platform == 'darwin':
        args += ['-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON', '-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0']
    elif sys.platform == 'win32':
        args += ['-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded', '-DGGML_OPENMP=OFF']
    subprocess.run(args, env=env, check=True)
    jobs = max(1, int(os.environ.get('CMAKE_BUILD_PARALLEL_LEVEL', min(os.cpu_count() or 2, 8))))
    subprocess.run(['cmake', '--build', str(build), '--config', 'Release', '--target', 'llama-server',
                    '--parallel', str(jobs)], env=env, check=True)
    built = build / 'bin' / ('llama-server.exe' if sys.platform == 'win32' else 'llama-server')
    if not built.exists():
        built = build / 'bin/Release/llama-server.exe'
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(built, output / binary_name)
    if sys.platform != 'win32':
        (output / binary_name).chmod(0o755)
        subprocess.run(['xcrun', 'strip', '-x', str(output / binary_name)] if sys.platform == 'darwin'
                       else ['strip', str(output / binary_name)], env=env, check=True)
    license_text = (source / 'LICENSE').read_text()
    licenses = [license_text]
    for path in sorted((source / 'vendor').rglob('LICENSE*')):
        if path.is_file():
            licenses.append(str(path.relative_to(source)) + '\n' + path.read_text(errors='replace'))
    (output / 'llama.cpp-LICENSE.txt').write_text('\n\n'.join(licenses))
    stamp_path.write_text(json.dumps(stamp))
    print('Prepared bundled text runtime.', flush=True)


if __name__ == '__main__':
    main()
