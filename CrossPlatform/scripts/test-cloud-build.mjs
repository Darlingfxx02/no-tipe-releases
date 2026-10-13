import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

test('Windows CRLF inputs generate the same working recorder as LF inputs', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), 'no-tipe-recorder-build-'));
  try {
    const generated = ['lf', 'crlf'].map(style => {
      const fixture = join(temporary, style);
      const inputs = [
        'CrossPlatform/scripts/build-cloud.mjs', 'CrossPlatform/scripts/pixel-cloud.mjs', 'CrossPlatform/scripts/localize-cloud.mjs', 'CrossPlatform/scripts/empower-cloud.mjs',
        'CrossPlatform/src/recorder/nativeBridge.js', 'CrossPlatform/src/recorder/drag.js',
        'CrossPlatform/src/locales/en.json','CrossPlatform/src/locales/ru.json',
        'CrossPlatform/node_modules/i18next/dist/umd/i18next.min.js',
        'CrossPlatform/src/accentMaterials.json',
        'CrossPlatform/src/recorder/themeOverrides.json',
        ...['vectors', 'ink', 'motion', 'processing', 'surface', 'empowerment', 'pixels', 'themeMaterial'].map(name => `CrossPlatform/src/recorder/${name}.js`),
        'NoTipe/Resources/CloudRecorder/CloudRecorder.html',
      ];
      for (const input of inputs) {
        const destination = join(fixture, input);
        mkdirSync(dirname(destination), { recursive: true });
        const text = readFileSync(join(root, '..', input), 'utf8').replace(/\r\n?/g, '\n');
        writeFileSync(destination, style === 'crlf' ? text.replace(/\n/g, '\r\n') : text);
      }
      mkdirSync(join(fixture, 'CrossPlatform/public'), { recursive: true });
      execFileSync(process.execPath, [join(fixture, 'CrossPlatform/scripts/build-cloud.mjs')]);
      const html = readFileSync(join(fixture, 'CrossPlatform/public/cloud.html'), 'utf8');
      for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
      return { html, wave: readFileSync(join(fixture, 'CrossPlatform/src/generated/cloudWave.json'), 'utf8'), glass: readFileSync(join(fixture, 'CrossPlatform/src/generated/cloudGlass.json'), 'utf8') };
    });
    deepStrictEqual(generated[1], generated[0]);
    const digest = text => createHash('sha256').update(text).digest('hex');
    strictEqual(digest(readFileSync(join(root, 'public/cloud.html'), 'utf8')), digest(generated[0].html),
      'public/cloud.html must match the cloud generator, including the native bridge');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
