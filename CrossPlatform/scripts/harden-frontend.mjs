// Vite copies public/cloud.html verbatim. Minify its inline recorder scripts
// too, without changing the shared source used for development and previews.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'vite';

function obscure(source) {
  // Keep third-party legal notices even when the obfuscator removes comments.
  const notices = [...source.matchAll(/\/\*![\s\S]*?\*\//g)].map(match => match[0]).join('\n');
  const code = JavaScriptObfuscator.obfuscate(source, {
    target: 'browser-no-eval', compact: true, sourceMap: false,
    seed: createHash('sha256').update(source).digest().readUInt32BE(0),
    identifierNamesGenerator: 'hexadecimal', renameGlobals: false,
    renameProperties: false, transformObjectKeys: false, ignoreImports: true,
    stringArray: true, stringArrayEncoding: [], stringArrayThreshold: 0.75,
    reservedStrings: ['^[\\s\\S]{512,}$'],
    // Keep recording/rendering responsive; avoid expensive or intrusive tricks.
    controlFlowFlattening: false, deadCodeInjection: false, debugProtection: false,
    selfDefending: false, disableConsoleOutput: false, splitStrings: false,
  }).getObfuscatedCode();
  return notices ? `${notices}\n${code}` : code;
}

const assets = new URL('../dist/assets/', import.meta.url);
let count = 0;
for (const entry of await readdir(assets, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const file = new URL(entry.name, assets);
  await writeFile(file, obscure(await readFile(file, 'utf8')));
  count++;
}
if (!count) throw new Error('No bundled application scripts were found');

const path = new URL('../dist/cloud.html', import.meta.url);
let html = await readFile(path, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (!scripts.length) throw new Error('The bundled cloud renderer has no inline scripts');
// Independent scripts share global bindings. Preserve those names and avoid
// removing globals that are used by a later script or native callbacks.
for (const match of scripts.reverse()) {
  const result = await minify('cloud.js', match[1], {
    module: false,
    compress: { target: ['es2022', 'safari15'], unused: false },
    mangle: { toplevel: false },
    sourcemap: false,
    codegen: { legalComments: 'inline' },
  });
  if (result.errors.length) throw new Error('Could not minify the cloud renderer');
  const script = `<script>${obscure(result.code).replace(/<\/script/gi, '<\\/script')}</script>`;
  html = html.slice(0, match.index) + script + html.slice(match.index + match[0].length);
}
await writeFile(path, html);
console.log(`Obfuscated ${count} application bundles and ${scripts.length} recorder scripts without source maps.`);
