#!/usr/bin/env python3
"""Export reviewed application files into a separate public checkout, without Git history."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRA = {
    'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md',
    'docs/public-source/BUILDING.md', 'docs/public-source/SOURCE.md',
    'NoTipe/Resources/CloudRecorder/CloudRecorder.html',
    'NoTipe/Transcription/GigaAM/GigaAMTranscriptionService.swift',
    'NoTipe/Assets.xcassets/AppIcon.appiconset/Contents.json',
    'DesignAssets/no-tipe-app-icon.svg', 'DesignAssets/no-tipe-mark.svg',
    'DesignAssets/no-type-dev-app-icon.svg', 'Scripts/export-public-source.py',
}
FORBIDDEN = re.compile(r'(?:^|/)(?:node_modules|target|dist|artifacts|\.git|__pycache__)(?:/|$)|(?:^|/)\.env(?:\.|$)|\.(?:key|pem|p12|pfx|sqlite3|pyc|log)$')
SECRET = re.compile(rb'(?m)^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----$|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--snapshot-date', required=True)
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise SystemExit('The public checkout must be outside the development repository.')
    if not (destination / '.git').is_dir():
        raise SystemExit('Destination must be a separate Git checkout.')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.snapshot_date):
        raise SystemExit('Use YYYY-MM-DD for the snapshot date.')
    candidates = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    files = sorted({name for name in candidates if name and (name.startswith('CrossPlatform/') or name in EXTRA) and not FORBIDDEN.search(name)})
    prepared = {}
    for name in files:
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise SystemExit('Missing or symbolic source file: ' + name)
        data = source.read_bytes()
        if SECRET.search(data):
            raise SystemExit('Potential credential detected in: ' + name)
        prepared[name] = data
    for name in EXTRA:
        if name not in prepared:
            raise SystemExit('Required export input is missing: ' + name)
    # Preserve public presentation files and history. Update only the reviewed export.
    for name, data in prepared.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod((ROOT / name).stat().st_mode & 0o777)
    for name in ['BUILDING.md', 'SOURCE.md']:
        shutil.copyfile(ROOT / 'docs/public-source' / name, destination / name)
    shutil.copyfile(ROOT / '.gitignore', destination / '.gitignore')
    manifest = {
        'snapshotDate': args.snapshot_date,
        'applicationVersion': json.loads((ROOT / 'CrossPlatform/package.json').read_text())['version'],
        'files': {name: hashlib.sha256(data).hexdigest() for name, data in prepared.items()},
    }
    (destination / 'SOURCE-SNAPSHOT.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'files': len(prepared), 'bytes': sum(map(len, prepared.values())), 'destination': str(destination)}))

if __name__ == '__main__':
    main()
