import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateDialog, UpdateIndicator, UpdatesPanel, UpdatesContext, updatePercent, useAppUpdates } from './Updates';

vi.mock('./api', () => ({ native: true, call: vi.fn(), errorMessage: String, errorSource: String }));

const state: ReturnType<typeof useAppUpdates> = {
  available: { version: '1.1.0', currentVersion: '1.0.0', notes: '' },
  checking: false, installing: false, progress: null, error: '', lastCheck: 0, open: false,
  setOpen: vi.fn(), check: vi.fn(), install: vi.fn(),
};
const indicator = (patch: Partial<typeof state> = {}) => renderToStaticMarkup(<UpdatesContext.Provider value={{ ...state, ...patch }}><UpdateIndicator/></UpdatesContext.Provider>);

describe('background app updates', () => {
  it('offers only the update check without repository or account configuration', () => {
    const html = renderToStaticMarkup(<UpdatesContext.Provider value={{ ...state, available: null }}><UpdatesPanel/></UpdatesContext.Provider>);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('Check for updates');
    expect(html).not.toMatch(/Configure|Connect GitHub|Connect account|<input|<dialog/);
  });
  it('keeps the update check available after a failed startup check', () => {
    const html = renderToStaticMarkup(<UpdatesContext.Provider value={{ ...state, available: null, error: 'Offline' }}><UpdatesPanel/></UpdatesContext.Provider>);
    expect(html).toContain('Check for updates');
    expect(html).not.toContain('disabled=""');
  });
  it('only shows the update action when a release is available', () => {
    expect(indicator({ available: null })).toBe('');
    expect(indicator()).toContain('<button');
    expect(indicator()).not.toContain('aria-haspopup');
  });
  it('reserves 100% for a successfully installed update', () => {
    expect(updatePercent(null)).toBe(0);
    expect(updatePercent({ stage: 'downloading', downloaded: 42, total: 100 })).toBe(42);
    expect(updatePercent({ stage: 'downloading', downloaded: 100, total: 100 })).toBe(99);
    for (const stage of ['verifying', 'waiting', 'installing'] as const) expect(updatePercent({ stage })).toBe(99);
    expect(updatePercent({ stage: 'restarting' })).toBe(100);
  });
  it('does not invent a percentage when the server omits the download size', () => {
    expect(updatePercent({ stage: 'downloading', downloaded: 100 })).toBeUndefined();
    expect(indicator({ installing: true, progress: { stage: 'downloading', downloaded: 100 } })).toContain('is-indeterminate');
  });
  it('keeps the visible counter to two digits as the installed app restarts', () => {
    const html = indicator({ installing: true, progress: { stage: 'restarting' } });
    expect(html).toContain('>99</span>');
    expect(html).not.toContain('>100</span>');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('stroke-dashoffset="0"');
  });
  it('replaces the action with an accessible ring and percentages during installation', () => {
    const html = indicator({ installing: true, progress: { stage: 'downloading', downloaded: 42, total: 100 } });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('>42</span>');
    expect(html).not.toContain('>42%</span>');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<dialog');
  });
  it('allows an update to start from the details while dictation is busy', () => {
    const html = renderToStaticMarkup(<UpdatesContext.Provider value={{ ...state, open: true }}><UpdateDialog busy/></UpdatesContext.Provider>);
    expect(html).not.toContain('disabled=""');
  });
});
