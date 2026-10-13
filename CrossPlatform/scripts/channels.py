"""One explicit distribution channel per build, installer and release."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANNELS = {
    'stable': {'name': 'No Type', 'identifier': 'app.no-tipe.desktop',
               'repo': 'Darlingfxx02/no-tipe-releases', 'asset': 'NoType'},
    'dev': {'name': 'No Type Dev', 'identifier': 'app.no-tipe.desktop.dev',
            'repo': 'Darlingfxx02/no-tipe-dev-releases', 'asset': 'NoTypeDev'},
}


def build_config(channel, version=None, updater=False):
    config = json.loads((ROOT / 'src-tauri/tauri.dev.conf.json').read_text()) if channel == 'dev' else {}
    if version:
        config['version'] = version
    config.setdefault('bundle', {})['createUpdaterArtifacts'] = updater
    return config
