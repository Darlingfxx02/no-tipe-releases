import { t, useLocale } from './i18n';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, errorMessage, native, errorSource } from './api';
import { Icon, Modal, SettingsGroup as Panel, Row } from './ui';
import './updates.css';

type Available = { version: string; currentVersion: string; notes: string };
type ChannelInfo = { developer: boolean; repository: string; tokenConfigured: boolean };
type Progress = { stage: 'downloading' | 'verifying' | 'waiting' | 'installing' | 'restarting'; downloaded?: number; total?: number };
const interval = 90 * 60 * 1000;

export function updatePercent(progress: Progress | null): number | undefined {
  if (progress?.stage === 'restarting') return 100;
  if (progress && progress.stage !== 'downloading') return 99;
  if (progress?.total && Number.isFinite(progress.total) && progress.total > 0) return Math.max(0, Math.min(99, Math.floor((progress.downloaded ?? 0) / progress.total * 100)));
  return progress?.downloaded ? undefined : 0;
}

function updateLabel(progress: Progress | null) {
  if (progress?.stage === 'restarting' || progress?.stage === 'installing') return t('Updates.installing_and_restarting');
  if (progress?.stage === 'waiting') return t('Updates.waiting_for_work_to_finish');
  if (progress?.stage === 'verifying') return t('Updates.verifying_signature');
  const percent = updatePercent(progress);
  return t('Updates.downloading_progress', { progress: percent === undefined ? '…' : ` ${percent}%` });
}

export function useAppUpdates() {
  const [available, setAvailable] = useState<Available | null>(null);
  const [checking, setChecking] = useState(false), [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null), [error, setError] = useState(''), [lastCheck, setLastCheck] = useState(0), [open, setOpen] = useState(false);
  const operation = useRef(false), lastAttempt = useRef(0), mounted = useRef(true);
  const listenerReady = useRef<Promise<boolean>>(Promise.resolve(false));
  const check = useCallback(async (manual = false) => {
    if (!native || operation.current) return;
    operation.current = true; lastAttempt.current = Date.now(); setChecking(true);
    if (manual) setError('');
    try {
      const result = await call<Available | null>('check_updates');
      if (mounted.current) { setAvailable(result); setLastCheck(Date.now()); setError(''); }
    } catch (e) { if (mounted.current) { setAvailable(null); setOpen(false); setError(errorSource(e)); } }
    finally { operation.current = false; if (mounted.current) setChecking(false); }
  }, []);
  const install = useCallback(async () => {
    if (!native || operation.current || !available) return;
    operation.current = true; setInstalling(true); setOpen(false); setError(''); setProgress({ stage: 'downloading' });
    try {
      if (!await listenerReady.current) throw new Error(t('Updates.could_not_start_update'));
      await call('install_update');
    }
    catch (e) { if (mounted.current) { setError(errorSource(e)); setProgress(null); setOpen(true); } }
    finally { operation.current = false; if (mounted.current) setInstalling(false); }
  }, [available]);
  useEffect(() => {
    if (!native) return;
    mounted.current = true;
    let disposed = false, stop: (() => void) | undefined;
    listenerReady.current = listen<Progress>('update-progress', event => { if (!disposed) setProgress(event.payload); }).then(unlisten => { if (!disposed) { stop = unlisten; return true; } unlisten(); return false; }).catch(e => { if (!disposed) setError(errorSource(e)); return false; });
    void check();
    const periodic = () => { if (Date.now() - lastAttempt.current >= interval && navigator.onLine) void check(); };
    const online = () => void check();
    // The interval tick can precede the startup request's timestamp by a few
    // milliseconds. Check on every tick so that does not skip an entire period.
    const timer = setInterval(() => { if (navigator.onLine) void check(); }, interval);
    window.addEventListener('focus', periodic); window.addEventListener('online', online);
    return () => { disposed = true; mounted.current = false; stop?.(); clearInterval(timer); window.removeEventListener('focus', periodic); window.removeEventListener('online', online); };
  }, [check]);
  return { available, checking, installing, progress, error, lastCheck, open, setOpen, check, install };
}

export const UpdatesContext = createContext<ReturnType<typeof useAppUpdates> | null>(null);
function useUpdates() { const value = useContext(UpdatesContext); if (!value) throw new Error(t('Updates.missing_updates_provider')); return value; }

export function UpdateIndicator() {
  useLocale();
  const updates = useUpdates();
  if (!updates.available) return null;
  if (updates.installing) {
    const percent = updatePercent(updates.progress), label = updateLabel(updates.progress);
    return <span className={`update-indicator update-indicator-progress${percent === undefined ? ' is-indeterminate' : ''}`} role="progressbar" aria-label={t('Updates.update_no_tipe')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label} title={label}>
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="update-ring-track" cx="18" cy="18" r="16"/><circle className="update-ring-fill" cx="18" cy="18" r="16" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - (percent ?? 24)}/></svg>
      <span className="update-indicator-percent" aria-hidden="true">{percent === undefined ? '…' : Math.min(99, percent)}</span>
    </span>;
  }
  return <button type="button" className="update-indicator" title={t('Updates.update_to', { value1: updates.available.version })} aria-label={t('Updates.update_available_version', { value1: updates.available.version })} disabled={updates.checking} onClick={() => void updates.install()}><Icon name="update" size={12}/></button>;
}

export function UpdatesPanel() {
  useLocale();
  const updates = useUpdates();
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [token, setToken] = useState(''), [saving, setSaving] = useState(false), [tokenError, setTokenError] = useState('');
  useEffect(() => {
    if (!native) return;
    let active = true;
    void call<ChannelInfo>('update_channel').then(value => { if (active) setChannel(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const saveToken = async (value: string) => {
    setSaving(true); setTokenError('');
    try {
      await call('save_update_token', { token: value });
      setToken('');
      setChannel(await call<ChannelInfo>('update_channel'));
      await updates.check(true);
    } catch (error) { setTokenError(errorSource(error)); }
    finally { setSaving(false); }
  };
  const disabled = !native || updates.checking || updates.installing || saving;
  const status = updates.installing ? updateLabel(updates.progress) : updates.available ? t('Updates.version_is_available', { value1: updates.available.version }) : updates.checking ? t('Updates.checking_github') : updates.error ? t('Updates.could_not_check_for_updates_try_again_when') : updates.lastCheck ? t('Updates.you_re_up_to_date') : t('Updates.checks_at_startup_and_every_90_minutes');
  return <Panel title={t('Updates.app_updates')} titleIcon={<Icon name="update" size={18}/>}>
    {channel?.developer && <Row title={t('Updates.developer_channel')} description={channel.tokenConfigured ? t('Updates.developer_connected') : t('Updates.developer_access')} help={t('Updates.developer_token_help')}>
      <form className="developer-update-access" onSubmit={event => { event.preventDefault(); void saveToken(token); }}>
        <input type="password" aria-label={t('Updates.github_token')} placeholder={t('Updates.github_token')} autoComplete="off" spellCheck={false} value={token} maxLength={1024} disabled={disabled} onChange={event => setToken(event.target.value)}/>
        <button type="submit" disabled={disabled || !token.trim()}>{saving ? t('common.checking') : t('common.save')}</button>
        {channel.tokenConfigured && <button type="button" disabled={disabled} onClick={() => void saveToken('')}>{t('Updates.disconnect')}</button>}
      </form>
    </Row>}
    <Row title={t('Updates.github_updates')} description={status}><button disabled={disabled || (channel?.developer && !channel.tokenConfigured)} onClick={() => updates.available ? updates.setOpen(true) : void updates.check(true)}>{updates.checking ? t('common.checking') : updates.available ? t('Updates.view_update') : t('Updates.check_for_updates')}</button></Row>
    {(tokenError || (channel?.developer && updates.error)) && <p className="field-error" role="alert">{errorMessage(tokenError || updates.error)}</p>}
  </Panel>;
}

export function UpdateDialog({ busy }: { busy: boolean }) {
  useLocale();
  const updates = useUpdates();
  if (!updates.open || !updates.available) return null;
  const percent = updatePercent(updates.progress), label = updateLabel(updates.progress);
  return <Modal title={t('Updates.update_no_tipe')} className="update-dialog" onClose={() => updates.setOpen(false)}>
    <div className="update-version"><span className="update-symbol"><Icon name="update" size={28}/></span><div><h3>{t('Settings.version')} {updates.available.version}</h3><p className="muted">{t('Updates.installed_version')} {updates.available.currentVersion}</p></div></div>
    <p className="muted">{t('Updates.your_library_models_and_preferences_stay_in_place')}</p>
    {updates.available.notes && <div className="update-notes">{updates.available.notes}</div>}
    {updates.installing && <div className="update-progress" role="status"><progress max={100} value={percent}/><span>{label}</span></div>}
    {busy && <p className="section-note">{t('Updates.waiting_for_work_to_finish')}</p>}
    {updates.error && <p className="field-error" role="alert">{errorMessage(updates.error)}</p>}
    <footer><button onClick={() => updates.setOpen(false)}>{t('Updates.later')}</button><button className="primary" disabled={updates.installing || updates.checking} onClick={() => void updates.install()}>{updates.installing ? label : t('Updates.update_and_restart')}</button></footer>
  </Modal>;
}
