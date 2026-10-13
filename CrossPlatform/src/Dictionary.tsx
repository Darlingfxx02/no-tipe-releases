import { t, useLocale } from './i18n';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { RetainedView, useViewActive } from './RetainedView';
import { call, errorMessage, errorSource } from './api';
import type { Props } from './pages';
import type { DictionaryEntry } from './types';
import { Empty, Field, Switch } from './ui';
import { HelpHint } from './HelpHint';
import { Snippets } from './Snippets';
import './dictionary.css';

type DictionarySection = 'words' | 'replacements';
const dictionarySections = ['words','replacements','snippets'] as const;
type DictionaryTab = (typeof dictionarySections)[number];

function EditIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.5 4 3.5 3.5M3 17l4.5-1 9-9a2.5 2.5 0 0 0-3.5-3.5l-9 9L3 17Z"/></svg>;
}

function DeleteIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M8 5V3h4v2M5 5l.7 11a1 1 0 0 0 1 1h6.6a1 1 0 0 0 1-1L15 5M8 8v6m4-6v6"/></svg>;
}

function StarIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m10 2.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L10 2.2Z"/></svg>;
}

function DictionaryEditor({entry, section, onSave, onClose}: {
  entry: DictionaryEntry | null;
  section: DictionarySection;
  onSave: (entry: DictionaryEntry) => Promise<void>;
  onClose: () => void;
}) {
  useLocale();
  const active = useViewActive();
  const dialog = useRef<HTMLDialogElement>(null);
  const wordInput = useRef<HTMLInputElement>(null);
  const [word, setWord] = useState(entry?.word ?? '');
  const [replacement, setReplacement] = useState(entry?.replacement ?? '');
  const [correctMisspelling, setCorrectMisspelling] = useState(section === 'replacements');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isReplacement = entry ? entry.replacement !== null : correctMisspelling;
  const canSave = Boolean(word.trim() && (entry || !isReplacement || replacement.trim()));
  // Keep the id stable when a save succeeds but refreshing the library fails.
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());

  useEffect(() => {
    if (!active) return;
    const element = dialog.current!;
    element.showModal();
    wordInput.current?.focus();
    return () => element.close();
  }, [active]);

  async function submit() {
    if (!canSave || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({id, word: word.trim(), replacement: isReplacement ? (entry ? replacement : replacement.trim()) : null, enabled: entry?.enabled ?? true});
      onClose();
    } catch (error) {
      setError(errorSource(error));
    } finally {
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="dictionary-editor" aria-labelledby="dictionary-editor-title"
    onCancel={event => {event.preventDefault(); if (!saving) onClose();}}
    onClick={event => {
      if (event.target !== event.currentTarget || saving) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header>
      <h2 id="dictionary-editor-title">{entry ? t('Dictionary.edit_word') : t('Dictionary.add_to_vocabulary')}</h2>
      <button className="icon-button" aria-label={t('common.close')} disabled={saving} onClick={onClose}>×</button>
    </header>
    <form onSubmit={event => {event.preventDefault(); void submit();}}>
      {!entry && <>
        <div className="dictionary-correction-option">
          <div className="dictionary-correction-label">
            <span>{t('Dictionary.correct_a_misspelling')}</span>
            <HelpHint label={t('Dictionary.about_spelling_corrections')}>{t('Dictionary.replace_a_misspelled_word_with_the_correct_spelling')}</HelpHint>
          </div>
          <Switch label={t('Dictionary.correct_a_misspelling')} value={correctMisspelling} disabled={saving} onChange={setCorrectMisspelling}/>
        </div>
      </>}
      {!entry && !isReplacement ? <input ref={wordInput} className="dictionary-new-word" aria-label={t('Dictionary.new_word')} placeholder={t('Dictionary.add_a_new_word')} value={word} disabled={saving} onChange={event => setWord(event.target.value)} required/>
        : <Field label={entry ? t('Dictionary.word_or_phrase') : t('Dictionary.misspelled_word')}><input ref={wordInput} placeholder={entry ? t('Dictionary.original_word_or_phrase') : t('Dictionary.word_to_correct')} value={word} disabled={saving} onChange={event => setWord(event.target.value)} required/></Field>}
      {isReplacement && <Field label={entry ? t('Dictionary.replace_with') : t('Dictionary.correct_spelling')}>
        {entry ? <textarea rows={3} placeholder={t('Dictionary.replacement_text')} value={replacement} disabled={saving} onChange={event => setReplacement(event.target.value)}/>
          : <input placeholder={t('Dictionary.correct_spelling')} value={replacement} disabled={saving} onChange={event => setReplacement(event.target.value)} required/>}
      </Field>}
      {error && <p className="inline-error" role="alert">{errorMessage(error)}</p>}
      <footer>
        <button type="button" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" type="submit" disabled={!canSave || saving}>{saving ? t('common.saving') : entry ? t('common.save_changes') : t('common.add_word')}</button>
      </footer>
    </form>
  </dialog>;
}

export function Dictionary(props: Props & {snippetsRequest?:number}) {
  useLocale();
  const {data,run,refresh,snippetsRequest} = props;
  const active = useViewActive();
  const [section, setSection] = useState<DictionaryTab>('words');
  const [editor, setEditor] = useState<{entry: DictionaryEntry | null; section: DictionarySection} | null>(null);
  const [busyEntries, setBusyEntries] = useState<Set<string>>(new Set());
  const [snippetsActions,setSnippetsActions] = useState<HTMLDivElement|null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const entries = data.dictionary.filter(entry => (entry.replacement !== null) === (section === 'replacements'));
  useEffect(() => { if (snippetsRequest) setSection('snippets'); }, [snippetsRequest]);

  useEffect(() => {
    if (active && !editor && returnFocus.current) (returnFocus.current.isConnected ? returnFocus.current : addButton.current)?.focus();
  }, [editor, active]);

  function openEditor(button: HTMLButtonElement, entry: DictionaryEntry | null) {
    if (section === 'snippets') return;
    returnFocus.current = button;
    setEditor({entry, section});
  }

  function navigateSections(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = dictionarySections.indexOf(section);
    const next = event.key === 'Home' ? 'words' : event.key === 'End' ? 'snippets' : dictionarySections[(index + (event.key === 'ArrowRight' ? 1 : 2)) % dictionarySections.length];
    setSection(next);
    document.getElementById(`dictionary-${next}-tab`)?.focus();
  }

  async function put(entry: DictionaryEntry) {
    await call('save_dictionary', {entry});
    await refresh();
  }

  async function saveEditorEntry(entry: DictionaryEntry) {
    await put(entry);
    setSection(entry.replacement === null ? 'words' : 'replacements');
  }

  function updateEntry(id: string, work: () => Promise<void>) {
    setBusyEntries(current => new Set(current).add(id));
    void run(async () => {
      try { await work(); }
      finally { setBusyEntries(current => {const next = new Set(current); next.delete(id); return next;}); }
    });
  }

  const labels = {words:t('Dictionary.vocabulary'),replacements:t('Dictionary.replacements'),snippets:t('common.snippets')};
  const navigation = <div className="dictionary-sections" role="tablist" aria-label={t('Dictionary.dictionary_sections')}>
    {dictionarySections.map(name => <button key={name} id={`dictionary-${name}-tab`} role="tab" aria-selected={section === name} aria-controls={name === 'snippets' ? 'dictionary-snippets' : 'dictionary-entries'} tabIndex={section === name ? 0 : -1} onClick={() => setSection(name)} onKeyDown={navigateSections}>{labels[name]}</button>)}
  </div>;
  return <>
    <header className={`page-header dictionary-heading${section === 'snippets' ? ' snippets-heading' : ''}`}>
      <h1>{t('common.dictionary')}{section==='replacements'&&<HelpHint label={t('Dictionary.replacements')}>{t('Dictionary.replacements_match_whole_words_and_phrases_longer_phrases')}</HelpHint>}</h1>
      {section === 'snippets' ? <div ref={setSnippetsActions}/> : <button ref={addButton} className="primary dictionary-add" onClick={event => openEditor(event.currentTarget, null)}>{t('common.add_word')}</button>}
    </header>
    {navigation}
    {section !== 'snippets' &&
    <div id="dictionary-entries" className="dictionary-entries" role="tabpanel" aria-labelledby={section === 'words' ? 'dictionary-words-tab' : 'dictionary-replacements-tab'} tabIndex={0}>
      <div className="dictionary-table">
        {entries.length ? <ul aria-label={section === "words" ? t('Dictionary.vocabulary_words') : t('Dictionary.word_replacements')}>
          {entries.map(entry => <li key={entry.id} className={'dictionary-row' + (entry.enabled ? '' : ' is-disabled')} aria-busy={busyEntries.has(entry.id)}>
            <div className="dictionary-word" title={`${entry.word}${entry.replacement !== null ? ` → ${entry.replacement || t('Dictionary.remove_phrase')}` : ''}${entry.enabled ? '' : t('Dictionary.disabled')}`}>
              <span className="dictionary-word-text">
                {entry.word}
                {entry.replacement !== null && <><span className="dictionary-arrow" aria-label={t('Dictionary.replaced_with')}> → </span>{entry.replacement || <span className="dictionary-empty-replacement">{t('Dictionary.remove_phrase')}</span>}</>}
              </span>
            </div>
            <div className="dictionary-row-actions">
              <button className="icon-button" aria-label={t('Dictionary.edit', { value1: entry.word })} title={t('Dictionary.edit_word')} disabled={busyEntries.has(entry.id)} onClick={event => openEditor(event.currentTarget, entry)}><EditIcon/></button>
              <button className="icon-button dictionary-delete" aria-label={t('Dictionary.delete', { value1: entry.word })} title={t('Dictionary.delete_word')} disabled={busyEntries.has(entry.id)} onClick={() => updateEntry(entry.id, async () => {await call('delete_item', {collection: 'dictionary', id: entry.id}); await refresh();})}><DeleteIcon/></button>
              <button className="icon-button dictionary-star" aria-label={t('Dictionary.use_in_dictation', { value1: entry.word })} aria-pressed={entry.enabled} title={entry.enabled ? t('Dictionary.disable_word') : t('Dictionary.enable_word')} disabled={busyEntries.has(entry.id)} onClick={() => updateEntry(entry.id, () => put({...entry, enabled: !entry.enabled}))}><StarIcon/></button>
            </div>
          </li>)}
        </ul> : <Empty icon="dictionary" title={section === 'words' ? t('Dictionary.no_words_yet') : t('Dictionary.no_replacements_yet')} body={t(section === 'words' ? 'Empty.dictionary_body' : 'Empty.replacements_body')}><button className="primary" onClick={event => openEditor(event.currentTarget, null)}>{t(section === 'words' ? 'common.add_word' : 'Empty.add_replacement')}</button></Empty>}
      </div>
    </div>
    }
    <RetainedView active={section === 'snippets'}><div id="dictionary-snippets" role="tabpanel" aria-labelledby="dictionary-snippets-tab" className="dictionary-snippets-view" hidden={section !== 'snippets'} inert={section !== 'snippets'}><Snippets {...props} embedded actionsTarget={snippetsActions}/></div></RetainedView>
    {editor && <DictionaryEditor entry={editor.entry} section={editor.section} onSave={saveEditorEntry} onClose={() => setEditor(null)}/>}
  </>;
}
