import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from './i18n';
import { call, deliveredText, errorMessage } from './api';
import type { Transcript } from './types';
import type { Props } from './pages';
import type { ProcessingProps } from './transcriptProcessing';
import { Empty } from './ui';
import { shortcutLabel } from './shortcuts';
import { TranscriptRow } from './TranscriptRow';
import { useViewActive } from './RetainedView';
import { emptyHistory, TranscriptHistoryPager } from './transcriptHistory';
import './transcript-history.css';

export function TranscriptFeed({data,copyWithFeedback,processing,onProcess,onRecognize,onOpen,onDelete,historyRequest=0}: Pick<Props,'data'|'copyWithFeedback'> & ProcessingProps & {onOpen:(item:Transcript)=>void;onDelete:(item:Transcript)=>void;historyRequest?:number}) {
  useLocale();
  const active = useViewActive();
  const [state,setState] = useState(emptyHistory);
  const [pager] = useState(() => new TranscriptHistoryPager(request => call<Transcript[]>('history', {...request}), setState, 10));
  const section = useRef<HTMLElement>(null), end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (historyRequest) section.current?.scrollIntoView({block:'start'}); }, [historyRequest]);
  useEffect(() => {
    if (!active) return;
    void pager.reload();
    return () => pager.cancel();
  }, [active,data.recent,pager]);
  useEffect(() => {
    if (!active || state.loading || !state.more || state.error) return;
    const root = section.current?.closest('.scroll-area-viewport');
    if (!root || !end.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void pager.loadMore();
    }, {root,rootMargin:'0px 0px 400px 0px'});
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [active,state.loading,state.more,state.error,state.items,pager]);

  const items = state.items.length ? state.items : data.recent.slice(0,10);
  return <section ref={section} className="recent panel transcript-list" aria-labelledby="recent-transcripts-title">
    <div className="recent-heading"><h2 id="recent-transcripts-title">{t('Dashboard.recent_transcripts')}</h2></div>
    {items.length ? items.map(item => <TranscriptRow key={item.id} item={item} onOpen={() => onOpen(item)} onProcess={onProcess} onRecognize={onRecognize} pending={processing.has(item.id)} onCopy={event => copyWithFeedback(event,() => call('copy_text',{text:deliveredText(item)}))} onDelete={() => onDelete(item)}/>) : !state.loading&&!state.error&&<Empty icon="history" title={t('Dashboard.a_little_more_time_for_you')} body={t('Empty.history_body')} detail={<><kbd>{shortcutLabel(data.preferences.shortcut,data.platform)}</kbd>{t(data.preferences.shortcutMode==='toggle'?'App.press_to_dictate':data.preferences.shortcutMode==='hybrid'?'Settings.tap_or_hold':'App.hold_to_dictate')}</>}/>}
    <div ref={end} className="recent-end" aria-hidden="true"/>
    {(state.loading || state.error || !state.more && state.items.length > 0) && <div className={`recent-footer${!items.length?' is-initial':''}`}>
      {state.loading ? <span className="transcript-progress" role="status"><span className="transcript-spinner" aria-hidden="true"/>{t('common.loading')}</span> : state.error ? <><p className="field-error" role="alert">{errorMessage(state.error)}</p><button onClick={() => void pager.retry()}>{t('History.retry')}</button></> : <span className="muted">{t('History.all_loaded')}</span>}
    </div>}
  </section>;
}
