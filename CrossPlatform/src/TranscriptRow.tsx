import { t, useLocale, locale } from './i18n';
import { deliveredText, isNoSpeechTranscript, processingBusy, recognitionBusy } from './transcriptProcessing';
import type { ProcessTranscript, RetryRecognition } from './transcriptProcessing';
import { TranscriptError } from './TranscriptError';
import type { Transcript } from './types';
import type { MouseEventHandler } from 'react';
import { Icon } from './ui';
import './transcript-row.css';

interface TranscriptRowProps {
  item: Transcript;
  onCopy: MouseEventHandler<HTMLButtonElement>;
  onDelete: () => void;
  onOpen?: () => void;
  onProcess?: ProcessTranscript;
  onRecognize?: RetryRecognition;
  pending?: boolean;
}

export function TranscriptRow({ item, onCopy, onDelete, onOpen, onProcess, onRecognize, pending = false }: TranscriptRowProps) {
  useLocale();
  if (isNoSpeechTranscript(item)) return null;
  const date = new Date(item.timestamp * 1000);
  const recognizing = recognitionBusy(item) || (pending && item.status === 'failed');
  const busy = pending || processingBusy(item) || recognizing;
  const content = <p className="transcript-preview">{deliveredText(item) || (item.status === 'pending' ? t('common.recognizing') : t('common.recognition_failed'))}</p>;

  return <article className="transcript-row" aria-busy={busy}>
    <div className="transcript-body">
      <time dateTime={date.toISOString()} title={date.toLocaleString(locale())}>
        {date.toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </time>
      <div className="transcript-text"><TranscriptError item={item} pending={pending} onProcess={onProcess} onRecognize={onRecognize}/>
        {onOpen ? <button className="transcript-open" onClick={onOpen}>{content}</button> : content}
      </div>
      {busy && <div className="transcript-processing" aria-live="polite"><span className="transcript-progress" role="status"><span className="transcript-spinner" aria-hidden="true"/>{recognizing ? t('common.recognizing') : t('TranscriptDetail.enhancing_original_saved')}</span></div>}
    </div>
    <div className="transcript-actions">
      <button className="icon-button" aria-label={t('TranscriptRow.copy_transcription')} title={t('common.copy')} disabled={!deliveredText(item)} onClick={onCopy}><Icon name="copy" size={16}/></button>
      <button className="icon-button" aria-label={t('TranscriptRow.delete_transcription')} title={t('common.delete')} disabled={busy || item.status === 'pending'} onClick={onDelete}><Icon name="close" size={16}/></button>
    </div>
  </article>;
}
