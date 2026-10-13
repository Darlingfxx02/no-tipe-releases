import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from './i18n';
import { HelpHint } from './HelpHint';
import type { Preferences } from './types';
import './usage-consent.css';

export function UsageConsent({save}:{save:(patch:Partial<Preferences>)=>Promise<unknown>}) {
  useLocale();
  const dialog=useRef<HTMLDialogElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  async function choose(value:boolean){setBusy(true);setError(false);try{await save({usageAnalytics:value});}catch{setBusy(false);setError(true);}}
  return <dialog ref={dialog} className="usage-consent" aria-labelledby="usage-consent-title" onCancel={event=>{event.preventDefault();if(!busy)void choose(false);}}>
    <h2 id="usage-consent-title">{t('Analytics.title')}</h2>
    <p>{t('Analytics.description')}</p>
    <div className="usage-consent-detail">{t('Analytics.excluded')} <HelpHint label={t('Analytics.title')}>{t('Analytics.help')}</HelpHint></div>
    {error&&<p className="field-error" role="alert">{t('Analytics.save_error')}</p>}
    <div className="usage-consent-actions"><button disabled={busy} onClick={()=>void choose(false)} autoFocus>{t('Analytics.decline')}</button><button className="primary" disabled={busy} onClick={()=>void choose(true)}>{t('Analytics.allow')}</button></div>
  </dialog>;
}
