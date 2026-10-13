#!/usr/bin/env python3
"""Ship the Apache 2.0 license, attribution and original dependency notices."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def license_files(directory):
    for path in sorted(directory.iterdir()):
        if path.name.upper().startswith(('LICENSE', 'LICENCE', 'COPYING', 'NOTICE', 'COPYRIGHT')):
            if path.is_file():
                yield path
            elif path.is_dir():
                yield from sorted(item for item in path.rglob('*') if item.is_file())


def notice(name, version, license_name, directory, license_file=None):
    files = list(license_files(directory))
    if license_file:
        file = directory / license_file
        if file.is_file() and file not in files:
            files.append(file)
    result = [f'{name} {version}', f'License: {license_name or "See original notices"}']
    for path in files:
        result.extend([f'--- {path.relative_to(directory)} ---', path.read_text(encoding='utf-8', errors='replace')])
    return '\n'.join(result)


def main():
    env = os.environ.copy()
    env['PATH'] = str(Path.home() / '.cargo/bin') + os.pathsep + env['PATH']
    host = subprocess.run(['rustc', '-vV'], env=env, check=True, capture_output=True, text=True).stdout
    target = next(line.removeprefix('host: ') for line in host.splitlines() if line.startswith('host: '))
    metadata = json.loads(subprocess.run(['cargo', 'metadata', '--locked', '--format-version', '1', '--filter-platform', target],
        cwd=ROOT / 'src-tauri', env=env, check=True, capture_output=True, text=True).stdout)
    nodes = {node['id']: node for node in metadata['resolve']['nodes']}
    root = metadata['resolve']['root']
    pending, used = [root], set()
    while pending:
        identifier = pending.pop()
        if identifier in used:
            continue
        used.add(identifier)
        pending.extend(dep['pkg'] for dep in nodes[identifier]['deps'] if any(kind['kind'] is None for kind in dep['dep_kinds']))
    entries = []
    for package in sorted(metadata['packages'], key=lambda package: (package['name'], package['version'])):
        if package['id'] in used and package['id'] != root:
            entries.append(notice(package['name'], package['version'], package['license'], Path(package['manifest_path']).parent, package['license_file']))
    lock = json.loads((ROOT / 'package-lock.json').read_text(encoding='utf-8'))
    for relative, package in sorted(lock['packages'].items()):
        if not relative or package.get('dev'):
            continue
        directory = ROOT / relative
        if (directory / 'package.json').is_file():
            details = json.loads((directory / 'package.json').read_text(encoding='utf-8'))
            entries.append(notice(details['name'], details['version'], details.get('license'), directory))
    entries.append((ROOT / 'native/mediaremote-adapter/NOTICE.txt').read_text(encoding='utf-8'))
    entries.append((ROOT / 'public/fonts/Inter-LICENSE.txt').read_text(encoding='utf-8'))
    entries.append((ROOT / 'public/assets/mode-icons/LICENSE.txt').read_text(encoding='utf-8'))
    text_runtime = ROOT / 'src-tauri/local-text/llama.cpp-LICENSE.txt'
    if text_runtime.is_file():
        entries.append('llama.cpp v0.5.0\n' + text_runtime.read_text(encoding='utf-8'))
    speech_runtime = ROOT / 'src-tauri/speech-runtime/sherpa-onnx-NOTICES.txt'
    if not speech_runtime.is_file():
        raise RuntimeError('Prepare the speech runtime before building its notices')
    entries.append(speech_runtime.read_text(encoding='utf-8'))
    vulkan_notices = ROOT / 'src-tauri/target/vulkan-runtime/Vulkan-NOTICES.txt'
    if sys.platform == 'win32':
        if not vulkan_notices.is_file():
            raise RuntimeError('Prepare the Windows Whisper runtime before building its notices')
        entries.append(vulkan_notices.read_text(encoding='utf-8'))
    entries.append((ROOT / 'public/Qwen-LICENSE.txt').read_text(encoding='utf-8'))
    entries.append('Tauri CLI 2.12.0 NSIS installer template (MIT)\n' + (ROOT / 'src-tauri/installer/TAURI-LICENSE.txt').read_text(encoding='utf-8'))
    destination = ROOT / 'public/THIRD-PARTY-LICENSES.txt'
    destination.write_text('Third-party software used by No Type retains its own licenses.\n\n' + '\n\n' + ('\n\n' + '=' * 72 + '\n\n').join(entries), encoding='utf-8')
    shutil.copyfile(ROOT.parent / 'LICENSE', ROOT / 'public/LICENSE.txt')
    shutil.copyfile(ROOT.parent / 'NOTICE', ROOT / 'public/NOTICE.txt')
    print(f'Prepared {len(entries)} third-party license notices for distribution.')


if __name__ == '__main__':
    main()
