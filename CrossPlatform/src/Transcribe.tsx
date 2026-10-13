import { t, useLocale } from './i18n';
import {useCallback, useEffect, useRef, useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWebview} from '@tauri-apps/api/webview';
import {open} from '@tauri-apps/plugin-dialog';
import {call, deliveredText, duration, errorMessage, native, errorSource } from './api';
import type {FileOptions, FileProgress, Transcript} from './types';
import type {Props} from './pages';
import {Select, SelectOption} from './Select';
import {Empty,Icon} from './ui';
import {SpeechModelSelect} from './SpeechModelSelect';
import {TranscriptionSettings} from './TranscriptionSettings';
import {acceptProgress, availableFileModel, getFormats, formatRules, initialFileSettings, modelReady, processingForLevel, processingReady, parseFileSettings, fileSettingsKey, supportedLanguage, textConfiguration, getTranslationLanguages} from './fileTranscription';
import './transcribe.css';
import { useViewActive } from './RetainedView';

const extensions = ['wav','mp3','m4a','aac','flac','ogg','mp4'];
const fileName = (path:string) => path.split(/[\\/]/).pop() || path;
let fileDraft: (ReturnType<typeof initialFileSettings> & {level:string;live:boolean;path:string;result:Transcript|null}) | undefined;
const getStages = ():Record<string,string> => ({preparing:t('Transcribe.stage_preparing'),transcribing:t('Transcribe.stage_transcribing'),translating:t('Transcribe.stage_translating'),formatting:t('Transcribe.stage_formatting'),completed:t('Transcribe.saved'),failed:t('Transcribe.stage_stopped'),canceled:t('Transcribe.canceled')});
function AudioFileIcon() {
  return <svg viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M20 2H6a3 3 0 0 0-3 3v26a3 3 0 0 0 3 3h20a3 3 0 0 0 3-3V11L20 2Z"/><path d="M20 2v7a2 2 0 0 0 2 2h7M9 20v4m5-8v12m5-10v8m5-5v2"/></svg>;
}

export function Transcribe({data,run,notify,copyWithFeedback,onModels,onSettings,onCredentials,onBack,settings=false}:Props & {onModels:()=>void;onSettings:()=>void;onCredentials:()=>void;onBack:()=>void;settings?:boolean}) {
  useLocale();
  const active = useViewActive(), acceptsDrop = useRef(false);
  acceptsDrop.current = active && !settings;
  const [initial] = useState(() => {
    if (fileDraft) return fileDraft;
    let stored;try{stored=parseFileSettings(localStorage.getItem(fileSettingsKey));}catch{stored=null;}
    if(stored)return {...stored,path:'',result:null};
    const base=initialFileSettings(data);
    return {...base,level:'none',live:true,path:'',result:null,
      format:base.format==='original'?'paragraphs':base.format,
      processing:base.format==='original'?{...base.processing,name:t('Transcribe.paragraphs'),prompt:formatRules.paragraphs,enhance:false}:base.processing};
  });
  const [level,setLevel] = useState(initial.level);
  const [modelId,setModelId] = useState(initial.model), [language,setLanguage] = useState(initial.language);
  const [live,setLive] = useState(initial.live), [format,setFormat] = useState(initial.format), [processing,setProcessing] = useState(initial.processing);
  const [path,setPath] = useState(initial.path), [working,setWorking] = useState(false), [canceling,setCanceling] = useState(false);
  const [isDropTargeted,setDropTargeted] = useState(false), [result,setResult] = useState<Transcript|null>(initial.result);
  const [progress,setProgress] = useState<FileProgress|null>(null), [error,setError] = useState(''), [original,setOriginal] = useState(false);
  const canceled = useRef(false);
  const requestId = useRef<string|null>(null), busy = useRef(false), ready = useRef<Promise<unknown>>(Promise.resolve());
  const model = data.models.find(m => m.id === modelId);
  useEffect(()=>{
    if(working)return;
    const next=availableFileModel(data.models,modelId,data.preferences.transcriptionModel);
    if(next!==modelId){setModelId(next);if(!supportedLanguage(data.models.find(model=>model.id===next),language))setLanguage('auto');}
  },[data.models,data.preferences.transcriptionModel,modelId,language,working]);
  const config = processingForLevel(level,processing);
  const [textAvailable,setTextAvailable] = useState(false), [textModelError,setTextModelError] = useState('');
  useEffect(() => {
    if (!active || settings) setDropTargeted(false);
  }, [active, settings]);

  useEffect(() => {
    if (!config || !['local','ollama'].includes(config.provider)) {setTextModelError('');return;}
    let active=true;setTextAvailable(false);setTextModelError('');
    void call<string[]>('processing_models',{endpoint:config.endpoint,provider:config.provider}).then(models => {if(active){setTextAvailable(models.includes(config.model));if(!models.includes(config.model))setTextModelError(t('Transcribe.choose_an_available_text_model'));}}).catch(e => {if(active)setTextModelError(errorSource(e));});
    return () => {active=false;};
  },[config?.provider,config?.endpoint,config?.model,data.textModels]);
  const configReady = processingReady(config,textAvailable);
  const output = result ? deliveredText(result) : progress?.translatedText || progress?.text || '';
  const source = result?.text || progress?.text || '';
  const text = original ? source : output;
  const hasOriginal = Boolean(source && source !== output);
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;

  useEffect(() => {fileDraft = {model:modelId,language,level,live,format,processing,path,result};
    try{localStorage.setItem(fileSettingsKey,JSON.stringify({model:modelId,language,level,live,format,processing}));}catch{/* Keep the current session editable if local storage is unavailable. */}
  },[modelId,language,level,live,format,processing,path,result]);

  const reset = () => {setResult(null);setProgress(null);setError('');setOriginal(false);};
  const acceptFile = useCallback((paths:string[]) => {
    if (busy.current) return;
    if (paths.length !== 1) {notify(t('Transcribe.choose_one_file_at_a_time'));return;}
    if (!extensions.includes(paths[0].split('.').pop()?.toLowerCase() || '')) {notify(t('Transcribe.choose_a_wav_mp3_m4a_flac_aac_ogg'));return;}
    setPath(paths[0]);setResult(null);setProgress(null);setError('');setOriginal(false);
  },[notify]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    const stops:(()=>void)[] = [];
    ready.current = Promise.all([
      listen<FileProgress>('file-transcription-progress',event => {
        if (!disposed) setProgress(current => acceptProgress(current,event.payload,requestId.current));
      }),
      getCurrentWebview().onDragDropEvent(event => {
        if (disposed || busy.current || !acceptsDrop.current) return;
        const payload = event.payload;
        setDropTargeted(payload.type === 'enter' || payload.type === 'over');
        if (payload.type === 'drop') acceptFile(payload.paths);
      }),
    ].map(async promise => {const stop = await promise;if (disposed) stop();else stops.push(stop);}));
    // Report subscription failures on start, without an unhandled rejection.
    void ready.current.catch(() => {});
    return () => {disposed = true;stops.forEach(stop => stop());};
  },[acceptFile]);

  const choose = () => void run(async () => {
    if (busy.current) return;
    const file = await open({multiple:false,filters:[{name:t('Transcribe.audio_and_video'),extensions}]});
    if (file) acceptFile([file]);
  });
  const transcribe = async () => {
    if (!path || busy.current || !modelReady(model) || !configReady) return;
    busy.current = true;canceled.current = false;setWorking(true);setCanceling(false);setDropTargeted(false);reset();
    const id = crypto.randomUUID();requestId.current = id;
    const options:FileOptions = {requestId:id,model:modelId,language,live,processing:config};
    setProgress({requestId:id,stage:'preparing',text:'',translatedText:'',duration:0,completedSeconds:0,error:null});
    try {
      await ready.current;
      if (canceled.current) throw new Error(t('Transcribe.canceled'));
      const item = await call<Transcript>('transcribe_file',{path,options});
      setResult(item);
    } catch (e) {
      const message = errorSource(e);
      if (message !== 'Canceled') setError(message);
      setProgress(current => current ? {...current,stage:message === 'Canceled' ? 'canceled' : 'failed',error:message === 'Canceled' ? null : message} : current);
    } finally {requestId.current = null;busy.current = false;setWorking(false);setCanceling(false);}
  };
  const cancel = () => void run(async () => {
    if (!requestId.current || canceling) return;
    canceled.current = true;setCanceling(true);
    try {await call('cancel_file_transcription',{requestId:requestId.current});} catch (e) {setCanceling(false);throw e;}
  });
  const changeFormat = (value:string) => {
    setFormat(value);
    const mode = data.modes.find(m => 'mode:' + m.id === value && m.enabled);
    if (mode) setProcessing(p => ({...textConfiguration(data.preferences,mode),translation:p.translation}));
    else setProcessing(p => ({...p,name:getFormats().find(([id]) => id === value)?.[1] || t('common.custom_rules'),prompt:formatRules[value] || '',enhance:false,shorten:false}));
  };

  if (settings) return <TranscriptionSettings data={data} model={model} language={language} onLanguage={setLanguage} live={live} format={format} processing={processing} disabled={working}
    onLive={setLive} onFormat={changeFormat} onProcessing={setProcessing} onRules={prompt => {setFormat('custom');setProcessing(p => ({...p,name:t('common.custom_rules'),prompt}));}}
    onModels={onModels} onCredentials={onCredentials} onBack={onBack}/>;

  return <>
    <header className="page-header transcribe-heading"><h1>{t('common.transcribe')}</h1><button className="transcribe-settings-link" aria-label={t('Transcribe.transcription_settings')} title={t('Transcribe.transcription_settings')} disabled={working} onClick={onSettings}><Icon name="settings"/></button></header>
    <div className="transcribe-options" aria-label={t('Transcribe.transcription_options')}>
      <div className="transcribe-model-control"><SpeechModelSelect variant="inline" aria-label={t('Transcribe.transcription_model')} models={data.models} value={modelId} disabled={working} onValueChange={id => {setModelId(id);if (!supportedLanguage(data.models.find(m => m.id === id),language)) setLanguage('auto');}}/></div>
      <div className="transcribe-output-controls">
        <Select variant="inline" aria-label={t('Notch.translation_language')} value={processing.translation} disabled={working} onValueChange={translation => setProcessing(p => ({...p,translation}))}>
          {getTranslationLanguages().map(([id,name]) => <SelectOption key={id} value={id}>{name}</SelectOption>)}
        </Select>
        <Select variant="inline" aria-label={t('Transcribe.processing_variant')} value={level==='full'?format:level} disabled={working} onValueChange={value => {if(value==='none'||value==='light')setLevel(value);else{setLevel('full');changeFormat(value);}}}>
          <SelectOption value="none">{t('Transcribe.no_processing')}</SelectOption><SelectOption value="light">{t('Transcribe.light_cleanup')}</SelectOption>
          {getFormats().filter(([id])=>id!=='original').map(([id,name])=><SelectOption key={id} value={id}>{name}</SelectOption>)}
          {data.modes.filter(m=>m.enabled).map(m=><SelectOption key={m.id} value={'mode:'+m.id}>{m.name}</SelectOption>)}
          {format.startsWith('mode:')&&!data.modes.some(m=>'mode:'+m.id===format&&m.enabled)&&<SelectOption value={format}>{t('common.custom_rules')}</SelectOption>}
        </Select>
      </div>
    </div>
    {!modelReady(model) && <div className="transcribe-setup"><span>{!model||model.local?t('Transcribe.download_this_speech_model_in_ai_models'):t('Transcribe.connect_this_provider_in_settings_dictation')}</span><button onClick={!model||model.local?onModels:onCredentials}>{!model||model.local?t('Transcribe.ai_models'):t('Transcribe.settings')}</button></div>}
    {(textModelError || !configReady && config && (!config.model.trim() || config.provider!=='local' && !config.endpoint.trim())) && <div className="transcribe-setup"><span>{textModelError ? errorMessage(textModelError) : t('Transcribe.choose_a_text_model_for_processing')}</span><button onClick={onSettings}>{t('Transcribe.settings')}</button></div>}
    {!path ? <section className={'transcribe-upload' + (isDropTargeted ? ' drop-targeted' : '')} aria-label={t('Transcribe.upload_audio')}>
      <Empty icon="transcribe" title={isDropTargeted ? t('Transcribe.release_to_upload') : t('Transcribe.drop_a_file_here')} body={t('Empty.transcribe_body')} detail="WAV, MP3, M4A, FLAC, AAC, OGG, MP4"><button className="primary" onClick={choose}>{t('Transcribe.choose_file')}</button></Empty>
    </section> : <section className={'transcribe-file' + (result ? ' has-result' : '') + (isDropTargeted ? ' drop-targeted' : '')} aria-label={t('Transcribe.selected_audio_file')} aria-busy={working}>
      <div className="transcribe-file-icon"><AudioFileIcon/></div><div className="transcribe-file-info"><strong title={fileName(path)}>{fileName(path)}</strong></div>
      <div className="transcribe-file-actions"><button className="transcribe-secondary" aria-label={t('Transcribe.replace_file')} disabled={working} onClick={choose}>{result ? t('Transcribe.new_file') : t('Transcribe.replace')}</button>
        {working ? <button onClick={cancel} disabled={canceling}>{canceling ? t('Transcribe.canceling') : t('common.cancel')}</button> : <button className="primary" aria-label={t('Transcribe.transcribe_audio')} disabled={!modelReady(model) || !configReady} onClick={() => void transcribe()}>{result ? t('Transcribe.transcribe_again') : t('common.transcribe')}</button>}
        {!result && <button className="transcribe-remove icon-button" aria-label={t('Transcribe.remove_audio_file')} disabled={working} onClick={() => {setPath('');reset();}}>×</button>}
      </div>
    </section>}
    {(working || result || progress?.text) && <section className="transcribe-result" aria-label={t('Transcribe.transcript')}>
      <header><div className="transcribe-result-title"><h2>{t('Transcribe.transcript')}</h2><span className={'transcribe-saved' + (working ? ' is-working' : '')} role="status" title={result ? t('Transcribe.saved_to_history') : undefined}>{working && <span className="transcribe-spinner" aria-hidden="true"/>}{result ? t('Transcribe.saved') : getStages()[progress?.stage || 'preparing']}</span></div>
        <div className="transcribe-result-actions">{hasOriginal && <button className={original ? 'selected' : ''} aria-pressed={original} onClick={() => setOriginal(v => !v)}>{t('common.original')}</button>}<button aria-label={t('Transcribe.copy_text')} disabled={!text} onClick={event => copyWithFeedback(event, () => call('copy_text', {text}))}><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3V2.5A1 1 0 0 0 9.5 1.5h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1H3"/></svg>{t('common.copy')}</button></div>
      </header>
      <div className="transcribe-result-meta">{(result || Boolean(progress?.duration)) && <>{working && progress ? duration(Math.min(progress.completedSeconds,progress.duration)) + ' / ' : ''}{duration(result?.duration || progress?.duration || 0)}<span aria-hidden="true">·</span></>}{t('common.count_words',{count:words})}</div>
      {working && <progress aria-label={t('Transcribe.recognition_progress')} max={progress?.duration || 1} value={progress?.duration ? progress.completedSeconds : undefined}/>}
      {text ? <div className="transcribe-text">{text}</div> : working && <p className="transcribe-waiting">{live ? t('Transcribe.waiting_for_the_first_segment') : t('Transcribe.processing_audio')}</p>}
      {(result?.processingError || progress?.error) && !error && <p className="inline-error" role="alert">{errorMessage(result?.processingError || progress?.error)}</p>}
    </section>}
    {error && <p className="inline-error" role="alert">{errorMessage(error)}</p>}
  </>;
}
