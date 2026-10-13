#!/usr/bin/env python3
"""Build and replace /Applications/No Type.app, without dated copies."""
import argparse
import json
import tempfile
from channels import CHANNELS, build_config
import os
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--channel', choices=CHANNELS, default='stable')
args = parser.parse_args()
channel = CHANNELS[args.channel]
root = Path(__file__).resolve().parents[1]
env = os.environ.copy()
env['PATH'] = f"{Path.home() / '.cargo/bin'}:{env['PATH']}"
env['RUSTFLAGS'] = (env.get('RUSTFLAGS', '') + f" --remap-path-prefix={Path.home()}=/build").strip()
xcode = Path('/Users/darlingfxx/Downloads/Xcode-beta.app/Contents/Developer')
if 'DEVELOPER_DIR' not in env and xcode.is_dir():
    env['DEVELOPER_DIR'] = str(xcode)
subprocess.run(['npm', 'run', 'prepare:native'], cwd=root, env=env, check=True)
with tempfile.TemporaryDirectory(prefix='no-type-build-') as temporary:
    config = Path(temporary) / 'channel.json'
    config.write_text(json.dumps(build_config(args.channel)), encoding='utf-8')
    subprocess.run(['npm', 'run', 'tauri', '--', 'build', '--bundles', 'app', '--config', str(config), '--', '--locked'], cwd=root, env=env, check=True)
bundle = root / f"src-tauri/target/release/bundle/macos/{channel['name']}.app"
subprocess.run(['python3', str(root / 'scripts/verify-distribution.py'), '--bundle', str(bundle), '--channel', args.channel], cwd=root, check=True)
subprocess.run(['python3', str(root / 'scripts/install-macos.py'), '--source', str(bundle), '--channel', args.channel], cwd=root, check=True)
