import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const icon = fileURLToPath(new URL('../../DesignAssets/no-tipe-app-icon.svg', import.meta.url));
const mark = fileURLToPath(new URL('../../DesignAssets/no-tipe-mark.svg', import.meta.url));
const run = (...args) => execFileSync('npm', ['run', 'tauri', '--', 'icon', ...args], { cwd: project, stdio: 'inherit' });
run(icon, '--output', 'src-tauri/icons');
run(mark, '--output', '../DesignAssets/no-tipe-tray', '--png', '44');
run(icon, '--output', '../DesignAssets/no-tipe-sizes', ...[16, 32, 64, 128, 256, 512, 1024].flatMap(size => ['--png', String(size)]));
copyFileSync(new URL('../../DesignAssets/no-tipe-tray/44x44.png', import.meta.url), new URL('../src-tauri/icons/tray.png', import.meta.url));
copyFileSync(new URL('../../DesignAssets/no-tipe-sizes/128x128.png', import.meta.url), new URL('../public/assets/no-tipe-icon.png', import.meta.url));
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  copyFileSync(new URL(`../../DesignAssets/no-tipe-sizes/${size}x${size}.png`, import.meta.url), new URL(`../../NoTipe/Assets.xcassets/AppIcon.appiconset/${size}-mac.png`, import.meta.url));
}
