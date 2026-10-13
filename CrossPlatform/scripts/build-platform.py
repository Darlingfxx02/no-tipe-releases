#!/usr/bin/env python3
"""Build only the OS adapter. Domain/UI logic stays in Rust/TypeScript."""
import os,sys,subprocess,platform
from pathlib import Path
root=Path(__file__).resolve().parents[2]
out=root/'CrossPlatform/src-tauri/platform'
out.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,str(root/'CrossPlatform/scripts/build-local-text.py')],check=True)
subprocess.run([sys.executable,str(root/'CrossPlatform/scripts/prepare-speech.py')],check=True)
if sys.platform!='darwin': sys.exit(0)
env=os.environ.copy()
if 'DEVELOPER_DIR' not in env and Path('/Users/darlingfxx/Downloads/Xcode-beta.app/Contents/Developer').exists():env['DEVELOPER_DIR']='/Users/darlingfxx/Downloads/Xcode-beta.app/Contents/Developer'
architecture='arm64' if platform.machine()=='arm64' else 'x86_64'
subprocess.run(['xcrun','swiftc','-O','-parse-as-library','-target',f'{architecture}-apple-macos13.0',*[str(root/'CrossPlatform/native'/name) for name in ['MacAdapter.swift','GigaAM.swift','GigaAMAssets.swift']],'-o',str(out/'no-tipe-platform')],env=env,check=True)
subprocess.run(['xcrun', 'strip', '-x', str(out/'no-tipe-platform')], env=env, check=True)

media=root/'CrossPlatform/native/mediaremote-adapter'
subprocess.run(['xcrun','clang','-O2','-dynamiclib','-fblocks','-framework','AppKit','-framework','Foundation','-I',str(media),*[str(media/name) for name in ['MediaRemote.m','MediaRemoteAdapter.m','MediaRemoteAdapterKeys.m']],'-o',str(out/'libno-tipe-media.dylib')],env=env,check=True)
subprocess.run(['xcrun', 'strip', '-x', str(out/'libno-tipe-media.dylib')], env=env, check=True)
(out/'mediaremote-run.pl').write_bytes((media/'run.pl').read_bytes())
(out/'MediaRemote-NOTICE.txt').write_bytes((media/'NOTICE.txt').read_bytes())
