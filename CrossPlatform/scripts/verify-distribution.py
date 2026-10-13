#!/usr/bin/env python3
"""Reject source files, signing secrets and debug output in distribution builds."""
from channels import CHANNELS
import argparse
import plistlib
import re
import subprocess
from pathlib import Path

SOURCE_SUFFIXES = {'.ts', '.tsx', '.rs', '.swift', '.m', '.mm', '.h', '.c', '.cpp', '.py', '.sh', '.ps1', '.map', '.dsym', '.profraw', '.profdata'}
SECRET_SUFFIXES = {'.key', '.p12', '.pfx', '.pem'}
FORBIDDEN_DIRS = {'.git', 'node_modules', 'src', 'tests', 'generated', '.dsym'}
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def verify_symbols(symbols, binary_name):
    # Legacy Rust and C++ both use the Itanium _ZN prefix. Rust additionally
    # ends the mangled path with a 16-digit hash; third-party C++ exports are valid.
    if re.search(r'\s[tT]\s+(?:__?ZN\S*17h[0-9a-f]{16}E|__?R[sv]|_\$s)', symbols):
        raise RuntimeError(f'Unstripped Rust or Swift symbols in {binary_name}')


def verify_project_notices(root, frontend=False):
    for name in ['LICENSE', 'NOTICE']:
        path = root / (f'{name}.txt' if frontend else name)
        if not path.is_file() or path.read_bytes() != (PROJECT_ROOT / name).read_bytes():
            raise RuntimeError(f'Missing or outdated No Type {name}: {path.name}')


def verify_files(root):
    if not root.is_dir():
        raise RuntimeError(f'Missing distribution directory: {root}')
    for path in root.rglob('*'):
        relative = path.relative_to(root)
        if path.is_symlink():
            raise RuntimeError(f'Symbolic link in distribution: {relative}')
        if {part.lower() for part in relative.parts} & FORBIDDEN_DIRS or any(Path(part).suffix.lower() == '.dsym' for part in relative.parts) or path.suffix.lower() in SOURCE_SUFFIXES | SECRET_SUFFIXES or path.name == '.env' or path.name.startswith('.env.'):
            raise RuntimeError(f'Source, debug output or signing secret in distribution: {relative}')
        if path.is_file() and path.suffix in {'.html', '.js', '.css'}:
            content = path.read_text(encoding='utf-8')
            if re.search(r'(?:/{2}|/\*)[#@]\s*sourceMappingURL\s*=', content):
                raise RuntimeError(f'Source map reference in distribution: {relative}')
            if 'data:application/json;base64,' in content and 'sourceMappingURL' in content:
                raise RuntimeError(f'Inline source map in distribution: {relative}')
        if path.is_file() and path.suffix.lower() in {'.txt', '.json', '.html', '.js', '.css', '.plist'}:
            if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----', path.read_bytes()):
                raise RuntimeError(f'Private key content in distribution: {relative}')


def verify_bundle(bundle, channel='stable'):
    verify_files(bundle)
    info = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != CHANNELS[channel]['identifier']:
        raise RuntimeError('Unexpected application identifier')
    binaries = [bundle / 'Contents/MacOS' / info['CFBundleExecutable'],
                bundle / 'Contents/Resources/local-text/no-tipe-text',
                bundle / 'Contents/Resources/platform/no-tipe-platform',
                bundle / 'Contents/Resources/platform/libno-tipe-media.dylib']
    for binary in binaries:
        if not binary.is_file():
            raise RuntimeError(f'Missing application binary: {binary.name}')
        load_commands = subprocess.run(['xcrun', 'otool', '-l', str(binary)], check=True, capture_output=True, text=True).stdout
        if '__DWARF' in load_commands:
            raise RuntimeError(f'Debug information in {binary.name}')
        symbols = subprocess.run(['xcrun', 'nm', '-U', str(binary)], check=True, capture_output=True, text=True).stdout
        verify_symbols(symbols, binary.name)
    for notice in ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md', 'local-text/llama.cpp-LICENSE.txt', 'speech-runtime/sherpa-onnx-NOTICES.txt', 'platform/MediaRemote-NOTICE.txt', 'platform/mediaremote-run.pl']:
        if not (bundle / 'Contents/Resources' / notice).is_file():
            raise RuntimeError(f'Missing license notice: {notice}')
    verify_project_notices(bundle / 'Contents/Resources')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channel', choices=CHANNELS, default='stable')
    parser.add_argument('--frontend', type=Path)
    parser.add_argument('--bundle', type=Path)
    args = parser.parse_args()
    if not args.frontend and not args.bundle:
        parser.error('Pass --frontend or --bundle')
    if args.frontend:
        verify_files(args.frontend)
        if (args.frontend / 'notch-demo.html').exists():
            raise RuntimeError('The recorder demo must not be shipped')
        if not (args.frontend / 'THIRD-PARTY-LICENSES.txt').is_file():
            raise RuntimeError('Missing third-party license texts')
        verify_project_notices(args.frontend, frontend=True)
    if args.bundle:
        verify_bundle(args.bundle, args.channel)
    print('Distribution verified: no source files, source maps or signing keys.' + (' Debug symbols removed; code signature valid.' if args.bundle else ''))


if __name__ == '__main__':
    main()
