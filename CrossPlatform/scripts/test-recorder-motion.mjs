import { test } from 'node:test';
import { ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the shipped renderer's geometry with frozen spring positions. The
// closing timeline and the panel's CSS resize can advance independently.
const html = readFileSync(new URL('../public/cloud.html', import.meta.url), 'utf8');
const start = html.indexOf('class AdaptiveRenderer extends Nt {');
const end = html.indexOf('const renderer=new AdaptiveRenderer(canvas);', start);
ok(start >= 0 && end > start, 'the bundled recorder contains its adaptive renderer');
const rendererClass = html.slice(start, end);

function closingLobes(scale, progress, controls = 'unified') {
  const width = (controls === 'split' ? 90 : 224) * scale, height = 63 * scale;
  const chips = [36, 96, 112].map((size, index) => ({
    offsetWidth: size, offsetHeight: 36,
    offsetLeft: [0, 44, 148][index], offsetTop: 0, style: {},
  }));
  const row = { offsetTop: -44, querySelectorAll: () => chips };
  const shell = {
    querySelector: () => row,
    getBoundingClientRect: () => ({ width, height }),
  };
  const renderer = runInNewContext(`${rendererClass}\nnew AdaptiveRenderer()`, {
    Nt: class {},
    Bt: class {
      constructor(value) { this.value = value; }
      setTarget() {}
      step() {}
      jump(value) { this.value = value; }
    },
    settingsOpen: false, translationPickerOpen: false,
    reduce: { matches: false }, paused: false,
    mix: (from, to, value) => from + (to - from) * value,
  });
  renderer.languageNodes = row;
  renderer.languageSprings.forEach(spring => { spring.value = progress; });
  renderer.updateLanguageSurface(1 / 60, shell);
  return { width, height, lobes: renderer.languageGeometry };
}

test('translation lobes return inside scaled clouds with room for the liquid merge', () => {
  for (const controls of ['unified', 'split']) for (const scale of [.6, .7, 1]) {
    const { width, height, lobes } = closingLobes(scale, 0, controls);
    for (const lobe of lobes) {
      ok(lobe.y - lobe.halfHeight >= 12 - 1e-6, `top clearance at ${scale}`);
      ok(lobe.y + lobe.halfHeight <= height - 12 + 1e-6, `bottom clearance at ${scale}`);
      ok(lobe.x - lobe.halfWidth >= 12 - 1e-6, `left clearance at ${scale}`);
      ok(lobe.x + lobe.halfWidth <= width - 12 + 1e-6, `right clearance at ${scale}`);
    }
  }
});

test('outgoing translation lobes never protrude below an already compact cloud', () => {
  for (const controls of ['unified', 'split']) for (const scale of [.6, .7, 1]) {
    for (const progress of [.001, .02, .1, .25, .5, .75, 1]) {
      const { height, lobes } = closingLobes(scale, progress, controls);
      for (const lobe of lobes) {
        ok(lobe.y + lobe.halfHeight <= height, `bottom bound at ${scale}, progress ${progress}`);
      }
    }
  }
});
