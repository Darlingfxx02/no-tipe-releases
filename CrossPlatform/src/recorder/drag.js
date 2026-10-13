// Keep a click on the central recorder intact until the pointer really moves.
// Capture on the retained root: phase changes can replace its child controls.
export function connectRecorderDrag(root, move, report = () => {}) {
  let gesture = null, suppressClick = false, pending = null, sending = false;
  const send = async () => {
    if (sending) return;
    sending = true;
    while (pending) {
      const detail = pending; pending = null;
      try { await move(detail); } catch (error) { report(error); }
    }
    sending = false;
  };
  const queue = end => {
    pending = { x: gesture.x, y: gesture.y, end };
    void send();
  };
  const down = event => {
    if (event.button !== 0 || !event.isPrimary || gesture) return;
    // The compact center is also the start/stop target. All other buttons,
    // settings, and selectable transcript content retain their own gestures.
    const target = event.target;
    if (!target.closest('.shell') || target.closest('.reading, [data-setting], input, select, textarea')) return;
    const button = target.closest('button, [role="button"]');
    if (button && !button.matches('.cloud-trigger')) return;
    suppressClick = false;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, screenX: event.screenX, screenY: event.screenY, dragging: false };
  };
  const pointerMove = event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (!gesture.dragging) {
      if (Math.hypot(event.screenX - gesture.screenX, event.screenY - gesture.screenY) < 5) return;
      gesture.dragging = true; suppressClick = true;
      root.setPointerCapture(gesture.id);
      root.dataset.dragging = 'true';
    }
    event.preventDefault(); queue(false);
  };
  const finish = event => {
    if (!gesture || (event.pointerId != null && event.pointerId !== gesture.id)) return;
    const id = gesture.id;
    if (gesture.dragging) queue(true);
    gesture = null; delete root.dataset.dragging;
    if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
  };
  const click = event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
  };
  const doc = root.ownerDocument;
  root.addEventListener('pointerdown', down);
  doc.addEventListener('pointermove', pointerMove);
  doc.addEventListener('pointerup', finish);
  doc.addEventListener('pointercancel', finish);
  root.addEventListener('lostpointercapture', finish);
  root.addEventListener('click', click, true);
  doc.defaultView?.addEventListener('blur', finish);
  return () => {
    finish({});
    root.removeEventListener('pointerdown', down);
    doc.removeEventListener('pointermove', pointerMove);
    doc.removeEventListener('pointerup', finish);
    doc.removeEventListener('pointercancel', finish);
    root.removeEventListener('lostpointercapture', finish);
    root.removeEventListener('click', click, true);
    doc.defaultView?.removeEventListener('blur', finish);
  };
}
