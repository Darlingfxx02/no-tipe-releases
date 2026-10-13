// Installed before page scripts in both the app and recorder webviews.
(() => {
  const api = window.__TAURI_INTERNALS__;
  if (!api) return;
  let enabled = false, initialized = false, revision = 0;
  const pending = [];
  const report = (level, message, details = {}) => {
    if (!initialized) {
      if (pending.length < 50) pending.push([level, message, details]);
      return;
    }
    if (enabled) void api.invoke('developer_client_event', { level, message, details }).catch(() => {});
  };
  const setEnabled = value => {
    enabled = Boolean(value);
    initialized = true;
    pending.splice(0).forEach(args => report(...args));
  };
  window.__noTypeDiagnostics = { report, setEnabled };
  const describe = error => error instanceof Error
    ? { message: error.message, stack: error.stack, name: error.name }
    : { message: typeof error === 'string' ? error : 'Non-string error' };
  window.addEventListener('error', event => report('error', 'javascript.error', {
    ...describe(event.error || event.message), line: event.lineno, column: event.colno,
  }));
  window.addEventListener('unhandledrejection', event => report('error', 'promise.unhandled', describe(event.reason)));
  for (const method of ['debug', 'log', 'info', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      // Never serialize arbitrary console objects; they may contain content.
      const first = args[0];
      const exception = args.find(argument => argument instanceof Error);
      report(method === 'log' ? 'info' : method, `console.${method}`,
        exception ? { ...describe(exception), message: typeof first === 'string' ? `${first} ${exception.message}` : exception.message }
          : { message: typeof first === 'string' ? first : 'Console object omitted' });
    };
  }
  const callback = api.transformCallback(event => { revision++; setEnabled(event.payload); });
  // Subscribe before hydration; a preference change wins over an older reply.
  void api.invoke('plugin:event|listen', { event: 'developer-mode-changed', target: { kind: 'Any' }, handler: callback })
    .then(async () => {
      const current = revision;
      const status = await api.invoke('developer_status');
      if (revision === current) setEnabled(status);
    }).catch(() => { setEnabled(false); });
})();
