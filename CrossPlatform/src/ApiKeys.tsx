import { t, useLocale } from './i18n';
import {useState} from 'react';
import type {Props} from './pages';
import {call} from './api';
import {processingProviders,processingProviderName} from './fileTranscription';
import {modelProviderName} from './modelComparison';
import {Field,Modal,Row} from './ui';
import {Select,SelectOption} from './Select';

export function ApiKeys({data,run,refresh,notify}:Pick<Props,'data'|'run'|'refresh'|'notify'>) {
  useLocale();
  const [provider,setProvider]=useState('');
  const [key,setKey]=useState('');
  const [saving,setSaving]=useState(false);
  const providers=[...new Set([
    ...processingProviders.filter(value=>value!=='local'&&value!=='ollama'),
    ...data.models.filter(model=>!model.local).map(model=>model.provider),
  ])];
  const close=()=>{if(!saving){setProvider('');setKey('');}};
  return <>
    <Row title={t('ApiKeys.api_keys')}><button onClick={()=>{setKey('');setProvider(providers.includes(data.preferences.processingProvider)?data.preferences.processingProvider:'openai');}}>{t('ApiKeys.manage_keys')}</button></Row>
    {provider&&<Modal title={t('common.api_key')} onClose={close}>
      <Field label={t('common.provider')}><Select aria-label={t('ApiKeys.api_key_provider')} value={provider} disabled={saving} onValueChange={value=>{setProvider(value);setKey('');}}>
        {providers.map(value=><SelectOption key={value} value={value}>{(processingProviders as readonly string[]).includes(value)?processingProviderName(value):value.startsWith('custom-')?data.models.find(model=>model.provider===value)?.name||t('ApiKeys.custom'):modelProviderName(value)}</SelectOption>)}
      </Select></Field>
      <Field label={t('common.api_key')}><input type="password" autoComplete="off" autoFocus disabled={saving} value={key} onChange={event=>setKey(event.target.value)}/></Field>
      <p className="muted">{t('ApiKeys.stored_in_the_system_credential_manager_excluded_from')}</p>
      <footer><button disabled={saving||!key.trim()} onClick={()=>void run(async()=>{
        setSaving(true);
        try {await call('save_secret',{provider,key});setProvider('');setKey('');await refresh();notify(t('common.api_key_saved'));}
        finally {setSaving(false);}
      })}>{saving?t('common.saving'):t('ApiKeys.save_key')}</button></footer>
    </Modal>}
  </>;
}
