import { t, useLocale } from './i18n';
import {useRef,useState} from 'react';
import {call,errorMessage, errorSource } from './api';
import type {Model} from './types';
import {Field,Icon,Modal} from './ui';
import {Select,SelectOption} from './Select';
import {NoTypeButton} from './DesignControls';
import {modelProviderName} from './modelComparison';
import {canConnectProvider,connectApiProvider,providerSpeechModels} from './apiConnections';

export function ApiConnectionDialog({models,initialProvider='',onClose,onConnected}:{models:Model[];initialProvider?:string;onClose:()=>void;onConnected:(provider:string)=>Promise<void>}) {
  useLocale();
  const [provider,setProvider]=useState(initialProvider),[key,setKey]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const busy=useRef(false);
  const providers=[...new Set(models.filter(model=>!model.local&&canConnectProvider(model.provider)).map(model=>model.provider))];
  const speechModels=providerSpeechModels(models,provider);
  const existing=speechModels.some(model=>model.hasKey);
  const close=()=>{if(!busy.current){setKey('');onClose();}};
  const connect=async()=>{
    if(busy.current)return;
    busy.current=true;setSaving(true);setError('');
    try {
      await connectApiProvider(provider,key,(provider,key)=>call('connect_api_provider',{provider,key}));
      setKey('');
      await onConnected(provider);
      onClose();
    } catch(e) {setError(errorSource(e));}
    finally {busy.current=false;setSaving(false);}
  };
  return <Modal title={existing?t('ApiConnectionDialog.update_api_connection'):t('ApiConnectionDialog.connect_api_models')} className="models-dialog api-connection-dialog" closeIcon={<Icon name="close" size={20}/>} onClose={close}>
    <Field label={t('common.provider')}><Select aria-label={t('ApiConnectionDialog.api_provider')} value={provider||null} placeholder={t('ApiConnectionDialog.choose_a_provider')} disabled={saving} onValueChange={value=>{setProvider(value);setKey('');setError('');}}>
      {providers.map(value=><SelectOption key={value} value={value}>{modelProviderName(value)}</SelectOption>)}
    </Select></Field>
    <Field label={t('common.api_key')}><input type="password" aria-label={t('common.api_key')} autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={saving} value={key} placeholder={existing?t('ApiConnectionDialog.enter_a_replacement_key'):t('ApiConnectionDialog.paste_your_api_key')} onChange={event=>{setKey(event.target.value);setError('');}} onKeyDown={event=>{if(event.key==='Enter'&&provider&&key.trim()){event.preventDefault();void connect();}}}/></Field>
    {speechModels.length>0&&<div className="api-connection-models"><span>{t('ApiConnectionDialog.models_supported_in_no_tipe')}</span><ul>{speechModels.map(model=><li key={model.id}>{model.name}</li>)}</ul></div>}
    <p className="muted">{provider?t('ApiConnectionDialog.checks_your_key_with_before_saving_it_in', { value1: modelProviderName(provider) }):t('ApiConnectionDialog.choose_the_provider_that_issued_your_key')}</p>
    {error&&<p className="field-error" role="alert">{errorMessage(error)}</p>}
    <footer><NoTypeButton disabled={saving} onClick={close}>{t('common.cancel')}</NoTypeButton><NoTypeButton variant="primary" disabled={saving||!provider||!key.trim()} onClick={()=>void connect()}>{saving?t('common.checking'):existing?t('ApiConnectionDialog.update_connection'):t('ApiConnectionDialog.connect')}</NoTypeButton></footer>
  </Modal>;
}
