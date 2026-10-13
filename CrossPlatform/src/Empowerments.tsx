import {useEffect,useRef,useState} from 'react';
import {t,useLocale} from './i18n';
import {call,errorMessage,errorSource} from './api';
import type {Props} from './pages';
import type {EmpowermentDefinition} from './types';
import {Field,Panel} from './ui';
import {HelpHint} from './HelpHint';
import {useViewActive} from './RetainedView';
import {EmpowermentPreview} from './EmpowermentPreview';

const colors=['#F5C84C','#ED9665','#ED7BA3','#AC8EF5','#729BF4','#62C5CF','#72C49B','#E6E6ED'];
function Star({color}:{color:string}){return <span className="mode-symbol" style={{color}}><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden="true"><path d="m12 2 2.7 6.9L22 12l-7.3 3.1L12 22l-2.7-6.9L2 12l7.3-3.1L12 2Z"/></svg></span>;}
function Editor({initial,onSave,onClose}:{initial:EmpowermentDefinition|null;onSave:(item:EmpowermentDefinition)=>Promise<void>;onClose:()=>void}){
  useLocale();const active=useViewActive(),dialog=useRef<HTMLDialogElement>(null),first=useRef<HTMLInputElement>(null);
  const [draft,setDraft]=useState<EmpowermentDefinition>(()=>initial??{id:crypto.randomUUID(),name:'',instruction:'',color:colors[0],builtin:false});
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const valid=/^#[0-9a-f]{6}$/i.test(draft.color)&&(draft.builtin||!!(draft.name.trim()&&draft.instruction.trim()));
  useEffect(()=>{if(!active)return;const node=dialog.current!;node.showModal();first.current?.focus();return()=>node.close();},[active]);
  async function submit(){if(saving||!valid)return;setSaving(true);setError('');try{await onSave(draft);onClose();}catch(error){setError(errorSource(error));}finally{setSaving(false);}}
  return <dialog ref={dialog} className="empowerment-editor" aria-labelledby="empowerment-editor-title" onCancel={event=>{event.preventDefault();if(!saving)onClose();}}>
    <header><h2 id="empowerment-editor-title">{t(initial?'Empowerments.edit':'Empowerments.create')}{draft.builtin&&<HelpHint label={t('Empowerments.brief')}>{t('Empowerments.builtin_help')}</HelpHint>}</h2><button type="button" className="icon-button" aria-label={t('common.close')} disabled={saving} onClick={onClose}>×</button></header>
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      <Field label={t('Empowerments.name')}><input ref={first} value={draft.name} maxLength={100} required={!draft.builtin} readOnly={draft.builtin} disabled={saving} placeholder={t('Empowerments.name_placeholder')} onChange={event=>setDraft({...draft,name:event.target.value})}/></Field>
      <Field label={t('Empowerments.instruction')}><textarea rows={4} value={draft.instruction} maxLength={20000} required={!draft.builtin} readOnly={draft.builtin} disabled={saving} placeholder={t('Empowerments.instruction_placeholder')} onChange={event=>setDraft({...draft,instruction:event.target.value})}/></Field>
      <fieldset className="empowerment-colors" disabled={saving}><legend>{t('Empowerments.color')}</legend><div>{colors.map(color=><button key={color} type="button" className="empowerment-swatch" aria-label={t('Empowerments.color')+' '+color} aria-pressed={draft.color.toUpperCase()===color} style={{background:color}} onClick={()=>setDraft({...draft,color})}/>)}<input type="color" aria-label={t('Empowerments.color')} value={draft.color} onChange={event=>setDraft({...draft,color:event.target.value.toUpperCase()})}/></div></fieldset>
      <EmpowermentPreview color={draft.color}/>
      {error&&<p className="inline-error" role="alert">{errorMessage(error)}</p>}
      <footer><button type="button" disabled={saving} onClick={onClose}>{t('common.cancel')}</button><button type="submit" className="primary" disabled={!valid||saving}>{t(saving?'common.saving':initial?'common.save_changes':'Empowerments.create')}</button></footer>
    </form>
  </dialog>;
}
export function Empowerments({data,run,refresh}:Props){
  const language=useLocale(),[pending,setPending]=useState<string|null>(null),[editing,setEditing]=useState<{item:EmpowermentDefinition|null}|null>(null),[deleting,setDeleting]=useState<string|null>(null);
  const instructionLanguage=data.snapshot.translation==='english'?'en':data.snapshot.translation==='russian'?'ru':language;
  const items=(data.empowerments??data.snapshot.empowerments??[{id:'brief',name:t('Empowerments.brief'),instruction:t('Empowerments.brief_instruction'),color:colors[0],builtin:true}]).map(item=>item.builtin?{...item,name:t('Empowerments.brief'),instruction:t('Empowerments.brief_instruction',{lng:instructionLanguage})}:item);
  const available=['idle','recording'].includes(data.snapshot.state);
  function toggle(id:string){if(pending||!available)return;setPending(id);void run(async()=>{try{await call('cloud_action',{action:'empowerment',detail:{value:data.snapshot.empowerment===id?'':id}});await refresh();}finally{setPending(null);}});}
  return <>
    <div className="empowerment-page-actions"><button className="primary" onClick={()=>setEditing({item:null})}>{t('Empowerments.create')}</button></div>
    <div className="mode-grid empowerment-grid">{items.map(item=>{
      const selected=data.snapshot.empowerment===item.id;
      return <Panel key={item.id} className={selected?'active-mode':''} title={item.name} help={t('Empowerments.help')} titleIcon={<Star color={item.color}/>}>
        <p className="muted empowerment-description">{item.builtin?t('Empowerments.brief_description'):item.instruction}</p>
        <details className="mode-disclosure empowerment-instructions"><summary>{t('Modes.instructions')}</summary><p className="empowerment-instruction" lang={item.builtin?instructionLanguage:undefined}>{item.instruction}</p></details>
        <div className="mode-footer"><button aria-pressed={selected} disabled={!!pending||!available} className={selected?'secondary selected':'primary'} onClick={()=>toggle(item.id)}>{t(pending===item.id?'common.saving':selected?'Empowerments.selected':'Empowerments.use')}</button><button onClick={()=>setEditing({item})}>{t('Modes.edit')}</button></div>
        {!item.builtin&&(deleting===item.id?<div className="empowerment-delete-confirm"><span>{t('Empowerments.delete_confirm')}</span><button onClick={()=>setDeleting(null)}>{t('common.cancel')}</button><button className="danger" onClick={()=>void run(async()=>{await call('delete_empowerment',{id:item.id});setDeleting(null);await refresh();})}>{t('common.delete')}</button></div>:<button className="text-button empowerment-delete" onClick={()=>setDeleting(item.id)}>{t('Empowerments.delete')}</button>)}
      </Panel>;
    })}</div>
    {editing&&<Editor initial={editing.item} onClose={()=>setEditing(null)} onSave={async empowerment=>{await call('save_empowerment',{empowerment});await refresh();}}/>}
  </>;
}
