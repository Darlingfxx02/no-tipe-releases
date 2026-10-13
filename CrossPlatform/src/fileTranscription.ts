import { t } from './i18n';
import type {Bootstrap, FileProcessing, FileProgress, Mode, Model, Preferences} from './types';

export const getLanguages = () => ([['auto',t('common.auto')],['en',t('common.english')],['ru',t('common.russian')],['de',t('Modes.german')],['fr',t('Modes.french')],['es',t('Modes.spanish')],['it',t('Modes.italian')],['pt',t('Modes.portuguese')],['zh',t('Modes.chinese')],['ja',t('Modes.japanese')],['ko',t('Modes.korean')],['uk',t('Modes.ukrainian')]] as const);
export const getTranslationLanguages = () => ([['off',t('common.no_translation')],['russian',t('fileTranscription.to_russian')],['english',t('fileTranscription.to_english')],...getLanguages().filter(([code]) => !['auto','ru','en'].includes(code)).map(([code,name]) => [code,t('fileTranscription.to', { value1: name })] as const)] as const);
export const getFormats = () => ([['original',t('common.original')],['paragraphs',t('Transcribe.paragraphs')],['bullets',t('fileTranscription.bullet_points')],['custom',t('common.custom_rules')]] as const);
export const formatRules: Record<string,string> = {
  paragraphs: 'Organize the transcript into short paragraphs at topic changes. Preserve all details and the order of the original.',
  bullets: 'Organize the transcript into clear bullet points, grouped by topic. Preserve all facts and decisions. Do not add information.',
};
export const processingProviders = ['local','openai','anthropic','openrouter','ollama','custom'] as const;
export const processingProviderName = (provider:string) => ({local:t('fileTranscription.no_tipe_on_device'),openai:'OpenAI',anthropic:'Anthropic',openrouter:'OpenRouter',ollama:'Ollama',custom:t('ApiKeys.custom')}[provider] || provider);
export const localProcessing = (provider:string) => provider==='local' || provider==='ollama';
export const processingReady = (config:FileProcessing|null, available:boolean) => !config || Boolean(config.model.trim() && (config.provider==='local' || config.endpoint.trim()) && (!localProcessing(config.provider) || available));
export const providerEndpoints: Record<string,string> = {local:'',custom:'https://api.openai.com/v1',openai:'https://api.openai.com/v1',anthropic:'https://api.anthropic.com/v1',openrouter:'https://openrouter.ai/api/v1',ollama:'http://127.0.0.1:11434/v1'};
export const modelReady = (model: Model | undefined) => Boolean(model && (model.local ? model.installed : model.hasKey));
export function availableFileModel(models: Model[], requested: string, defaultId: string) {
  const find = (id:string) => models.find(model => model.id === id || model.model === id);
  const current = find(requested);
  if (modelReady(current)) return current!.id;
  const fallback = find(defaultId);
  if (modelReady(fallback)) return fallback!.id;
  return models.find(model => model.local && modelReady(model))?.id || current?.id || requested;
}
export const supportedLanguage = (model: Model | undefined, language: string) => !model || language==='auto' || (!/^Russian$/i.test(model.languages)&&!/^English$/i.test(model.languages)) || (/^Russian$/i.test(model.languages)?language==='ru':language==='en');
export function textConfiguration(p: Preferences, mode?: Mode): FileProcessing {
  const legacy = mode?.processingProvider == null ? mode?.legacy as {selectedAIProvider?:string;selectedAIModel?:string} | null : null;
  const inherit = mode?.processingProvider === 'default';
  const provider = inherit ? p.processingProvider : mode?.processingProvider ?? legacy?.selectedAIProvider?.toLowerCase() ?? p.processingProvider;
  return {name: mode?.name || t('common.custom_rules'),provider,
    model: inherit ? p.processingModel : mode?.processingModel ?? legacy?.selectedAIModel ?? p.processingModel,
    endpoint: provider==='local' ? '' : inherit ? p.processingEndpoint : mode?.processingEndpoint ?? (provider !== p.processingProvider ? providerEndpoints[provider] : p.processingEndpoint) ?? p.processingEndpoint,
    prompt: mode?.prompt || '',enhance: mode?.enhance || false,shorten: mode?.shorten || false,translation: mode?.translation || 'off'};
}
export function initialFileSettings(data: Bootstrap) {
  const mode = data.modes.find(m => m.enabled && m.id === data.preferences.activeMode);
  const requested = mode?.model || data.preferences.transcriptionModel;
  const selected = availableFileModel(data.models,requested,data.preferences.transcriptionModel);
  const model = data.models.find(m => m.id === selected);
  const processing = textConfiguration(data.preferences, mode);
  const useMode = mode && (mode.enhance || mode.shorten || mode.translation !== 'off');
  return {model: selected, language: supportedLanguage(model,mode?.language || data.preferences.language) ? mode?.language || data.preferences.language : 'auto',
    format: useMode ? 'mode:' + mode.id : 'original',processing: useMode ? processing : textConfiguration(data.preferences)};
}
export function processingForFile(format: string, config: FileProcessing): FileProcessing | null {
  const prompt = format === 'original' ? '' : config.prompt.trim();
  const enhance = format !== 'original' && config.enhance;
  const shorten = format !== 'original' && config.shorten;
  if (!enhance && !shorten && !prompt && config.translation === 'off') return null;
  return {...config,prompt,enhance,shorten};
}
export function acceptProgress(current: FileProgress | null, next: FileProgress, requestId: string | null): FileProgress | null {
  if (!requestId || next.requestId !== requestId) return current;
  if (current && ['completed','failed','canceled'].includes(current.stage)) return current;
  return {...next,completedSeconds: Math.max(current?.completedSeconds || 0, next.completedSeconds)};
}

export function processingForLevel(level:string, config:FileProcessing):FileProcessing|null {
  if(level==='none')return config.translation==='off'?null:{...config,name:t('Modes.translation'),prompt:'',enhance:false,shorten:false};
  if(level==='light')return {...config,name:t('Transcribe.light_cleanup'),prompt:'Correct punctuation, capitalization and clear grammar mistakes. Preserve the original wording, order and every detail. Do not shorten or restructure the transcript.',enhance:false,shorten:false};
  return {...config,name:config.name || t('fileTranscription.full')};
}
export interface FileSettings {model:string;language:string;level:string;live:boolean;format:string;processing:FileProcessing}
export const fileSettingsKey='no-tipe.file-transcription.settings.v1';
export function parseFileSettings(raw:string|null):FileSettings|null {
  if(!raw)return null;
  try {
    const value=JSON.parse(raw) as FileSettings;
    if(!value||typeof value.model!=='string'||!getLanguages().some(([code])=>code===value.language)||!['none','light','full'].includes(value.level)||typeof value.live!=='boolean'||typeof value.format!=='string')return null;
    const p=value.processing;
    if(!p||!['name','provider','model','endpoint','prompt','translation'].every(key=>typeof p[key as keyof FileProcessing]==='string')||typeof p.enhance!=='boolean'||typeof p.shorten!=='boolean'||!getTranslationLanguages().some(([code])=>code===p.translation))return null;
    return value;
  }catch{return null;}
}
