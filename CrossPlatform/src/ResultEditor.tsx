import { t, useLocale } from './i18n';
import { useRef, useState } from 'react';
import { call, deliveredText, errorMessage, errorSource } from './api';
import type { Transcript, DictionaryEntry } from './types';
import { Field } from './ui';
import './result-editor.css';

export function ResultEditor({item, onSaved, refresh}: {item: Transcript; onSaved: (item: Transcript) => void; refresh: () => Promise<void>}) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const [before, setBefore] = useState('');
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState('');
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const replacementId = useRef(crypto.randomUUID());
  const editor = useRef<HTMLTextAreaElement>(null);

  function edit() {
    const current = deliveredText(item);
    setBefore(current); setText(current); setEditing(true); setAdding(false); setSaved(false); setError(''); setNotice('');
    requestAnimationFrame(() => editor.current?.focus());
  }
  async function save() {
    if (busy || !text.trim() || text === before) return;
    setBusy(true); setError('');
    try {
      const next = await call<Transcript>('save_transcript_correction', {id: item.id, expectedText: before, text});
      onSaved(next); setBefore(deliveredText(next)); setEditing(false); setSaved(true);
      setNotice(t('ResultEditor.correction_saved_the_original_dictation_is_preserved'));
      await refresh();
    } catch (cause) { setError(errorSource(cause)); }
    finally { setBusy(false); }
  }
  async function addReplacement() {
    if (busy || !word.trim() || !replacement.trim()) return;
    setBusy(true); setError('');
    try {
      const entry: DictionaryEntry = {id: replacementId.current, word: word.trim(), replacement: replacement.trim(), enabled: true};
      await call('add_dictionary_correction', {entry});
      setAdding(false); setWord(''); setReplacement(''); replacementId.current = crypto.randomUUID();
      setNotice(t('ResultEditor.replacement_added_to_the_dictionary')); await refresh();
    } catch (cause) { setError(errorSource(cause)); }
    finally { setBusy(false); }
  }
  return <section className="result-editor" aria-label={t('ResultEditor.correct_transcription')}>
    {!editing ? <button type="button" disabled={busy || item.status !== 'completed' || ('processingState' in item && item.processingState === 'processing')} onClick={edit}>{t('ResultEditor.edit_result')}</button> : <form onSubmit={event => {event.preventDefault(); void save();}}>
      <Field label={t('ResultEditor.corrected_result')}><textarea ref={editor} rows={6} value={text} disabled={busy} onChange={event => setText(event.target.value)}/></Field>
      <p className="muted">{t('ResultEditor.only_this_result_changes_the_original_dictation_stays')}</p>
      <div className="result-editor-actions"><button type="button" disabled={busy} onClick={() => {setEditing(false); setError('');}}>{t('common.cancel')}</button><button className="primary" disabled={busy || !text.trim() || text === before}>{busy ? t('common.saving') : t('ResultEditor.save_correction')}</button></div>
    </form>}
    {(saved || item.manualCorrection) && !editing && !adding && <button type="button" disabled={busy} onClick={() => {setAdding(true); setNotice(''); setError('');}}>{t('ResultEditor.add_correction_to_dictionary')}</button>}
    {adding && <form className="result-dictionary-form" onSubmit={event => {event.preventDefault(); void addReplacement();}}>
      <p>{t('ResultEditor.choose_the_word_or_phrase_to_correct_in')}</p>
      <Field label={t('ResultEditor.word_or_phrase_to_replace')}><input autoFocus value={word} disabled={busy} onChange={event => setWord(event.target.value)}/></Field>
      <Field label={t('Dictionary.replace_with')}><input value={replacement} disabled={busy} onChange={event => setReplacement(event.target.value)}/></Field>
      <div className="result-editor-actions"><button type="button" disabled={busy} onClick={() => {setAdding(false); setError('');}}>{t('common.cancel')}</button><button className="primary" disabled={busy || !word.trim() || !replacement.trim()}>{busy ? t('common.adding') : t('ResultEditor.add_replacement')}</button></div>
    </form>}
    {item.manualCorrection && <details><summary>{t('ResultEditor.result_before_correction')}</summary><p className="transcript-detail">{item.manualCorrection.previousText}</p></details>}
    {notice && <p className="result-editor-notice" role="status">{notice}</p>}
    {error && <p className="inline-error" role="alert">{errorMessage(error)}</p>}
  </section>;
}
