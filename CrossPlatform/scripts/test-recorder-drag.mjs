import { test } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { connectRecorderDrag } from '../src/recorder/drag.js';

function fixture(move) {
  const doc = new EventTarget(); doc.defaultView = new EventTarget();
  const root = new EventTarget(); root.ownerDocument = doc; root.dataset = {};
  let captured = null;
  root.setPointerCapture = id => { captured = id; };
  root.hasPointerCapture = id => captured === id;
  root.releasePointerCapture = () => { captured = null; };
  const calls = [], errors = [];
  const dispose = connectRecorderDrag(root, async detail => { calls.push(detail); await move?.(detail); }, error => errors.push(error));
  const target = kind => ({
    closest(selector) {
      if (selector === '.shell') return kind !== 'outside';
      if (selector === 'button, [role="button"]') return ['center', 'control'].includes(kind) ? this : null;
      return kind === 'text';
    },
    matches() { return kind === 'center'; },
  });
  const emit = (type, props = {}, kind = 'center') => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: 1, isPrimary: true, button: 0,
      clientX: 300, clientY: 348, screenX: 700, screenY: 850, detail: 1, target: target(kind), ...props }).map(([key, value]) => [key, { value }])));
    (['pointerdown','click','lostpointercapture'].includes(type) ? root : doc).dispatchEvent(event);
    return event;
  };
  return { root, doc, calls, errors, emit, dispose, captured: () => captured };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a click and small pointer jitter keep the recorder action intact', async () => {
  const f = fixture();
  f.emit('pointerdown'); f.emit('pointermove', { screenX: 702, screenY: 852 }); f.emit('pointerup');
  strictEqual(f.emit('click').defaultPrevented, false);
  await tick(); deepStrictEqual(f.calls, []); f.dispose();
});
test('dragging the center moves and saves without triggering start or finish', async () => {
  const f = fixture();
  f.emit('pointerdown'); f.emit('pointermove', { screenX: 720 });
  strictEqual(f.captured(), 1); strictEqual(f.root.dataset.dragging, 'true');
  await tick(); f.emit('pointerup', { screenX: 760 }); await tick();
  deepStrictEqual(f.calls, [{ x: 300, y: 348, end: false }, { x: 300, y: 348, end: true }]);
  strictEqual(f.emit('click').defaultPrevented, true);
  strictEqual(f.captured(), null); strictEqual(f.root.dataset.dragging, undefined);
  f.emit('pointerdown'); f.emit('pointerup'); strictEqual(f.emit('click').defaultPrevented, false);
  f.dispose();
});
test('side buttons, settings, transcript, secondary pointers and right clicks never move', async () => {
  for (const [kind, props] of [['control', {}], ['text', {}], ['outside', {}], ['center', { button: 2 }], ['center', { isPrimary: false }]]) {
    const f = fixture(); f.emit('pointerdown', props, kind); f.emit('pointermove', { screenX: 800 }, kind); f.emit('pointerup');
    await tick(); deepStrictEqual(f.calls, []); f.dispose();
  }
});
test('slow native moves coalesce and finish is ordered after the last move', async () => {
  let resolve; const f = fixture(() => new Promise(done => { resolve = done; }));
  f.emit('pointerdown'); f.emit('pointermove', { screenX: 720 });
  for (let i = 0; i < 100; i++) f.emit('pointermove', { screenX: 730 + i });
  f.emit('pointerup'); strictEqual(f.calls.length, 1);
  resolve(); await tick(); strictEqual(f.calls.length, 2); strictEqual(f.calls[1].end, true);
  resolve(); await tick(); f.dispose();
});
test('capture loss and disposal finish once and remove gesture listeners', async () => {
  for (const finish of ['lostpointercapture', 'pointercancel', 'dispose']) {
    const f = fixture(); f.emit('pointerdown'); f.emit('pointermove', { screenY: 700 }); await tick();
    if (finish === 'dispose') f.dispose(); else f.emit(finish);
    f.dispose(); await tick(); strictEqual(f.calls.filter(c => c.end).length, 1);
    strictEqual(f.root.dataset.dragging, undefined); strictEqual(f.captured(), null);
    f.emit('pointerdown'); f.emit('pointermove', { screenY: 600 }); await tick(); strictEqual(f.calls.length, 2);
  }
});
test('native errors are reported and do not leave the send queue or capture stuck', async () => {
  const f = fixture(() => { throw new Error('move failed'); });
  f.emit('pointerdown'); f.emit('pointermove', { screenX: 800 }); await tick();
  f.emit('pointerup'); await tick(); strictEqual(f.errors.length, 2); strictEqual(f.captured(), null);
  f.dispose();
});
