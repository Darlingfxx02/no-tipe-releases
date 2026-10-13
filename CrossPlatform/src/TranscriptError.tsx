import { t, useLocale } from './i18n';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { call, errorMessage, errorSource } from './api';
import { useViewActive } from './RetainedView';
import { Modal } from './ui';
import { canRetryProcessing, canRetryRecognition, processingBusy, recognitionBusy, processingSummary, savedProcessing, transcriptErrors } from './transcriptProcessing';
import type { ProcessTranscript, ProcessingOptions, RetryRecognition } from './transcriptProcessing';
import type { ProcessingConfiguration, Transcript } from './types';

export const TranscriptErrorDialogState = createContext<(open: boolean) => void>(() => {});

export function TranscriptErrorDetails({ item, pending = false, onProcess }: { item: Transcript; pending?: boolean; onProcess?: ProcessTranscript }) {
  useLocale();
  const errors = transcriptErrors(item);
  const multipleErrors = Object.values(errors).filter(Boolean).length > 1;
  const saved = savedProcessing(item);
  const canEnhance = Boolean(onProcess && canRetryProcessing(item));
  const [current, setCurrent] = useState<ProcessingConfiguration | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const busy = requesting || pending || processingBusy(item);
  const configuration = saved?.prompt ? saved : current;
  const needsCurrent = canEnhance && !saved?.prompt;
  useEffect(() => {
    if (!needsCurrent) return;
    let active = true;
    setCurrent(null);setLoadError('');
    void call<ProcessingOptions>('transcript_processing_options', { id: item.id }).then(options => {
      if (active) setCurrent(options.current);
    }).catch(error => { if (active) setLoadError(errorSource(error)); });
    return () => { active = false; };
  }, [item.id, needsCurrent, attempt]);
  async function enhance() {
    if (busy || !canEnhance || !configuration?.prompt || !onProcess) return;
    setRequesting(true);
    try { await onProcess(item, saved?.prompt ? 'saved' : 'current', saved?.prompt ? undefined : configuration); }
    finally { setRequesting(false); }
  }
  return <div className="transcript-error-details">
    {errors.recognition && <section>{multipleErrors && <h3>{t('TranscriptDetail.recognition_error')}</h3>}<p className="transcript-error-message">{errorMessage(errors.recognition)}</p><p className="muted">{t('TranscriptError.start_a_new_dictation_to_try_recognition_again')}</p></section>}
    {errors.processing && <section>{multipleErrors && <h3>{t('TranscriptDetail.processing_error')}</h3>}<p className="transcript-error-message">{errorMessage(errors.processing)}</p><p className="muted">{item.text.trim() ? t('TranscriptError.the_original_text_is_saved') : t('TranscriptError.no_original_text_was_saved')}</p></section>}
    {errors.delivery && <section>{multipleErrors && <h3>{t('TranscriptDetail.delivery_error')}</h3>}<p className="transcript-error-message">{errorMessage(errors.delivery)}</p><p className="muted">{t('TranscriptError.the_text_is_saved_copy_it_from_the')}</p></section>}
    {canEnhance && <>
      {needsCurrent && (configuration ? <p className="muted">{t('TranscriptError.uses_current_settings')} {processingSummary(configuration)}</p> : !loadError && <p className="muted" role="status">{t('TranscriptError.loading_enhancement_settings')}</p>)}
      {item.sessionConfig?.clipboardContext && <p className="muted">{t('TranscriptError.the_earlier_clipboard_context_is_not_retained_enhance')}</p>}
      {loadError && <p className="inline-error" role="alert">{errorMessage(loadError)}</p>}
      <footer>{loadError && <button disabled={busy} onClick={() => setAttempt(value => value + 1)}>{t('TranscriptError.reload_settings')}</button>}<button className="primary" disabled={busy || !configuration?.prompt} onClick={() => void enhance()}>{busy ? t('TranscriptDetail.enhancing') : t('common.enhance')}</button></footer>
    </>}
  </div>;
}

function ErrorDialog({ item, pending, onProcess, onClose, requestError }: { item: Transcript; pending: boolean; onProcess?: ProcessTranscript; onClose: () => void; requestError?: string }) {
  useLocale();
  const content = useRef<HTMLDivElement>(null);
  const errors = transcriptErrors(item);
  const title = Object.values(errors).filter(Boolean).length > 1 ? t('TranscriptError.transcription_errors') : errors.processing ? t('TranscriptError.enhancement_failed') : errors.recognition ? t('common.recognition_failed') : t('TranscriptError.delivery_failed');
  useEffect(() => {
    const dialog = content.current?.closest('dialog');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();onClose();return; }
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault();last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first?.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => document.removeEventListener('keydown', trap, true);
  }, [onClose]);
  return <Modal title={title} className="transcript-error-dialog" scrimClassName="transcript-error-scrim" closeIcon={<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m4 4 12 12M4 16 16 4"/></svg>} onClose={onClose}>
    <div ref={content}>{requestError && <p className="inline-error" role="alert">{errorMessage(requestError)}</p>}<TranscriptErrorDetails item={item} pending={pending} onProcess={onProcess}/></div>
  </Modal>;
}

export function TranscriptError({ item, pending = false, onProcess, onRecognize }: { item: Transcript; pending?: boolean; onProcess?: ProcessTranscript; onRecognize?: RetryRecognition }) {
  useLocale();
  const active = useViewActive();
  const setDialogOpen = useContext(TranscriptErrorDialogState);
  const [open, setOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const requestingRef = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const errors = transcriptErrors(item);
  const hasError = Boolean(errors.recognition || errors.processing || errors.delivery);
  const action = errors.recognition && onRecognize && canRetryRecognition(item) ? 'recognize' : !errors.recognition && onProcess && canRetryProcessing(item) ? 'enhance' : null;
  const busy = requesting || pending || processingBusy(item) || recognitionBusy(item);
  const label = action === 'recognize' ? t('TranscriptDetail.retry_transcription') : action === 'enhance' ? t('TranscriptError.enhance_transcription') : t('TranscriptError.show_transcription_error');
  const visible = open && active && hasError;
  const close = useCallback(() => { setOpen(false);trigger.current?.focus(); }, []);
  useEffect(() => { if (!active || !hasError) setOpen(false); }, [active, hasError]);
  useEffect(() => {
    if (!visible) return;
    setDialogOpen(true);
    return () => setDialogOpen(false);
  }, [visible, setDialogOpen]);
  async function recover() {
    if (!action) { setOpen(true);return; }
    if (requestingRef.current || busy) return;
    requestingRef.current = true;setRequesting(true);setRequestError('');
    try {
      if (action === 'recognize') await onRecognize!(item);
      else {
        const saved = savedProcessing(item);
        if (saved?.prompt) await onProcess!(item, 'saved');
        else {
          const options = await call<ProcessingOptions>('transcript_processing_options', { id: item.id });
          await onProcess!(item, 'current', options.current);
        }
      }
    } catch (error) { setRequestError(errorSource(error));setOpen(true); }
    finally { requestingRef.current = false;setRequesting(false); }
  }
  if (!hasError) return null;
  return <>
    <button ref={trigger} type="button" className={`transcript-error-indicator${action ? ' has-recovery' : ''}`} aria-label={label} title={label} disabled={Boolean(action && busy)} aria-busy={Boolean(action && busy)} aria-haspopup={action ? undefined : 'dialog'} aria-expanded={action ? undefined : open && active} onClick={() => void recover()}>
      <span className="transcript-error-mark" aria-hidden="true">!</span>
      {action && <svg className="transcript-error-action" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{action === 'recognize' ? <><path d="M13 6a5 5 0 1 0 .1 4"/><path d="M13 2.5V6H9.5"/></> : <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>}</svg>}
    </button>
    {open && active && createPortal(<ErrorDialog item={item} pending={pending} onProcess={onProcess} requestError={requestError} onClose={close}/>, document.body)}
  </>;
}
