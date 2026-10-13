import { t, useLocale } from './i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage, errorSource } from './api';

export function SettingInput({value,label,onCommit,type='text',min,max,suffix}:{value:string|number;label:string;onCommit:(value:string)=>Promise<void>;type?:'text'|'number'|'url';min?:number;max?:number;suffix?:string}){
  useLocale();
  const [draft,setDraft]=useState(String(value)),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const focused=useRef(false),latest=useRef(draft),committing=useRef(false),errorId=useId();
  useEffect(()=>{if(!focused.current){latest.current=String(value);setDraft(String(value));}},[value]);
  async function commit(){
    const next=latest.current.trim();if(next===String(value)||committing.current)return;
    if(!next){setError(t('SettingInput.this_field_cannot_be_empty'));return;}
    if(type==='number'&&(!Number.isFinite(Number(next))||(min!==undefined&&Number(next)<min)||(max!==undefined&&Number(next)>max))){setError(t('SettingInput.enter_a_number_between_and', { value1: min, value2: max }));return;}
    committing.current=true;setSaving(true);
    try{await onCommit(next);setError('');}catch(e){setError(errorSource(e));}finally{committing.current=false;setSaving(false);}
  }
  return <div className="setting-input"><div><input aria-label={label} aria-invalid={Boolean(error)} aria-describedby={error?errorId:undefined} aria-busy={saving} type={type} min={min} max={max} value={draft} onFocus={()=>{focused.current=true;}} onChange={e=>{latest.current=e.target.value;setDraft(e.target.value);setError('');}} onBlur={()=>{focused.current=false;void commit();}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){latest.current=String(value);setDraft(String(value));setError('');e.currentTarget.blur();}}}/>{suffix&&<span className="muted">{suffix}</span>}</div>{error&&<p id={errorId} className="field-error" role="alert">{errorMessage(error)}</p>}</div>;
}
