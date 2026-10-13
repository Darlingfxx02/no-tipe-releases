import { t, formatNumber } from './i18n';
import type { Model } from './types';

export interface ModelMetric { fill:number; value:string; detail:string }
export interface ModelComparison { accuracy?:ModelMetric; speed?:ModelMetric; qualityTitle?:'Quality' }


function legacyProfile(accuracy:number,speed:number):ModelComparison {
  return {
    accuracy:{fill:accuracy,value:`${formatNumber(accuracy*10,{minimumFractionDigits:1,maximumFractionDigits:1})}/10`,detail:t('modelComparison.legacy_detail')},
    speed:{fill:speed,value:`${formatNumber(speed*10,{minimumFractionDigits:1,maximumFractionDigits:1})}/10`,detail:t('modelComparison.legacy_detail')},
  };
}

// Preserve the original profiles from NoTipe/Models/TranscriptionModelRegistry.swift.
const whisperLegacy:Record<string,[number,number]> = {
  tiny:[.6,.95], 'tiny.en':[.65,.95], base:[.72,.85], 'base.en':[.75,.85],
  'large-v2':[.95,.3], 'large-v3':[.95,.3], 'large-v3-turbo':[.94,.75],
};
// Family guidance for variants added by the Hugging Face catalog. These tiers
// are qualitative, not invented numerical accuracy measurements.
const whisperQuality:Record<string,'Basic'|'Balanced'|'High'> = {
  tiny:'Basic',base:'Balanced',small:'High',medium:'High',
  'large-v1':'High','large-v2':'High','large-v3':'High','large-v3-turbo':'High',
  'distil-medium':'High','distil-large-v2':'High','distil-large-v3':'High',
};
// OpenAI's English/A100 family references, not the speed of quantized files here.
// https://github.com/openai/whisper#available-models-and-languages
const whisperSpeed:Record<string,number> = {
  tiny:10,base:7,small:4,medium:2,'large-v1':1,'large-v2':1,'large-v3':1,'large-v3-turbo':8,
  // Published Distil-Whisper English evaluations, relative to large-v3.
  // https://huggingface.co/distil-whisper/distil-medium.en
  'distil-medium':6.8,'distil-large-v2':5.8,'distil-large-v3':6.3,
};

// Exact provider/model identities from NoTipe/Transcription/Cloud/*Provider.swift.
// Hosted models never inherit a local Whisper/A100 speed or another version's score.
const cloudLegacy:Record<string,[number,number]> = {
  'openai:gpt-4o-transcribe':[.98,.82],
  'openai:gpt-4o-mini-transcribe':[.94,.94],
  'groq:whisper-large-v3-turbo':[.95,.65],
  'mistral:voxtral-mini-latest':[.98,.99],
  'deepgram:nova-3':[.96,.99],
  'elevenlabs:scribe_v2':[.98,.99],
  'gemini:gemini-3.5-flash':[.96,.92],
  'soniox:stt-async-v5':[.98,.99],
  'assemblyai:universal-3-5-pro':[.98,.94],
  'speechmatics:enhanced':[.98,.99],
  'xai:grok-stt':[.98,.99],
  'cartesia:ink-2':[.98,.99],
};

// Publisher IFEval reference scores for the original checkpoints, not tests of
// the GGUF conversion or No Type's editing prompt. Mode is stated in the tooltip.
// https://huggingface.co/Qwen/Qwen3.5-0.8B
// https://huggingface.co/Qwen/Qwen3.5-9B
const qwenReference:Record<string,{score:number;mode:string}> = {
  '0.8b':{score:52.1,mode:'non-thinking'},'2b':{score:61.2,mode:'non-thinking'},
  '4b':{score:89.8,mode:'thinking'},'9b':{score:91.5,mode:'thinking'},
};

type ComparableModel=Pick<Model,'id'|'model'|'provider'|'local'> & Partial<Pick<Model,'downloadUrl'>>;
export function modelComparison(model:ComparableModel):ModelComparison|null {
  if (!model.local) {
    const identity=`${model.provider}:${model.model}`;
    const profile=model.id===identity&&Object.hasOwn(cloudLegacy,identity)?cloudLegacy[identity]:undefined;
    return profile?legacyProfile(...profile):null;
  }
  if (model.provider==='whisper'&&model.id===`whisper-${model.model}`) {
    const variant=/^(tiny|base|small|medium|large-v[123]|large-v3-turbo|distil-medium|distil-large-v[23])(\.en)?(?:-q(?:5_[01]|8_0))?$/.exec(model.model);
    if(!variant||variant[2]&&!['tiny','base','small','medium','distil-medium'].includes(variant[1]))return null;
    const family=variant[1],base=family+(variant[2]||'');
    const inherited=Object.hasOwn(whisperLegacy,base)?whisperLegacy[base]:undefined;
    const accuracy=inherited?legacyProfile(...inherited).accuracy:{
      fill:{Basic:.4,Balanced:.6,High:.8}[whisperQuality[family]],value:t(({Basic:'modelComparison.basic',Balanced:'modelComparison.balanced',High:'modelComparison.high'} as const)[whisperQuality[family]]),
      detail:t('modelComparison.whisper_quality'),
    };
    const reference=whisperSpeed[family];
    return {accuracy:accuracy&&{...accuracy,detail:accuracy.detail+(model.model.includes('-q')?t('modelComparison.quantized'):'')},
      speed:{fill:reference/10,value:`~${formatNumber(reference)}×`,detail:t('modelComparison.whisper_speed',{family})}};
  }
  if(model.provider==='coreml'&&model.id==='gigaam-v3-e2e-rnnt-coreml'&&model.model===model.id)return legacyProfile(.98,.98);
  if(model.provider==='sherpa-onnx'&&model.id==='parakeet-tdt-0.6b-v3-int8'&&model.model===model.id) {
    const profile=legacyProfile(.94,.99);
    return {...profile,accuracy:{...profile.accuracy!,detail:t('modelComparison.parakeet_profile')},speed:{...profile.speed!,detail:t('modelComparison.parakeet_profile')}};
  }
  if(model.provider==='local'&&model.model===model.id) {
    const size=/^qwen3\.5-(0\.8b|2b|4b|9b)$/.exec(model.id)?.[1];
    if(size) {
      const label=size.toUpperCase(),expected=`https://huggingface.co/unsloth/Qwen3.5-${label}-GGUF/resolve/`;
      if(!model.downloadUrl?.startsWith(expected))return null;
      const reference=qwenReference[size];
      return {qualityTitle:'Quality',accuracy:{fill:reference.score/100,value:`IFEval ${formatNumber(reference.score)}`,
        detail:t('modelComparison.qwen_quality',{size:label,mode:t(reference.mode==='thinking'?'modelComparison.thinking':'modelComparison.non_thinking')})}};
    }
  }
  return null;
}

export function modelDownloadSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1e3) return `${Math.floor(bytes)} B`;
  if (bytes < 1e6) return `${(bytes / 1e3).toFixed(1)} KB`;
  return bytes < 1e9 ? `${Math.round(bytes / 1e6)} MB` : `${(bytes / 1e9).toFixed(2)} GB`;
}

export function modelProviderName(provider: string): string {
  return ({ openai:'OpenAI', groq:'Groq', mistral:'Mistral', deepgram:'Deepgram', elevenlabs:'ElevenLabs', gemini:'Google', soniox:'Soniox', assemblyai:'AssemblyAI', speechmatics:'Speechmatics', xai:'xAI', cartesia:'Cartesia' } as Record<string,string>)[provider] ?? t('modelComparison.custom');
}
