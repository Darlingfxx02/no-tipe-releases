import { t, useLocale, locale } from './i18n';
import { useEffect, useState } from 'react';
import { call, errorMessage, errorSource } from './api';
import type { Bootstrap, Transcript } from './types';
import type { CopyWithFeedback } from './CopyFeedback';
import { Modal } from './ui';
import { ResultEditor } from './ResultEditor';
import { canRetryRecognition, deliveredText, processingBusy, recognitionBusy, processingSummary, transcriptErrors } from './transcriptProcessing';
import type { ProcessingOptions, ProcessingSource, ProcessTranscript, RetryRecognition } from './transcriptProcessing';

export function TranscriptDetail({item,data,pending,onClose,onUpdate,onProcess,onRecognize,copyWithFeedback,refresh}: {
  item: Transcript; data: Bootstrap; pending: boolean; onClose: () => void; onUpdate: (item: Transcript) => void;
  onProcess: ProcessTranscript; onRecognize: RetryRecognition; copyWithFeedback: CopyWithFeedback; refresh: () => Promise<void>;
}) {
  useLocale();
  const [options,setOptions] = useState<ProcessingOptions|null>(null);
  const [source,setSource] = useState<ProcessingSource>('saved');
  const [error,setError] = useState('');
  const busy = pending || processingBusy(item) || recognitionBusy(item);
  const errors = transcriptErrors(item);
  const configurationKey = JSON.stringify(item.processingConfig);
  useEffect(() => {
    let active = true;
    void call<Transcript>('transcript',{id:item.id}).then(next => {if(active && JSON.stringify(next)!==JSON.stringify(item))onUpdate(next);}).catch(e => {if(active)setError(errorSource(e));});
    return () => {active=false;};
  },[item.id,data.recent,onUpdate]);
  useEffect(() => {
    let active = true;setOptions(null);setError('');
    void call<ProcessingOptions>('transcript_processing_options',{id:item.id}).then(next => {
      if(active){setOptions(next);setSource(next.saved?.prompt ? 'saved' : 'current');}
    }).catch(e => {if(active)setError(errorSource(e));});
    return () => {active=false;};
  },[item.id,configurationKey]);
  const config = options && (source === 'saved' ? options.saved : options.current);
  return <Modal title={t('TranscriptDetail.transcription')} onClose={onClose}>
    <p className="muted">{new Date(item.timestamp*1000).toLocaleString(locale())} · {item.model}</p>
    <div className="transcript-detail">{deliveredText(item) || t('TranscriptDetail.no_recognized_text_was_saved')}</div>
    {errors.recognition && <div className="inline-error"><strong>{t('TranscriptDetail.recognition_error')}</strong><p>{errorMessage(errors.recognition)}</p><p>{canRetryRecognition(item) ? t('TranscriptDetail.retry_uses_the_saved_audio_and_current_settings') : t('TranscriptDetail.the_recorded_audio_is_no_longer_available_start')}</p></div>}
    {errors.processing && <div className="inline-error"><strong>{t('TranscriptDetail.processing_error')}</strong><p>{errorMessage(errors.processing)}</p><p>{t('TranscriptDetail.the_original_dictation_is_preserved_you_can_enhance')}</p></div>}
    {errors.delivery && <div className="inline-error"><strong>{t('TranscriptDetail.delivery_error')}</strong><p>{errorMessage(errors.delivery)}</p><p>{t('TranscriptDetail.copy_the_saved_text_to_use_it_in')}</p></div>}
    {item.enhancedText && <details><summary>{t('TranscriptDetail.original_dictation')}</summary><p className="transcript-detail">{item.text}</p></details>}
    {item.status === 'completed' && <ResultEditor key={item.id} item={pending ? {...item,processingState:'processing'} : item} onSaved={onUpdate} refresh={refresh}/>}
    {item.status === 'completed' && item.text.trim() && <section className="transcript-review-options" aria-label={t('TranscriptDetail.processing_settings')}>
      <label>{t('TranscriptDetail.processing_settings')}<select aria-label={t('TranscriptDetail.processing_settings')} value={source} disabled={busy || !options} onChange={e=>setSource(e.target.value as ProcessingSource)}>
        <option value="saved" disabled={!options?.saved?.prompt}>{t('TranscriptDetail.saved_settings')}</option><option value="current">{t('TranscriptDetail.current_settings')}</option>
      </select></label>
      {config && <><p className="muted">{processingSummary(config)}</p>{config.instructions && <details><summary>{t('Modes.instructions')}</summary><p>{config.instructions}</p></details>}</>}
      {!options?.saved?.prompt && options && <p className="muted">{t('TranscriptDetail.this_entry_has_no_saved_processing_rules_enhance')}</p>}
      {item.sessionConfig?.clipboardContext && <p className="muted">{t('TranscriptDetail.repeat_processing_uses_the_saved_text_and_rules')}</p>}
      {busy && <p className="transcript-progress" role="status"><span className="transcript-spinner" aria-hidden="true"/>{t('TranscriptDetail.enhancing_original_saved')}</p>}
    </section>}
    {error && <p className="inline-error" role="alert">{errorMessage(error)}</p>}
    <footer><button disabled={!deliveredText(item)} onClick={event=>copyWithFeedback(event,()=>call('copy_text',{text:deliveredText(item)}))}>{t('Transcribe.copy_text')}</button>
      {canRetryRecognition(item) && <button className="primary" disabled={busy} onClick={()=>void onRecognize(item)}>{busy?t('common.recognizing'):t('TranscriptDetail.retry_transcription')}</button>}
      {item.status === 'completed' && item.text.trim() && <button className="primary" disabled={busy || !config?.prompt} onClick={()=>void onProcess(item,source,source==='current'?config!:undefined)}>{busy?t('TranscriptDetail.enhancing'):t('common.enhance')}</button>}
    </footer>
  </Modal>;
}
