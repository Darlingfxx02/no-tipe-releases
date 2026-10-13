import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open, save } from '@tauri-apps/plugin-dialog';
import { call } from './api';
import type { Props } from './pages';
import type { Snippet } from './types';
import { Empty } from './ui';
import { Select, SelectOption } from './Select';
import { SnippetEditor } from './SnippetEditor';
import { useViewActive } from './RetainedView';
import './dictionary.css';
import './snippets.css';

function ActionIcon({name}:{name:'edit'|'copy'|'delete'|'enabled'}){
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{name==='edit'?<path d="m12.5 4 3.5 3.5M3 17l4.5-1 9-9a2.5 2.5 0 0 0-3.5-3.5l-9 9L3 17Z"/>:name==='copy'?<><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 13H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/></>:name==='delete'?<path d="M3 5h14M8 5V3h4v2M5 5l.7 11a1 1 0 0 0 1 1h6.6a1 1 0 0 0 1-1L15 5M8 8v6m4-6v6"/>:<path d="m10 2.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L10 2.2Z"/>}</svg>;
}
interface ImportPreview{items:Snippet[];skipped:number}
export function Snippets({data,refresh,run,notify,copyWithFeedback,embedded=false,actionsTarget}:Props & {embedded?:boolean;actionsTarget?:HTMLElement|null}){
  useLocale();
  const active = useViewActive();
  const [search,setSearch]=useState(''),[sort,setSort]=useState('az'),[enabledOnly,setEnabledOnly]=useState(false);
  const [editor,setEditor]=useState<{entry:Snippet|null}|null>(null),[deleting,setDeleting]=useState<Snippet|null>(null),[busy,setBusy]=useState<string|null>(null);
  const [importPreview,setImportPreview]=useState<ImportPreview|null>(null);
  const actionDialog=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLButtonElement|null>(null);
  const snippets=data.snippets??[];
  useEffect(()=>{if(active&&!editor)returnFocus.current?.focus();},[editor,active]);
  useEffect(()=>{const dialog=actionDialog.current;if(!active||!dialog||(!deleting&&!importPreview))return;dialog.showModal();return()=>dialog.close();},[deleting,importPreview,active]);
  function edit(button:HTMLButtonElement,entry:Snippet|null){returnFocus.current=button;setEditor({entry});}
  async function put(snippet:Snippet){await call('save_snippet',{snippet});await refresh();}
  const entries=snippets.filter(s=>(!enabledOnly||s.enabled)&&(!search.trim()||`${s.trigger}\n${s.expansion}`.toLowerCase().includes(search.trim().toLowerCase()))).sort((a,b)=>sort==='newest'?b.dateAdded-a.dateAdded:(sort==='za'?-1:1)*a.trigger.localeCompare(b.trigger,undefined,{sensitivity:'base'}));
  function update(id:string,work:()=>Promise<void>){setBusy(id);void run(async()=>{try{await work();}finally{setBusy(null);}});}
  async function importFile(){const path=await open({multiple:false,filters:[{name:t('Snippets.snippets_json'),extensions:['json']}]});if(path)setImportPreview(await call('preview_snippet_import',{path}));}
  const actions = <div className="snippets-actions"><button className="dictionary-add" onClick={()=>void run(importFile)}>{t('common.import')}</button><button className="primary dictionary-add" onClick={e=>edit(e.currentTarget,null)}>{t('SnippetEditor.add_snippet')}</button></div>;
  return <>
    {embedded ? actionsTarget && createPortal(actions,actionsTarget) : <header className="page-header dictionary-heading snippets-heading"><h1>{t('common.snippets')}</h1>{actions}</header>}
    <div className="snippets-content">
    <div className="page-actions snippets-toolbar"><input type="search" aria-label={t('Snippets.search_snippets')} placeholder={t('Snippets.search_snippets')} value={search} onChange={e=>setSearch(e.target.value)}/><div className="snippets-tools"><Select aria-label={t('Snippets.filter_snippets')} value={enabledOnly?'enabled':'all'} onValueChange={value=>setEnabledOnly(value==='enabled')}><SelectOption value="all">{t('Snippets.all_snippets')}</SelectOption><SelectOption value="enabled">{t('Snippets.enabled_only')}</SelectOption></Select><Select aria-label={t('Snippets.sort_snippets')} value={sort} onValueChange={setSort}><SelectOption value="az">{t('Snippets.phrase_a_z')}</SelectOption><SelectOption value="za">{t('Snippets.phrase_z_a')}</SelectOption><SelectOption value="newest">{t('Snippets.newest_first')}</SelectOption></Select></div></div>
    <section className="dictionary-table snippets-table" aria-label={t('Snippets.personal_snippets')}>{entries.length?<ul>{entries.map(snippet=><li key={snippet.id} className={`dictionary-row snippet-row ${snippet.enabled?'':'is-disabled'}`}>
      <button className="snippet-row-content" title={t('SnippetEditor.edit_snippet')} onClick={e=>edit(e.currentTarget,snippet)}><span className="snippet-trigger">{snippet.trigger}</span><span className="snippet-arrow" aria-hidden>→</span><span className="snippet-expansion">{snippet.expansion}</span></button>
      <div className="dictionary-row-actions snippet-row-actions"><button className="icon-button" title={t('Snippets.copy_saved_text')} aria-label={t('Snippets.copy', { value1: snippet.trigger })} onClick={event=>copyWithFeedback(event,()=>call('copy_snippet',{id:snippet.id}))}><ActionIcon name="copy"/></button><button className="icon-button" title={t('SnippetEditor.edit_snippet')} aria-label={t('Dictionary.edit', { value1: snippet.trigger })} onClick={e=>edit(e.currentTarget,snippet)}><ActionIcon name="edit"/></button><button className="icon-button dictionary-delete" title={t('Snippets.delete_snippet')} aria-label={t('Dictionary.delete', { value1: snippet.trigger })} onClick={()=>setDeleting(snippet)}><ActionIcon name="delete"/></button><button className="icon-button dictionary-star" title={snippet.enabled?t('Snippets.disable_snippet'):t('Snippets.enable_snippet')} aria-label={t('Dictionary.use_in_dictation', { value1: snippet.trigger })} aria-pressed={snippet.enabled} disabled={busy===snippet.id} onClick={()=>update(snippet.id,()=>put({...snippet,enabled:!snippet.enabled}))}><ActionIcon name="enabled"/></button></div>
    </li>)}</ul>:<Empty icon={search.trim()?'search':'snippets'} title={search.trim()?t('Snippets.no_matching_snippets'):enabledOnly&&snippets.length?t('Snippets.no_enabled_snippets'):t('Snippets.no_snippets_yet')} body={t(search.trim()?'Empty.search_body':enabledOnly&&snippets.length?'Empty.snippets_disabled_body':'Empty.snippets_body')}>
      {search.trim()||enabledOnly&&snippets.length?<button onClick={()=>{setSearch('');setEnabledOnly(false);}}>{t('Empty.reset_filters')}</button>:<button className="primary" onClick={e=>edit(e.currentTarget,null)}>{t('SnippetEditor.add_snippet')}</button>}
    </Empty>}</section>
    {!!snippets.length&&<footer className="snippets-footer"><span>{t('common.count_snippets',{count:snippets.length})}</span><button onClick={()=>void run(async()=>{const path=await save({defaultPath:'snippets.json',filters:[{name:t('common.snippets_file'),extensions:['json']}]});if(path){await call('export_snippets',{path});notify(t('common.snippets_exported'));}})}>{t('Snippets.export_json_plain_text')}</button></footer>}
    </div>
    {editor&&<SnippetEditor entry={editor.entry} onClose={()=>setEditor(null)} onSave={put}/>}
    {(deleting||importPreview)&&<dialog ref={actionDialog} className="snippet-dialog" aria-label={deleting?t('Snippets.delete_snippet'):t('Snippets.import_snippets')} onCancel={e=>{e.preventDefault();if(busy!=='dialog'){setDeleting(null);setImportPreview(null);}}}><header><h2>{deleting?t('Snippets.delete_snippet_2'):t('Snippets.import_snippets')}</h2></header>{deleting?<p>“{deleting.trigger}{t('Snippets.will_no_longer_insert_its_saved_text')}</p>:<><p>{importPreview!.items.length} {t('Snippets.ready_to_import')} {importPreview!.skipped} {t('Snippets.invalid_or_duplicate_entries_skipped')}</p><ul className="snippet-import-preview">{importPreview!.items.map(s=><li key={s.id}><strong>{s.trigger}</strong><p>{s.expansion}</p></li>)}</ul></>}<footer><button disabled={busy==='dialog'} onClick={()=>{setDeleting(null);setImportPreview(null);}}>{t('common.cancel')}</button><button className={deleting?'danger':'primary'} disabled={busy==='dialog'||(!deleting&&!importPreview!.items.length)} onClick={()=>update('dialog',async()=>{if(deleting){await call('delete_item',{collection:'snippets',id:deleting.id});setDeleting(null);}else{const count=await call<number>('import_snippets',{snippets:importPreview!.items});setImportPreview(null);notify(t('common.imported_snippets',{count}));}await refresh();})}>{deleting?t('common.delete'):t('Snippets.import_snippets')}</button></footer></dialog>}
  </>;
}
