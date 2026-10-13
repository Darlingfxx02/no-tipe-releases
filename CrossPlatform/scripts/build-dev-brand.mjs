import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'src-tauri/icons-dev');
const temporary = mkdtempSync(join(tmpdir(), 'no-type-dev-icon-'));
try {
  execFileSync(process.execPath, [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'icon', '../DesignAssets/no-type-dev-app-icon.svg', '--output', temporary], { cwd: root, stdio: 'inherit' });
  mkdirSync(output, { recursive: true });
  for (const name of ['icon.png', 'icon.icns', 'icon.ico']) copyFileSync(join(temporary, name), join(output, name));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
