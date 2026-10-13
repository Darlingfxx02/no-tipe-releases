#!/usr/bin/env python3
"""Build the small native NSIS UI plugin on Windows; leave other platforms alone."""
import os
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / 'src-tauri/installer'


def main():
    if platform.system() != 'Windows':
        return
    subprocess.run([sys.executable, str(ROOT / 'scripts/prepare-whisper.py')], check=True)
    output = INSTALLER / 'generated'
    output.mkdir(exist_ok=True)
    vswhere = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Microsoft Visual Studio/Installer/vswhere.exe'
    if not vswhere.is_file():
        raise RuntimeError('Visual Studio C++ Build Tools are required for the Windows installer')
    visual_studio = subprocess.check_output([str(vswhere), '-latest', '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath'], text=True).strip()
    if not visual_studio:
        raise RuntimeError('Install the Visual Studio C++ x86/x64 build tools')
    vcvars = Path(visual_studio) / 'VC/Auxiliary/Build/vcvarsall.bat'
    # A .cmd file preserves quoting across Python, cmd.exe and cl.exe.
    command = output / 'build-ui.cmd'
    command.write_text(
        f'@echo off\ncall "{vcvars}" x86 >nul\nif errorlevel 1 exit /b 1\n'
        f'cl /nologo /O2 /MT /W4 /LD /utf-8 "{INSTALLER / "no-tipe-ui.c"}" '
        f'/link /DEF:"{INSTALLER / "no-tipe-ui.def"}" /OUT:no_tipe_ui.dll '
        'user32.lib gdi32.lib comctl32.lib uxtheme.lib dwmapi.lib\n', encoding='utf-8')
    subprocess.run([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c', str(command)],
                   cwd=output, check=True)
    # Tauri canonicalizes this hook path, so packaging also works from a CI cache.
    hook = f'!addplugindir /x86-unicode "{output}"\n!include "{INSTALLER / "no-tipe-ui.nsh"}"\n'
    (output / 'no-tipe-ui.nsh').write_text(hook, encoding='utf-8-sig')
    print('Prepared the native No Type Windows installer UI.')


if __name__ == '__main__':
    main()
