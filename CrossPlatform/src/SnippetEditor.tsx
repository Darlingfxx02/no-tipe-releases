import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import type { Snippet } from './types';
import { errorMessage, errorSource } from './api';
import { Icon } from './ui';
import { useViewActive } from './RetainedView';
import { characterCount, fillEditor, readEditor, snippetError } from './snippetText';
import './design-controls.css';

const getEditorFormats = () => ([
  {command: 'bold', label: t('SnippetEditor.bold'), icon: 'bold'},
  {command: 'italic', label: t('SnippetEditor.italic'), icon: 'italic'},
  {command: 'insertUnorderedList', label: t('SnippetEditor.bulleted_list'), icon: 'bulleted'},
  {command: 'insertOrderedList', label: t('SnippetEditor.numbered_list'), icon: 'numbered'},
] as const);

function FormatIcon({name}: {name: ReturnType<typeof getEditorFormats>[number]['icon'] | 'link'}) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    {name === 'bold' ? <path strokeWidth="2" d="M6 3.5v13h5a3.5 3.5 0 0 0 0-7H6h4.5a3 3 0 0 0 0-6H6Z"/>
      : name === 'italic' ? <path d="M9 3.5h6M5 16.5h6M12 3.5l-4 13"/>
      : name === 'bulleted' ? <><path d="M8 5h9M8 10h9M8 15h9"/><g fill="currentColor" stroke="none"><circle cx="3.5" cy="5" r="1"/><circle cx="3.5" cy="10" r="1"/><circle cx="3.5" cy="15" r="1"/></g></>
      : name === 'numbered' ? <><path d="M8 5h9M8 10h9M8 15h9"/><path strokeWidth="1.3" d="m2 3 1.5-1v5M2 7h3M2 11.5a1.5 1.5 0 0 1 3 0c0 1-3 2.5-3 4v.5h3"/></>
      : <path d="m8 12 4-4M7 9l-2 2a3.5 3.5 0 0 0 5 5l2-2M8 6l2-2a3.5 3.5 0 0 1 5 5l-2 2"/>}
  </svg>;
}

export function SnippetEditor({entry, onClose, onSave}: {
  entry: Snippet | null;
  onClose: () => void;
  onSave: (snippet: Snippet) => Promise<void>;
}) {
  useLocale();
  const active = useViewActive();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const [id] = useState(() => entry?.id ?? crypto.randomUUID());
  const [trigger, setTrigger] = useState(entry?.trigger ?? '');
  const [text, setText] = useState(entry?.expansion ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [activeFormats, setActiveFormats] = useState<string[]>([]);

  function updateFormats() {
    const current = window.getSelection();
    setActiveFormats(editor.current?.contains(current?.anchorNode ?? null)
      ? getEditorFormats().filter(({command}) => document.queryCommandState(command)).map(({command}) => command)
      : []);
  }

  useEffect(() => {
    fillEditor(editor.current!, entry?.expansion ?? '', entry?.formatting ?? []);
  }, []);

  useEffect(() => {
    if (!active) return;
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    document.addEventListener('selectionchange', updateFormats);
    return () => {
      document.removeEventListener('selectionchange', updateFormats);
      element.close();
    };
  }, [active]);

  function changed() {
    setText(readEditor(editor.current!).text);
    updateFormats();
  }

  function format(command: string, value?: string) {
    editor.current!.focus();
    document.execCommand(command, false, value);
    changed();
  }

  function openLink() {
    const current = window.getSelection();
    if (!current?.rangeCount || !editor.current?.contains(current.anchorNode) || current.isCollapsed) {
      setError(t('SnippetEditor.select_text_to_add_a_link'));
      return;
    }
    selection.current = current.getRangeAt(0).cloneRange();
    setLink('');
    setLinkOpen(true);
  }

  function insertLink() {
    try {
      const url = new URL(link);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw Error();
      const current = window.getSelection();
      current?.removeAllRanges();
      if (selection.current) current?.addRange(selection.current);
      format('createLink', url.href);
      setLinkOpen(false);
      setError('');
    } catch {
      setError(t('SnippetEditor.enter_a_valid_http_https_or_mailto_link'));
    }
  }

  async function submit() {
    const value = readEditor(editor.current!);
    const validation = snippetError(trigger, value.text);
    if (saving) return;
    if (validation) {setError(validation); return;}
    setSaving(true);
    setError('');
    try {
      await onSave({id, trigger: trigger.trim(), expansion: value.text, formatting: value.formatting,
        enabled: entry?.enabled ?? true, dateAdded: entry?.dateAdded ?? Date.now() / 1000});
      onClose();
    } catch (error) {
      setError(errorSource(error));
    } finally {
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="snippet-dialog snippet-editor" aria-labelledby="snippet-editor-title"
    onCancel={event => {event.preventDefault(); if (linkOpen) setLinkOpen(false); else if (!saving) onClose();}}
    onClick={event => {
      if (event.target !== event.currentTarget || saving) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    onKeyDown={event => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === 'Enter') {event.preventDefault(); void submit();}
      if (saving) return;
      if (event.key.toLowerCase() === 'k') {event.preventDefault(); openLink();}
      if (editor.current?.contains(event.target as Node) && ['b', 'i'].includes(event.key.toLowerCase())) {
        event.preventDefault(); format(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
      }
    }}>
    <header>
      <h2 id="snippet-editor-title">{entry ? t('SnippetEditor.edit_snippet') : t('SnippetEditor.new_snippet')}</h2>
      <button className="icon-button" aria-label={t('common.close')} disabled={saving} onClick={onClose}>
        <Icon name="close" src="/assets/models/close.svg" size={20}/>
      </button>
    </header>
    <form onSubmit={event => {event.preventDefault(); void submit();}}>
      <label className="field">
        <span className="snippet-field-label">{t('SnippetEditor.spoken_phrase')} <small>{characterCount(trigger)}/60</small></span>
        <input ref={input} value={trigger} disabled={saving} placeholder={t('SnippetEditor.e_g_my_email_signature')}
          onChange={event => setTrigger(Array.from(event.target.value).slice(0, 60).join(''))}/>
      </label>
      <div className="field">
        <span id="snippet-text-label" className="snippet-field-label">{t('SnippetEditor.saved_text')}<small className={characterCount(text) > 4000 ? 'over-limit' : ''}>{characterCount(text)}/4000</small>
        </span>
        <div className="snippet-rich-editor">
          <div className="snippet-format-toolbar" role="toolbar" aria-label={t('SnippetEditor.text_formatting')}>
            {getEditorFormats().map(({command, label, icon}) => <button key={command} type="button" disabled={saving}
              aria-label={label} aria-pressed={activeFormats.includes(command)} title={label}
              onMouseDown={event => event.preventDefault()} onClick={() => format(command)}><FormatIcon name={icon}/></button>)}
            <button type="button" disabled={saving} aria-label={t('SnippetEditor.insert_link')} aria-expanded={linkOpen} title={t('SnippetEditor.insert_link')}
              onMouseDown={event => event.preventDefault()} onClick={openLink}><FormatIcon name="link"/></button>
          </div>
          <div ref={editor} className="snippet-editable" contentEditable={!saving} suppressContentEditableWarning
            role="textbox" aria-multiline="true" aria-labelledby="snippet-text-label" onInput={changed}
            onPaste={event => {event.preventDefault(); format('insertText', event.clipboardData.getData('text/plain'));}}/>
        </div>
      </div>
      {linkOpen && <div className="snippet-link-form">
        <input aria-label={t('SnippetEditor.link_url')} placeholder={t('SnippetEditor.https_example_com')} value={link} disabled={saving}
          onChange={event => setLink(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); insertLink();}}}/>
        <button className="notype-button" type="button" disabled={saving} onClick={insertLink}>{t('SnippetEditor.insert')}</button>
        <button className="icon-button" type="button" aria-label={t('SnippetEditor.cancel_link')} disabled={saving} onClick={() => setLinkOpen(false)}>
          <Icon name="close" src="/assets/models/close.svg" size={20}/>
        </button>
      </div>}
      {error && <p className="inline-error" role="alert">{errorMessage(error)}</p>}
      <footer>
        <button className="notype-button" type="button" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
        <button className="notype-button notype-button-primary" disabled={saving || !!snippetError(trigger, text)} type="submit">
          {saving ? t('common.saving') : entry ? t('common.save_changes') : t('SnippetEditor.add_snippet')}
        </button>
      </footer>
    </form>
  </dialog>;
}
