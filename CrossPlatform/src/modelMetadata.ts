import {locale, t, type MessageKey} from './i18n';
import type {Model} from './types';

const qwenDescriptions:Record<string,MessageKey>={
  'qwen3.5-0.8b':'modelMetadata.qwen_0_8b', 'qwen3.5-2b':'modelMetadata.qwen_2b',
  'qwen3.5-4b':'modelMetadata.qwen_4b', 'qwen3.5-9b':'modelMetadata.qwen_9b',
};
export function modelDescription(model:Model):string {
  if(model.provider==='sherpa-onnx'&&model.id==='parakeet-tdt-0.6b-v3-int8')return t('modelMetadata.parakeet_v3');
  if((model.provider==='coreml'&&model.id==='gigaam-v3-e2e-rnnt-coreml')||(model.provider==='sherpa-onnx'&&model.id==='gigaam-v3-e2e-rnnt-int8'))return t('modelMetadata.gigaam_v3');
  if(model.provider==='sherpa-onnx'&&['gigaam-multilingual-ctc-int8','gigaam-multilingual-large-ctc-int8'].includes(model.id))return t('modelMetadata.gigaam_multilingual');
  if(model.provider==='local'&&Object.hasOwn(qwenDescriptions,model.id))return t(qwenDescriptions[model.id]);
  if(model.provider==='whisper'&&model.id===`whisper-${model.model}`){
    if(model.languages==='English')return t('modelMetadata.english_speech');
    if(model.model.startsWith('large-v3-turbo'))return t('modelMetadata.whisper_turbo');
    if(model.model.startsWith('large-'))return t('modelMetadata.whisper_large');
    if(/^(tiny|base)/.test(model.model))return t('modelMetadata.whisper_light');
    return t('modelMetadata.whisper_balanced');
  }
  if(!model.local){
    if(model.provider==='openai'&&model.model==='gpt-4o-transcribe')return t('modelMetadata.cloud_accurate');
    if((model.provider==='openai'&&model.model==='gpt-4o-mini-transcribe')||model.provider==='groq')return t('modelMetadata.cloud_fast');
    return t('modelMetadata.cloud_speech');
  }
  return t(model.provider==='local'?'modelMetadata.local_text':'modelMetadata.local_speech');
}
export function modelLanguages(model:Model, codes?:readonly string[]):string {
  if(codes?.length) {
    const names=new Intl.DisplayNames([locale()],{type:'language'});
    return codes.map(code=>{try{return names.of(code)??code;}catch{return code;}}).join(', ');
  }
  // Catalog metadata also comes from older catalogs that had display labels only.
  const known:Record<string,MessageKey>={English:'common.english',Russian:'common.russian',Multilingual:'modelMetadata.multilingual'};
  return Object.hasOwn(known,model.languages)?t(known[model.languages]):model.languages;
}
