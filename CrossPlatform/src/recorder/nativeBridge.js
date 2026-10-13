// Both recorder webviews retain their native session while hidden. Hydration
// must never overwrite an event delivered while the snapshot request is in flight.
export function connectRecorderBridge(api, renderer, lifecycle = document) {
  let disposed = false, stateVersion = 0, request = 0;
  const stops = [];
  const report = error => renderer.error?.(error);
  const root = lifecycle.documentElement;
  const previousStyle = root && { opacity: root.style.opacity, transition: root.style.transition, pointerEvents: root.style.pointerEvents };
  const reducedMotion = lifecycle.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
  const updateMotion = () => { if (root) root.style.transition = reducedMotion?.matches ? 'none' : 'opacity 140ms ease-out'; };
  updateMotion();
  reducedMotion?.addEventListener('change', updateMotion);
  let phase, hoverHidden = false;
  const applyHover = () => {
    if (root) {
      root.style.pointerEvents = hoverHidden ? 'none' : previousStyle.pointerEvents;
      root.style.opacity = hoverHidden ? '0' : previousStyle.opacity;
    }
  };
  const update = snapshot => {
    phase = snapshot.state;
    // Reveal as soon as a session starts, even if the cursor stays still.
    // A delayed native hover sample must not hide any working state.
    if (phase !== 'idle') hoverHidden = false;
    applyHover();
    renderer.update(snapshot);
  };
  const refresh = async () => {
    const currentRequest = ++request, version = stateVersion;
    try {
      const snapshot = await api.core.invoke('cloud_snapshot');
      if (!disposed && request === currentRequest && stateVersion === version) update(snapshot);
    } catch (error) { if (!disposed) report(error); }
  };
  const onVisible = () => { if (!lifecycle.hidden) void refresh(); };
  lifecycle.addEventListener('visibilitychange', onVisible);
  const handlers = {
    'cloud-state': payload => { stateVersion++; update(payload); },
    'cloud-active': payload => { renderer.active?.(payload); if (payload === true) void refresh(); },
    // Opacity preserves layout/hit regions and the session while the OS passes
    // clicks through immediately. CSS reverses an interrupted fade from its
    // current opacity, without timers that could hide a newly revealed recorder.
    'cloud-hover-hidden': hidden => {
      hoverHidden = hidden && phase === 'idle';
      applyHover();
    },
    ...(renderer.audio ? { 'cloud-audio': renderer.audio } : {}),
    ...(renderer.pointer ? { 'cloud-pointer': renderer.pointer } : {}),
    ...(renderer.dock ? { 'cloud-dock': renderer.dock } : {}),
  };
  const ready = Promise.all(Object.entries(handlers).map(async ([name, handle]) => {
    try {
      const stop = await api.event.listen(name, event => { if (!disposed) handle(event.payload); });
      if (disposed) stop(); else stops.push(stop);
    } catch (error) { if (!disposed) report(error); }
  })).then(async () => {
    if (disposed) return;
    await refresh();
    if (disposed) return;
    // The initial ready message in cloud.html precedes its subscriptions.
    // Repeat it now so native visibility and dock geometry can be delivered.
    try { await api.core.invoke('cloud_action', { action: 'ready', detail: {} }); }
    catch (error) { if (!disposed) report(error); }
  });
  return { ready, refresh, dispose() {
    disposed = true;
    lifecycle.removeEventListener('visibilitychange', onVisible);
    stops.splice(0).forEach(stop => stop());
    reducedMotion?.removeEventListener('change', updateMotion);
    if (root) Object.assign(root.style, previousStyle);
  } };
}
