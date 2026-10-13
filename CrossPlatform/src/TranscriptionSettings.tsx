import { t, useLocale } from './i18n';
import type {Dispatch,SetStateAction} from 'react';
import type {Bootstrap,FileProcessing,Model} from './types';
import {Select,SelectOption} from './Select';
import {Switch} from './ui';
import {ProcessingModelInput} from './ProcessingModelInput';
import {getFormats,getLanguages,providerEndpoints,processingProviders,processingProviderName,localProcessing,supportedLanguage} from './fileTranscription';

export function TranscriptionSettings({data,model,language,onLanguage,live,format,processing,disabled,onLive,onFormat,onProcessing,onRules,onModels,onCredentials,onBack}:{
  data:Bootstrap;model:Model|undefined;language:string;onLanguage:(value:string)=>void;live:boolean;format:string;processing:FileProcessing;disabled:boolean;
  onLive:(value:boolean)=>void;onFormat:(value:string)=>void;onProcessing:Dispatch<SetStateAction<FileProcessing>>;
  onRules:(prompt:string)=>void;onModels:()=>void;onCredentials:()=>void;onBack:()=>void;
}) {
  useLocale();
  return <div className="transcription-settings">
    <button className="transcription-back" onClick={onBack}>{t('TranscriptionSettings.transcribe')}</button>
    <header className="page-header"><h1>{t('Transcribe.transcription_settings')}</h1></header>
    <fieldset disabled={disabled}>
      <section className="transcription-settings-section">
        <h2>{t('TranscriptionSettings.recognition')}</h2>
        <Select variant="transcription" aria-label={t('TranscriptionSettings.audio_language')} value={language} disabled={disabled} onValueChange={onLanguage}>{getLanguages().map(([id,name])=><SelectOption key={id} value={id} disabled={!supportedLanguage(model,id)}>{id==='auto'?t('TranscriptionSettings.auto_detect_language'):t('TranscriptionSettings.audio_in', { value1: name })}</SelectOption>)}</Select>
        <div className="transcription-setting-row"><label>{t('TranscriptionSettings.live_text')}</label><Switch label={t('TranscriptionSettings.show_text_during_transcription')} value={live} disabled={disabled} onChange={onLive}/></div>
      </section>
      <section className="transcription-settings-section">
        <h2>{t('TranscriptionSettings.formatting')}</h2>
        <Select variant="transcription" aria-label={t('TranscriptionSettings.output_format')} value={format} disabled={disabled} onValueChange={onFormat}>{getFormats().filter(([id])=>id!=='original').map(([id,name])=><SelectOption key={id} value={id}>{name}</SelectOption>)}{data.modes.filter(m=>m.enabled).map(m=><SelectOption key={m.id} value={'mode:'+m.id}>{m.name}</SelectOption>)}{format.startsWith('mode:')&&!data.modes.some(m=>'mode:'+m.id===format&&m.enabled)&&<SelectOption value={format}>{t('common.custom_rules')}</SelectOption>}</Select>
        <label className="transcribe-field transcribe-rules"><span>{t('TranscriptionSettings.rules')}</span><textarea aria-label={t('TranscriptionSettings.formatting_rules')} rows={4} maxLength={50000} value={processing.prompt} placeholder={t('TranscriptionSettings.paragraphs_headings_punctuation')} onChange={e=>onRules(e.target.value)}/></label>
        <div className="transcribe-edit-options"><label><input type="checkbox" checked={processing.enhance} onChange={e=>onProcessing(p=>({...p,enhance:e.target.checked}))}/>{t('TranscriptionSettings.improve_wording')}</label><label><input type="checkbox" checked={processing.shorten} onChange={e=>onProcessing(p=>({...p,shorten:e.target.checked}))}/>{t('common.shorten')}</label></div>
      </section>
      <section className="transcription-settings-section">
        <h2>{t('common.text_model')}</h2>
        <div className="transcribe-format-grid">
          <div className="transcribe-field"><Select variant="transcription" aria-label={t('Settings.text_processing_service')} value={processing.provider} disabled={disabled} onValueChange={provider=>onProcessing(p=>({...p,provider,model:'',endpoint:providerEndpoints[provider]||''}))}>{processingProviders.map(p=><SelectOption key={p} value={p}>{processingProviderName(p)}</SelectOption>)}</Select></div>
          <div className="transcribe-field">{localProcessing(processing.provider)?<ProcessingModelInput variant="transcription" value={processing.model} provider={processing.provider} endpoint={processing.endpoint} disabled={disabled} onChange={async model=>onProcessing(p=>({...p,model}))}/>:<input placeholder={t('common.text_model')} aria-label={t('common.processing_model')} value={processing.model} onChange={e=>onProcessing(p=>({...p,model:e.target.value}))}/>}</div>
        </div>
        {processing.provider!=='local'&&<label className="transcribe-field"><span>{t('TranscriptionSettings.endpoint')}</span><input aria-label={t('Modes.processing_endpoint')} type="url" value={processing.endpoint} onChange={e=>onProcessing(p=>({...p,endpoint:e.target.value}))}/></label>}
        <button className="transcription-credentials" onClick={processing.provider==='local'?onModels:onCredentials}>{processing.provider==='local'?t('TranscriptionSettings.download_or_import_text_models'):t('TranscriptionSettings.api_keys_in_settings_dictation')}</button>
      </section>
    </fieldset>
  </div>;
}
