import {modelLanguages} from './modelMetadata';
import { t, useLocale } from './i18n';
import {useEffect,useRef,useState} from 'react';
import type {HubSearch,HubSearchEntry,HubSearchResult,Model} from './types';
import {NoTypeButton,NoTypeTabs} from './DesignControls';
import {ModelInstalledLabel,ModelRemoveButton} from './ModelActions';
import {ModelDownloadActions,ModelDownloadStatus} from './ModelDownloadActions';
import {downloadActive,type ModelDownloadState} from './modelDownloads';
import {Select,SelectOption} from './Select';
import {Empty,Icon,Modal} from './ui';
import {errorMessage,openUrl, errorSource } from './api';
import {ModelIndicators} from './ModelIndicators';
import {modelComparison,modelDownloadSize} from './modelComparison';
import {speechModelPublisher} from './speechCatalog';
import {HelpHint} from './HelpHint';
import './model-hub.css';

const getModelKinds = () => ([{value:'text',label:t('ModelHubBrowser.text_enhancement')},{value:'speech',label:t('Models.dictation')}] as const);
interface Props {
  kind:'speech'|'text';onClose:()=>void;search:(request:HubSearch)=>Promise<HubSearchResult>;
  onRemove:(model:Model)=>Promise<void>;
  downloadStates?:Record<string,ModelDownloadState>;downloadErrors?:Record<string,string>;onCancel?:(model:Model)=>void;
  onDownload:(entry:HubSearchEntry)=>Promise<boolean|void>;progress:Record<string,number>;
}
export function ModelHubBrowser({kind:initialKind,onClose,search,onDownload,onRemove,progress,downloadStates={},downloadErrors={},onCancel}:Props){
  useLocale();
  const [kind,setKind]=useState(initialKind);
  const [query,setQuery]=useState('');
  const [quantization,setQuantization]=useState(initialKind==='text'?"Q4_K_M":'all');
  const [maxSize,setMaxSize]=useState(initialKind==='text'?'8':'all');
  const [language,setLanguage]=useState('all');
  const [result,setResult]=useState<HubSearchResult|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [working,setWorking]=useState('');
  const [installedChanges,setInstalledChanges]=useState<Record<string,boolean>>({});
  const revision=useRef(0);
  const busy=Object.keys(progress).length>0||Object.values(downloadStates).some(downloadActive);
  const performSearch=async()=>{
    const request=++revision.current;setLoading(true);setError('');
    try {const next=await search({kind,query,quantization:quantization==='all'?null:quantization,maxBytes:maxSize==='all'?null:Number(maxSize)*1e9,language:language==='all'?null:language});if(request===revision.current)setResult(next);}
    catch(e){if(request===revision.current){setResult(null);setError(errorSource(e));}}
    finally {if(request===revision.current)setLoading(false);}
  };
  useEffect(()=>{void performSearch();return()=>{revision.current++;};},[kind]);
  const quantizations=kind==='text'?["Q4_K_M","Q5_K_M","Q6_K","Q8_0","Q4_K_S","Q5_K_S",'F16','BF16']:['INT8','F16',"Q5_0","Q5_1","Q8_0"];
  return <Modal title={t('ModelHubBrowser.browse_hugging_face')} className="models-dialog model-hub-dialog" closeIcon={<Icon name="close" size={20}/>} onClose={onClose}>
    <NoTypeTabs id="model-hub" label={t('ModelHubBrowser.model_type')} items={getModelKinds()} value={kind} onChange={next=>{setKind(next);setQuery('');setResult(null);setQuantization(next==='text'?'Q4_K_M':'all');setMaxSize(next==='text'?'8':'all');}}/>
    <div role="tabpanel" id={`model-hub-panel-${kind}`} aria-labelledby={`model-hub-tab-${kind}`} className="model-hub-content">
      <form className="model-hub-search" onSubmit={e=>{e.preventDefault();void performSearch();}}>
        <input type="search" aria-label={t('ModelHubBrowser.search_hugging_face_models')} placeholder={kind==="text"?t('ModelHubBrowser.model_name_or_author_repository'):t('ModelHubBrowser.search_speech_models')} value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/>
        <NoTypeButton type="submit" variant="primary" disabled={loading}>{loading?t('ModelHubBrowser.searching'):t('ModelHubBrowser.search')}</NoTypeButton>
      </form>
      <div className="model-hub-filters">
        <div className="enhancement-field"><span>{t('ModelHubBrowser.variant')}</span><Select aria-label={t('ModelHubBrowser.model_quantization')} value={quantization} onValueChange={setQuantization}><SelectOption value="all">{t('ModelHubBrowser.all_variants')}</SelectOption>{quantizations.map(value=><SelectOption key={value} value={value}>{value}</SelectOption>)}</Select></div>
        <div className="enhancement-field"><span>{t('ModelHubBrowser.download_size')}</span><Select aria-label={t('ModelHubBrowser.maximum_model_size')} value={maxSize} onValueChange={setMaxSize}><SelectOption value="all">{t('ModelHubBrowser.any_size')}</SelectOption>{['1','4','8','16'].map(value=><SelectOption key={value} value={value}>{t('ModelHubBrowser.up_to')} {value} GB</SelectOption>)}</Select></div>
        <div className="enhancement-field"><span>{t('common.language')}</span><Select aria-label={t('ModelHubBrowser.model_language')} value={language} onValueChange={setLanguage}><SelectOption value="all">{t('ModelHubBrowser.any_language')}</SelectOption><SelectOption value="en">{t('common.english')}</SelectOption><SelectOption value="ru">{t('common.russian')}</SelectOption></Select></div>
      </div>
      <div className="model-hub-compatibility"><HelpHint label={t('ModelHubBrowser.compatibility')}>{t(kind==='speech'?'ModelHubBrowser.speech_compatibility':'ModelHubBrowser.single_file_gguf_models_with_a_chat_template')}</HelpHint></div>
      {error&&<p className="field-error" role="alert">{errorMessage(error)}</p>}
      {result?.warning&&<p className="model-hub-warning" role="status">{result.warning}</p>}
      <div className="model-hub-result-label" role="status">{loading?t('ModelHubBrowser.searching_hugging_face'):result?t('ModelHubBrowser.matching_files', { value1: result.models.length, value2: result.cached?t('ModelHubBrowser.saved_catalog'):'' }):t('ModelHubBrowser.choose_filters_and_search')}</div>
      <div className="model-hub-results" aria-busy={loading}>
        {result?.models.map(entry=>{
          const model=entry.model;
          const installed=installedChanges[model.id]??model.installed;
          const state=downloadStates[model.id]||(model.id in progress?{id:model.id,phase:'downloading' as const,done:progress[model.id]*model.size,total:model.size,resumable:false}:undefined);
          return <article className="model-hub-model" key={model.id} aria-label={model.name}>
            <div className="model-hub-model-copy"><h3>{speechModelPublisher(model)} {model.name}</h3><button className="model-hub-source" title={t('ModelHubBrowser.open_model_card_on_hugging_face')} onClick={()=>void openUrl(`https://huggingface.co/${entry.asset.repository}`)}>{entry.asset.repository} <span aria-hidden="true">↗</span></button><p>{t('ModelHubBrowser.disk_size')} {modelDownloadSize(model.size)} · {modelLanguages(model,entry.asset.languageCodes&&entry.asset.languageCodes.length<=3?entry.asset.languageCodes:undefined)} · {entry.asset.license}</p></div>
            <div className="model-hub-model-comparison"><ModelIndicators name={model.name} comparison={modelComparison(model)} quality={kind==='text'}/></div>
            <div className="model-hub-actions">{installed?<>
              <ModelInstalledLabel/>
              <ModelRemoveButton model={model} disabled={!!working||busy} onRemove={model=>void(async()=>{setWorking(model.id);setError('');try{await onRemove(model);setInstalledChanges(previous=>({...previous,[model.id]:false}));}catch(e){setError(errorSource(e));}finally{setWorking('');}})()}/>
            </>:<ModelDownloadActions model={model} state={state} pending={working===model.id} busy={!!working||busy} onCancel={onCancel} onDownload={()=>void(async()=>{setWorking(model.id);setError('');try{const installed=await onDownload(entry);if(installed!==false)setInstalledChanges(previous=>({...previous,[model.id]:true}));}catch(e){setError(errorSource(e));}finally{setWorking('');}})()}/>}</div>
            <ModelDownloadStatus model={model} state={state} error={downloadErrors[model.id]}/>
          </article>;
        })}
        {!loading&&result&&!result.models.length&&<Empty compact icon="search" title={t('EnhancementModels.no_matching_models')} body={t('Empty.hub_body')}/>}
      </div>
    </div>
  </Modal>;
}
