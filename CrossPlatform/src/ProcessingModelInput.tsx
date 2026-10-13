import { t, useLocale } from './i18n';
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, errorMessage, native, errorSource } from './api';
import type {Model} from './types';
import {localProcessing} from './fileTranscription';
import { Select, SelectOption } from './Select';
import { SettingInput } from './SettingInput';
import { NoTypeButton } from './DesignControls';

export function ProcessingModelInput({value,provider,endpoint,onChange,onAvailabilityChange,disabled=false,variant='default',refreshButtonVariant='text'}:{value:string;provider:string;endpoint:string;onChange:(value:string)=>Promise<void>;onAvailabilityChange?:(ready:boolean)=>void;disabled?:boolean;variant?:'default'|'transcription'|'inline';refreshButtonVariant?:'text'|'secondary'}) {
  useLocale();
  const [models,setModels]=useState<{id:string;name:string}[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!native || provider!=='local')return;
    const stop=listen('text-models-changed',()=>setRevision(v=>v+1));
    return()=>{void stop.then(unlisten=>unlisten());};
  },[provider]);
  useEffect(()=>{
    if(!localProcessing(provider))return;
    let live=true;setLoading(true);setModels([]);setError('');
    const request=provider==='local'
      ?call<Model[]>('text_models').then(models=>models.filter(m=>m.installed).map(m=>({id:m.id,name:m.name})))
      :call<string[]>('processing_models',{endpoint,provider}).then(models=>models.map(id=>({id,name:id})));
    void request.then(values=>{if(live)setModels(values);}).catch(e=>{if(live)setError(errorSource(e));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[provider,endpoint,revision]);
  const installed=models.some(m=>m.id===value);
  useEffect(()=>{onAvailabilityChange?.(!localProcessing(provider)||(!loading&&!error&&installed));},[provider,loading,error,installed,onAvailabilityChange]);
  if(!localProcessing(provider))return <SettingInput label={t('common.processing_model')} value={value} onCommit={onChange}/>;
  return <div className="processing-model-picker"><Select variant={variant} aria-label={t('common.processing_model')} value={installed?value:null} placeholder={loading?t('ProcessingModelInput.loading_models'):models.length?t('ProcessingModelInput.choose_a_model'):t('ProcessingModelInput.no_models_installed')} disabled={disabled||loading||!models.length} onValueChange={next=>void onChange(next).catch(e=>setError(errorSource(e)))}>
    {models.map(model=><SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>)}
    </Select>{error&&<p className="field-error" role="alert">{errorMessage(error)}</p>}{!loading&&!error&&!models.length&&<p className="field-error">{provider==='local'?t('ProcessingModelInput.download_or_import_a_model_in_ai_models'):t('ProcessingModelInput.no_local_text_models_are_installed_in_ollama')}</p>}
    {refreshButtonVariant==='secondary' ? <NoTypeButton onClick={()=>setRevision(v=>v+1)} disabled={disabled||loading}>{t('ProcessingModelInput.refresh_models')}</NoTypeButton> : <button className="text-button" onClick={()=>setRevision(v=>v+1)} disabled={disabled||loading}>{t('ProcessingModelInput.refresh_models')}</button>}</div>;
}
