import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import * as CopyMenu from '@radix-ui/react-select';
import { call, errorMessage, errorSource, native } from './api';
import { t, useLocale, locale } from './i18n';
import { Empty, Panel, Modal, Icon } from './ui';
import { Select, SelectOption } from './Select';
import { useViewActive } from './RetainedView';
import { filterDiagnostics, type DiagnosticSnapshot } from './diagnostics';
import type { Props } from './pages';
import './developer-console.css';

export function DeveloperConsole({ run, notify, copyWithFeedback }: Props) {
  useLocale();
  const active = useViewActive();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(''), [level, setLevel] = useState('all');
  const [paused, setPaused] = useState(false), [clearing, setClearing] = useState(false), [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(250);
  const [copyLimit, setCopyLimit] = useState('100'), [copyOpen, setCopyOpen] = useState(false);
  const request = useRef(0);
  const list = useRef<HTMLDivElement>(null), following = useRef(true);
  const scrollAnchor = useRef<{ id: string; offset: number } | null>(null);
  useEffect(() => { if (!active) setCopyOpen(false); }, [active]);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (following.current) node.scrollTop = node.scrollHeight;
    else if (scrollAnchor.current) {
      const anchor = node.querySelector<HTMLElement>(`[data-log-id="${scrollAnchor.current.id}"]`);
      if (anchor) node.scrollTop += anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - scrollAnchor.current.offset;
    }
    scrollAnchor.current = null;
  }, [snapshot, query, level, visible, active]);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const next = await call<DiagnosticSnapshot>('developer_logs');
      if (request.current !== version) return;
      setSnapshot(previous => previous?.entries.at(-1)?.id === next.entries.at(-1)?.id &&
        previous?.entries.length === next.entries.length && previous?.storageError === next.storageError && previous?.enabled === next.enabled ? previous : next);
      setError('');
    } catch (error) { if (request.current === version) setError(errorSource(error)); }
  }, []);
  useEffect(() => {
    if (!active || paused) return;
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
    return () => { clearInterval(timer); request.current++; };
  }, [active, paused, refresh]);
  const entries = useMemo(() => filterDiagnostics(snapshot?.entries ?? [], level, query), [snapshot, level, query]);
  const errors = snapshot?.entries.filter(entry => entry.level === 'error').length ?? 0;
  const exportLogs = async () => {
    setBusy(true);
    try {
      await run(async () => {
        const path = await saveDialog({ defaultPath: `No Type-logs-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: t('common.text_file'), extensions: ['txt'] }] });
        if (path) { await call('developer_export_logs', { path }); notify(t('Console.exported')); }
      });
    } finally { setBusy(false); }
  };
  return <Panel className="developer-console">
    <div className="console-header">
      <h2>{t('Console.title')}</h2>
      <div className="console-actions">
        <button aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? t('Console.resume') : t('Console.pause')}</button>
        <div className="console-copy" role="group" aria-label={t('Console.copy')}>
          <button disabled={busy || !native} onClick={event => copyWithFeedback(event, () => call('developer_copy_logs', { limit: copyLimit === 'all' ? null : Number(copyLimit) }))}>{copyLimit === 'all' ? t('Console.copy_all') : t('Console.copy_recent', { value1: copyLimit })}</button>
          <CopyMenu.Root open={copyOpen && active} onOpenChange={setCopyOpen} value={copyLimit} onValueChange={setCopyLimit} disabled={busy || !native}>
            <CopyMenu.Trigger className="console-copy-options" aria-label={t('Console.copy_amount')}><CopyMenu.Icon><Icon name="settings" src="/assets/settings/chevron-down.svg" size={14}/></CopyMenu.Icon></CopyMenu.Trigger>
            <CopyMenu.Portal><CopyMenu.Content className="select-menu" position="popper" align="end" sideOffset={6} onEscapeKeyDown={event => event.stopPropagation()}><CopyMenu.Viewport className="select-viewport">
              {['100', '250', '500', '1000', 'all'].map(value => <CopyMenu.Item className="select-item" value={value} key={value}><CopyMenu.ItemText>{value === 'all' ? t('Console.all_history') : t('Console.last_logs', { value1: value })}</CopyMenu.ItemText><CopyMenu.ItemIndicator className="select-check">✓</CopyMenu.ItemIndicator></CopyMenu.Item>)}
            </CopyMenu.Viewport></CopyMenu.Content></CopyMenu.Portal>
          </CopyMenu.Root>
        </div>
        <button className="primary" disabled={busy || !native} onClick={() => void exportLogs()}>{t('Console.export')}</button>
        <button disabled={busy || !snapshot?.entries.length} onClick={() => setClearing(true)}>{t('Console.clear')}</button>
      </div>
    </div>
    <div className="console-filters">
      <input type="search" aria-label={t('Console.search')} placeholder={t('Console.search')} value={query} onChange={event => { following.current = true; setQuery(event.target.value); setVisible(250); }} />
      <Select aria-label={t('Console.level')} value={level} onValueChange={value => { following.current = true; setLevel(String(value)); setVisible(250); }}>
        <SelectOption value="all">{t('Console.all_levels')}</SelectOption>
        <SelectOption value="error">{t('Console.errors')}</SelectOption>
        <SelectOption value="warn">{t('Console.warnings')}</SelectOption>
        <SelectOption value="info">{t('Console.info')}</SelectOption>
        <SelectOption value="debug">{t('Console.debug')}</SelectOption>
      </Select>
    </div>
    {(error || snapshot?.storageError) && <p className="field-error" role="alert">{error ? errorMessage(error) : t('Console.storage_error', { error: snapshot!.storageError })}</p>}
    <div className="console-log-list" ref={list} onScroll={event => { const node = event.currentTarget; following.current = node.scrollHeight - node.clientHeight - node.scrollTop < 24; }} role="region" aria-label={t('Console.title')} tabIndex={0}>
      {entries.length > visible && <button className="console-more" onClick={() => {
        const node = list.current, top = node?.getBoundingClientRect().top ?? 0;
        const anchor = node && Array.from(node.querySelectorAll<HTMLElement>('[data-log-id]')).find(entry => entry.getBoundingClientRect().bottom > top);
        if (anchor) scrollAnchor.current = { id: anchor.dataset.logId!, offset: anchor.getBoundingClientRect().top - top };
        following.current = false;
        setVisible(value => value + 250);
      }}>{t('Console.load_more')}</button>}
      {entries.length ? entries.slice(-visible).map(entry => <article className="console-entry" data-level={entry.level} data-log-id={entry.id} key={entry.id}>
        <div className="console-entry-meta"><time dateTime={entry.timestamp} title={entry.timestamp}>{new Date(entry.timestamp).toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span className="console-level">{entry.level.toUpperCase()}</span><span>{entry.source}</span></div>
        <div className="console-entry-message">{errorMessage(entry.message)}</div>
        {entry.details && Object.keys(entry.details).length > 0 && <pre>{JSON.stringify(entry.details, null, 2)}</pre>}
      </article>) : !snapshot ? <div className="console-empty" role="status">{error?t('common.unavailable'):t('Console.loading')}</div> : <Empty compact icon={query.trim()||level!=='all'?'search':'settings'} title={t(query.trim()||level!=='all'?'Console.no_matches':'Empty.console_title')} body={t(query.trim()||level!=='all'?'Empty.search_body':'Empty.console_body')}>
        {(query.trim()||level!=='all')&&<button onClick={()=>{setQuery('');setLevel('all');}}>{t('Empty.reset_filters')}</button>}
      </Empty>}
    </div>
    {(paused || errors > 0) && <div className="console-status" role="status">
      {paused && <><i data-paused aria-hidden />{t('Console.paused')}</>}
      {errors > 0 && <span className="console-error-count">{t('Console.error_count', { count: errors })}</span>}
    </div>}
    {clearing && <Modal title={t('Console.clear_title')} onClose={() => { if (!busy) setClearing(false); }}>
      <p>{t('Console.clear_description')}</p><footer><button disabled={busy} onClick={() => setClearing(false)}>{t('common.cancel')}</button><button className="danger" disabled={busy} onClick={() => {
        setBusy(true);
        void run(async () => { await call('developer_clear_logs'); setClearing(false); await refresh(); notify(t('Console.cleared')); }).finally(() => setBusy(false));
      }}>{t('Console.clear')}</button></footer>
    </Modal>}
  </Panel>;
}
