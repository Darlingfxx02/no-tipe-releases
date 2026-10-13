import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { connectRecorderBridge } from '../src/recorder/nativeBridge.js';

const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture({ rejectPointer = false } = {}) {
  const lifecycle = new EventTarget(); lifecycle.hidden = false;
  lifecycle.documentElement = { style: { opacity: '', transition: '', pointerEvents: '' } };
  const motion = new EventTarget(); motion.matches = false;
  lifecycle.defaultView = { matchMedia: () => motion };
  const callbacks = new Map(), requests = [], updates = [], active = [], errors = [], actions = [];
  const api = {
    event: { listen: async (name, callback) => {
      if (rejectPointer && name === 'cloud-pointer') throw new Error('pointer unavailable');
      callbacks.set(name, callback); return () => callbacks.delete(name);
    } },
    core: { invoke: async (command, args) => {
      if (command === 'cloud_action') { actions.push(args); return; }
      const request = pending(); requests.push(request); return request.promise;
    } },
  };
  const connection = connectRecorderBridge(api, {
    update: snapshot => updates.push(snapshot.state), active: value => active.push(value),
    pointer: () => {}, error: error => errors.push(String(error)),
  }, lifecycle);
  const emit = (name, payload) => callbacks.get(name)?.({ payload });
  return { connection, lifecycle, motion, callbacks, requests, updates, active, errors, actions, emit };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('late startup snapshot cannot overwrite recording or completion events', async () => {
  const f = fixture(); await tick();
  for (const state of ['preparing', 'recording', 'preparing', 'busy', 'result']) f.emit('cloud-state', { state });
  f.requests[0].resolve({ state: 'idle' }); await f.connection.ready;
  deepStrictEqual(f.updates, ['preparing', 'recording', 'preparing', 'busy', 'result']);
  deepStrictEqual(f.actions, [{ action: 'ready', detail: {} }]);
  f.emit('cloud-state', { state: 'idle' });
  f.emit('cloud-state', { state: 'recording' });
  f.emit('cloud-state', { state: 'failed' });
  f.emit('cloud-state', { state: 'idle' });
  deepStrictEqual(f.updates.slice(-4), ['idle', 'recording', 'failed', 'idle']);
  f.connection.dispose();
});

test('hide/reveal and delayed refresh retain the latest recording state', async () => {
  const f = fixture(); await tick(); f.requests[0].resolve({ state: 'recording' }); await f.connection.ready;
  f.emit('cloud-active', false);
  f.emit('cloud-state', { state: 'busy' });
  f.emit('cloud-active', true); await tick();
  f.emit('cloud-state', { state: 'copied' });
  f.requests[1].resolve({ state: 'busy' }); await tick();
  deepStrictEqual(f.updates, ['recording', 'busy', 'copied']);
  deepStrictEqual(f.active, [false, true]);
  f.lifecycle.dispatchEvent(new Event('visibilitychange')); await tick();
  f.requests[2].resolve({ state: 'idle' }); await tick();
  deepStrictEqual(f.updates, ['recording', 'busy', 'copied', 'idle']);
  f.connection.dispose();
});

test('an optional native pointer listener failure does not block state hydration', async () => {
  const f = fixture({ rejectPointer: true }); await tick();
  f.requests[0].resolve({ state: 'preparing' }); await f.connection.ready;
  f.emit('cloud-state', { state: 'recording' });
  deepStrictEqual(f.updates, ['preparing', 'recording']); strictEqual(f.errors.length, 1);
  f.connection.dispose(); strictEqual(f.callbacks.size, 0);
});

test('navigation disposes listeners and ignores snapshots from the previous renderer', async () => {
  const f = fixture(); await tick();
  f.connection.dispose(); f.requests[0].resolve({ state: 'recording' }); await f.connection.ready;
  deepStrictEqual(f.updates, []); deepStrictEqual(f.actions, []); strictEqual(f.callbacks.size, 0);
});

test('idle hover reveals on session start and ignores late hover samples throughout recording and completion', async () => {
  const f = fixture();
  await tick(); f.requests[0].resolve({ state: 'idle' }); await f.connection.ready;
  f.emit('cloud-hover-hidden', true);
  strictEqual(f.lifecycle.documentElement.style.opacity, '0');
  strictEqual(f.lifecycle.documentElement.style.pointerEvents, 'none');
  const states = ['preparing', 'recording', 'recording', 'busy', 'result', 'copied', 'failed'];
  for (const [index, state] of states.entries()) {
    f.emit('cloud-state', { state, paused: index === 2 });
    strictEqual(f.lifecycle.documentElement.style.opacity, '');
    strictEqual(f.lifecycle.documentElement.style.pointerEvents, '');
    f.emit('cloud-hover-hidden', true);
    strictEqual(f.lifecycle.documentElement.style.opacity, '');
    strictEqual(f.lifecycle.documentElement.style.pointerEvents, '');
  }
  deepStrictEqual(f.updates, ['idle', ...states]);
  deepStrictEqual(f.active, []);
  f.emit('cloud-state', { state: 'idle' });
  strictEqual(f.lifecycle.documentElement.style.opacity, '');
  f.emit('cloud-hover-hidden', true);
  strictEqual(f.lifecycle.documentElement.style.opacity, '0');
  f.emit('cloud-hover-hidden', false);
  strictEqual(f.lifecycle.documentElement.style.opacity, '');
  strictEqual(f.lifecycle.documentElement.style.pointerEvents, '');
  f.emit('cloud-hover-hidden', true); f.connection.dispose();
  deepStrictEqual(f.lifecycle.documentElement.style, { opacity: '', transition: '', pointerEvents: '' });
  strictEqual(f.callbacks.size, 0);
});

test('snapshot refresh reveals an idle recorder when a session started while the webview was hidden', async () => {
  const f = fixture(); await tick(); f.requests[0].resolve({ state: 'idle' }); await f.connection.ready;
  f.emit('cloud-hover-hidden', true);
  f.lifecycle.dispatchEvent(new Event('visibilitychange')); await tick();
  f.requests[1].resolve({ state: 'recording' }); await tick();
  f.emit('cloud-hover-hidden', true);
  strictEqual(f.lifecycle.documentElement.style.opacity, '');
  strictEqual(f.lifecycle.documentElement.style.pointerEvents, '');
  deepStrictEqual(f.updates, ['idle', 'recording']);
  f.connection.dispose();
});

test('reduced motion changes during a fade keep input disabled and disposal removes the listener', async () => {
  const f = fixture(); await tick(); f.requests[0].resolve({ state: 'idle' }); await f.connection.ready;
  const style = f.lifecycle.documentElement.style;
  f.emit('cloud-hover-hidden', true);
  f.motion.matches = true; f.motion.dispatchEvent(new Event('change'));
  strictEqual(style.transition, 'none');
  strictEqual(style.opacity, '0'); strictEqual(style.pointerEvents, 'none');
  f.motion.matches = false; f.motion.dispatchEvent(new Event('change'));
  strictEqual(style.transition, 'opacity 140ms ease-out');
  f.emit('cloud-hover-hidden', false); f.emit('cloud-hover-hidden', true);
  strictEqual(style.opacity, '0'); strictEqual(style.pointerEvents, 'none');
  f.connection.dispose(); f.motion.matches = true; f.motion.dispatchEvent(new Event('change'));
  deepStrictEqual(style, { opacity: '', transition: '', pointerEvents: '' });
});

test('the generated cloud visibility callback preserves native phases and pause', () => {
  const html = readFileSync(new URL('../public/cloud.html', import.meta.url), 'utf8');
  const method = html.match(/ active\(value\)\{([\s\S]*?)\n \}\n\};/)?.[1];
  for (const phase of ['recording', 'preparing', 'busy', 'result', 'copied', 'failed']) {
    const scope = { nativeActive: true, state: phase, recordingPaused: true, raf: 9,
      cancelAnimationFrame() {}, resetHiddenSession() { throw new Error('Native phase was reset'); }, draw() {}, schedule() {} };
    runInNewContext(`(function(value){${method}})(false)`, scope);
    strictEqual(scope.nativeActive, false); strictEqual(scope.state, phase); strictEqual(scope.recordingPaused, true);
  }
});

const cloud = readFileSync(new URL('../public/cloud.html', import.meta.url), 'utf8');

test('hidden layout callbacks and queued frames do no rendering or animation work', () => {
  const draw = cloud.match(/function draw\(delta\)\{([\s\S]*?)\n\}\nlet audioLevel=0;/)?.[1];
  const frame = cloud.match(/function frame\(now\)\{([\s\S]*?)\n\}\nfunction schedule/)?.[1];
  const unexpected = () => { throw new Error('Hidden renderer performed work'); };
  for (const [nativeActive, hidden] of [[false, false], [true, true], [false, true]]) {
    const scope = { nativeActive, document: { hidden }, paused: false, canvas: { isConnected: true },
      updateTranscriptViewport: unexpected, drawPixelControls: unexpected, draw: unexpected,
      requestAnimationFrame: unexpected, renderer: { dispose: unexpected, render: unexpected },
      raf: 7, time: 3, last: 400, regionTime: 0 };
    runInNewContext(`(function(delta){${draw}})(.016)`, scope);
    runInNewContext(`(function(now){${frame}})(1000)`, scope);
    strictEqual(scope.raf, 0); strictEqual(scope.time, 3); strictEqual(scope.last, 400);
  }
});

test('static pixel controls redraw only after content, size or GPU resources change', () => {
  const controls = cloud.match(/function drawPixelControls\(delta\)\{([\s\S]*?)\n\}\nfunction reportHitRegions/)?.[1];
  const node = { isConnected: true, clientWidth: 24, clientHeight: 24, width: 24, height: 24,
    dataset: { pixelSource: encodeURIComponent('<svg/>') } };
  let draws = 0;
  const renderer = { lastOptions: null, needsDraw: true,
    draw(options) { draws++; this.lastOptions = options; this.needsDraw = false;
      node.width = Math.round(node.clientWidth * scope.devicePixelRatio); node.height = Math.round(node.clientHeight * scope.devicePixelRatio); },
    dispose() { throw new Error('A retained control was disposed'); } };
  const scope = { pixelIcons: new Map([[node, renderer]]), recorderStyle: 'pixel', waveBrightness: .35,
    devicePixelRatio: 1, root: { querySelectorAll: () => [node] } };
  const render = () => runInNewContext(`(function(delta){${controls}})(.016)`, scope);
  for (let i = 0; i < 60; i++) render();
  strictEqual(draws, 1);
  node.dataset.pixelSource = encodeURIComponent('<svg data-icon="play"/>'); render(); strictEqual(draws, 2);
  scope.waveBrightness = .5; render(); strictEqual(draws, 3);
  scope.devicePixelRatio = 1.25; render(); strictEqual(draws, 4);
  renderer.needsDraw = true; render(); strictEqual(draws, 5);
  render(); strictEqual(draws, 5);
});

test('play and pause reuse the same pixel control canvas and renderer', () => {
  const sync = cloud.match(/function syncCloudControls\(controls,reading\)\{([\s\S]*?)\n\}\nfunction render/)?.[1];
  const canvas = { dataset: { icon: 'pause', pixelIcon: 'pause', pixelSource: '' } };
  const record = { dataset: {}, classList: { toggle() {} }, setAttribute() {},
    querySelector: () => canvas,
    set innerHTML(_) { throw new Error('Playback control canvas was recreated'); } };
  const settings = { querySelector: () => canvas };
  const controls = { setAttribute() {}, querySelector: selector => selector === '.record' ? record : selector === '.settings-trigger' ? settings : {} };
  const scope = { state: 'recording', recordingPaused: false, recorderStyle: 'pixel',
    vectorIcon: kind => `<svg data-icon="${kind}"/>`, status: () => 'Listening', recorderT: key => key, controls };
  for (const paused of [true, false, true, false]) {
    scope.recordingPaused = paused;
    runInNewContext(`(function(controls,reading){${sync}})(controls,true)`, scope);
    strictEqual(canvas.dataset.icon, paused ? 'play' : 'pause');
    strictEqual(decodeURIComponent(canvas.dataset.pixelSource), `<svg data-icon="${paused ? 'play' : 'pause'}"/>`);
  }
});
