import { t, useLocale } from './i18n';
import { useEffect, useState } from 'react';
import { call, openUrl, savedTime } from './api';
import type { Transcript } from './types';
import type { Props } from './pages';
import { Icon, Modal } from './ui';
import { TranscriptFeed } from './TranscriptFeed';
import type { ProcessingProps } from './transcriptProcessing';
import { useViewActive } from './RetainedView';

const metricCount=4;
const blankKeys=(count:number)=>Array.from({length:count},(_,i)=><span className="keyboard-key keyboard-blank" aria-hidden="true" key={i}/>);
export function Dashboard({data,run,refresh,notify,copyWithFeedback,processing:processingIds,onProcess,onRecognize,onInsights,historyRequest,onOpen}:Props&ProcessingProps&{onInsights:()=>void;historyRequest?:number;onOpen:(item:Transcript)=>void}){
  useLocale();
  const active = useViewActive();
  const [importing,setImporting]=useState(false),[deleting,setDeleting]=useState<Transcript|null>(null);
  const [metric,setMetric]=useState({index:0,direction:1,animating:false});
  const metrics=[
    {label:t('Dashboard.you_have_saved'),value:savedTime(data.stats.savedSeconds)},
    {label:t('Dashboard.words_dictated'),value:data.stats.words.toLocaleString()},
    {label:t('Dashboard.dictation_sessions'),value:data.stats.sessions.toLocaleString()},
    {label:t('Dashboard.time_spent_dictating'),value:savedTime(data.stats.duration)},
  ];
  const changeMetric=(direction:number)=>setMetric(current=>({index:(current.index+direction+metricCount)%metricCount,direction,animating:true}));
  useEffect(()=>{
    if(!active){setMetric(current=>current.animating?{...current,animating:false}:current);return;}
    const navigate=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||!['ArrowLeft','ArrowRight'].includes(event.key)||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.repeat)return;
      if(window.getSelection()?.isCollapsed===false)return;
      const target=event.target instanceof Element?event.target:null;
      if(target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"]')||Array.from(document.querySelectorAll('dialog[open],[role="dialog"],[role="listbox"]')).some(element=>element.getClientRects().length>0))return;
      event.preventDefault();
      const direction=event.key==='ArrowRight'?1:-1;
      setMetric(current=>({index:(current.index+direction+metricCount)%metricCount,direction,animating:true}));
    };
    window.addEventListener('keydown',navigate);return()=>window.removeEventListener('keydown',navigate);
  },[active]);
  const latestText=data.latestTranscriptText??'';
  return <div className="dashboard">
    <section className="dashboard-hero" aria-label={t('Dashboard.dictation_keyboard')}>
      <div className="saved-time" role="status" aria-live="polite" aria-atomic="true"><div key={metric.index} className={`dashboard-metric ${metric.animating?'is-changing':''} ${metric.direction>0?'metric-forward':'metric-backward'}`} onAnimationEnd={()=>setMetric(current=>({...current,animating:false}))}><p>{metrics[metric.index].label}</p><h1>{metrics[metric.index].value}</h1></div></div>
      <div className="keyboard">
        <div className="keyboard-row keyboard-row-top">{blankKeys(12)}</div>
        <div className="keyboard-row keyboard-row-middle">
          <button className="keyboard-key keyboard-insights" onClick={onInsights}><span className="keyboard-key-face"><span className="keyboard-key-label">{t('Dashboard.view_insights')}</span><span className="keyboard-key-icon"><Icon name="insights"/></span></span></button>
          {blankKeys(7)}
          <button className="keyboard-key keyboard-star" onClick={()=>void run(()=>openUrl('https://github.com/Darlingfxx02/no-tipe-releases'))}><span className="keyboard-key-icon"><Icon name="star"/></span>{t('Dashboard.star_on_github')}</button>
        </div>
        <div className="keyboard-row keyboard-row-bottom">{blankKeys(3)}
          <button className="keyboard-key keyboard-copy" disabled={!latestText.trim()} onClick={event=>copyWithFeedback(event,()=>call('copy_text',{text:latestText}))}>
            <span className="keyboard-key-face"><span className="keyboard-key-label">{t('Dashboard.copy_latest')}</span></span>
          </button>{blankKeys(1)}
          <button className="keyboard-key keyboard-stat-arrow" aria-label={t('Dashboard.previous_statistic')} aria-keyshortcuts="ArrowLeft" title={t('Dashboard.previous_statistic_2')} onClick={()=>changeMetric(-1)}><Icon name="arrow-left"/></button>
          <button className="keyboard-key keyboard-stat-arrow" aria-label={t('Dashboard.next_statistic')} aria-keyshortcuts="ArrowRight" title={t('Dashboard.next_statistic_2')} onClick={()=>changeMetric(1)}><Icon name="arrow-right"/></button>
        </div>
      </div>
    </section>
    <div className="dashboard-content">
      {data.legacyAvailable&&!data.legacyImported&&<section className="migration-card"><div><strong>{t('Dashboard.your_existing_library_is_ready_to_import')}</strong><p>{t('Dashboard.bring_over_your_history_modes_dictionary_and_preferences')}</p></div><button disabled={importing} className="primary" onClick={()=>void run(async()=>{setImporting(true);try{const n=await call<number>('import_legacy');await refresh();notify(t('common.imported_transcripts',{count:n}));}finally{setImporting(false);}})}>{importing?t('Dashboard.importing'):t('Dashboard.import_library')}</button></section>}
      <TranscriptFeed data={data} copyWithFeedback={copyWithFeedback} processing={processingIds} onProcess={onProcess} onRecognize={onRecognize} onDelete={setDeleting} onOpen={onOpen} historyRequest={historyRequest}/>
    </div>
    {deleting&&<Modal title={t('Dashboard.delete_transcription')} onClose={()=>setDeleting(null)}><p>{t('Dashboard.this_removes_the_transcript_from_history_your_all')}</p><footer><button onClick={()=>setDeleting(null)}>{t('common.cancel')}</button><button className="danger" onClick={()=>void run(async()=>{await call('delete_item',{collection:'transcripts',id:deleting.id});setDeleting(null);await refresh();})}>{t('common.delete')}</button></footer></Modal>}
  </div>;
}
