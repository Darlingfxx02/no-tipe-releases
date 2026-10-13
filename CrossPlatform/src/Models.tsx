import {modelDescription} from './modelMetadata';
import { t, useLocale } from './i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { call, errorMessage, native, errorSource } from './api';
import type { HubSearchEntry, HubSearchResult, Model } from './types';
import type { Props } from './pages';
import { Empty, Field, Icon, Modal, Panel, SettingsGroup } from './ui';
import { NoTypeButton, NoTypeTabs } from './DesignControls';
import { ModelIndicators } from './ModelIndicators';
import { EnhancementModels } from './EnhancementModels';
import { ModelHubBrowser } from './ModelHubBrowser';
import { ModelInstalledLabel,ModelRemoveButton,SpeechModelActivation } from './ModelActions';
import { activateSpeechModel,speechModelSelection } from './speechModelSelection';
import { textConfiguration } from './fileTranscription';
import { ModelDownloadActions,ModelDownloadProgress,ModelDownloadStatus } from './ModelDownloadActions';
import { downloadActive,type ModelDownloadState } from './modelDownloads';
import { Select, SelectOption } from './Select';
import { useViewActive } from './RetainedView';
import { ApiConnectionDialog } from './ApiConnectionDialog';
import {canConnectProvider} from './apiConnections';
import {popularSpeechModel,speechModelPublisher,speechModelSearchAliases,speechModelRank} from './speechCatalog';
import { modelComparison, modelDownloadSize,modelProviderName } from './modelComparison';
import './models.css';

const getModelSources = () => ([
  {value:'local', label:t('Models.dictation'), minWidth:83},
  {value:'cloud',label:t('Models.api_models'),minWidth:100},
  {value:'processing', label:t('ModelHubBrowser.text_enhancement'), minWidth:139},
] as const);
type Source = ReturnType<typeof getModelSources>[number]['value'];

// Each model has its own surface, with actions and comparison metrics below.
export function ModelCatalogCard({model, current=false, actions, state, error,onCancel}:{model:Model; current?:boolean; actions:ReactNode; state?:ModelDownloadState; error?:string;onCancel?:(model:Model)=>void}) {
  useLocale();
  const comparison = modelComparison(model);
  const size = modelDownloadSize(model.size);
  return <Panel className="model-catalog-card">
    <div className="model-catalog-heading">
      <h3 title={model.name}>{model.name}</h3>{(model.local?model.installed:current&&model.hasKey)&&<ModelInstalledLabel current={current}/>}<span className="model-catalog-publisher">{speechModelPublisher(model)}</span>
    </div>
    <p className="model-catalog-description">{modelDescription(model)}</p>
    <div className="model-catalog-footer">
      {downloadActive(state)?<ModelDownloadProgress model={model} state={state!} onCancel={onCancel}/>:<>
        <div className="model-catalog-actions">{actions}</div>
        <div className="model-catalog-stats"><ModelIndicators name={model.name} comparison={comparison} compact/></div>
      </>}
    </div>
    {model.local && size && <span className="model-catalog-metadata" aria-label={t('EnhancementModels.download_size', { value1: size })}>{size}</span>}
    <ModelDownloadStatus model={model} error={error}/>
  </Panel>;
}

export function Models({data, run, refresh, notify,onApiKeys}:Props&{onApiKeys:()=>void}) {
  useLocale();
  const [tab, setTab] = useState<Source>('local');
  const [progress, setProgress] = useState<Record<string,number>>({});
  const [downloadStates,setDownloadStates]=useState<Record<string,ModelDownloadState>>({});
  const [downloadErrors,setDownloadErrors]=useState<Record<string,string>>({});
  const [saving, setSaving] = useState(false);
  const [selecting,setSelecting] = useState(false);
  const [customText,setCustomText] = useState<{name:string;url:string;path:string|null;source:'url'|'file'}|null>(null);
  const [hubKind,setHubKind] = useState<'speech'|'text'|null>(null);
  const [queries,setQueries] = useState<Record<Source,string>>({local:'',cloud:'',processing:''});
  const [filters,setFilters] = useState<Record<Source,string>>({local:'popular',cloud:'all',processing:'all'});
  const [connection,setConnection]=useState<{provider:string}|null>(null);
  const downloads=useRef(new Set<string>());
  const active=useViewActive();

  useEffect(() => {
    if (!native) return;
    const stop = listen<{id:string; done:number; total:number}>('model-download', event => {if(!downloads.current.has(event.payload.id))return;setProgress(current => ({
      ...current, [event.payload.id]: event.payload.total ? event.payload.done / event.payload.total : 0,
    }));});
    const catalog=listen('model-catalog-changed',()=>void run(refresh));
    return () => {void stop.then(unlisten => unlisten());void catalog.then(unlisten=>unlisten());};
  }, [refresh,run]);
  useEffect(()=>{if(native&&active)void run(()=>call('refresh_model_catalog',{force:false}));},[active,run]);

  const loadDownloadStates=async()=>{
    const states=await call<ModelDownloadState[]>('model_download_status');
    setDownloadStates(Object.fromEntries(states.map(state=>[state.id,state])));
  };
  const pollFast=Object.keys(progress).length>0||Object.values(downloadStates).some(downloadActive);
  useEffect(()=>{
    if(!native||!active)return;
    let live=true;
    const poll=async()=>{try {const states=await call<ModelDownloadState[]>('model_download_status');if(live)setDownloadStates(Object.fromEntries(states.map(state=>[state.id,state])));}catch{/* The download command surfaces actionable errors. */}};
    void poll();const timer=window.setInterval(()=>void poll(),pollFast?800:5000);
    return()=>{live=false;window.clearInterval(timer);};
  },[active,pollFast]);
  const effectiveDownloads={...downloadStates};
  for(const [id,fraction] of Object.entries(progress))if(!effectiveDownloads[id]||effectiveDownloads[id].phase==='paused')effectiveDownloads[id]={id,phase:'preparing',done:fraction,total:1,resumable:false};
  const downloadBusy=Object.values(effectiveDownloads).some(downloadActive);
  const cancelId=(id:string)=>void run(async()=>{await call('cancel_model_download',{id});});
  const cancelDownload=(model:Model)=>cancelId(model.id);
  const selected=speechModelSelection(data);
  const processing=textConfiguration(data.preferences,selected.mode);
  const selectedText=processing.provider==='local'?data.textModels.find(model=>model.id===processing.model||model.model===processing.model):undefined;
  const currentModel=tab==='processing'?selectedText:selected.model;
  const currentSize=currentModel?.local?modelDownloadSize(currentModel.size):null;
  const query=queries[tab],filter=filters[tab];
  const sourceModels=tab==='processing'?data.textModels:tab==='cloud'?data.models.filter(model=>!model.local):data.models.filter(model=>model.local).sort((a,b)=>speechModelRank(a)-speechModelRank(b));
  const visibleModels=sourceModels.filter(model=>downloadActive(effectiveDownloads[model.id])||(filter==='all'||(filter==='popular'?(!!query.trim()||popularSpeechModel(model)||model.installed||effectiveDownloads[model.id]?.resumable||model.id===selected.model?.id):(tab==='cloud'?model.hasKey:model.installed)))&&`${speechModelSearchAliases(model)} ${speechModelPublisher(model)} ${model.name} ${modelDescription(model)} ${model.description} ${model.languages}`.toLowerCase().includes(query.trim().toLowerCase()));
  const select = (model:Model) => void run(async()=>{
    if(selecting)return;
    setSelecting(true);
    try {if(await activateSpeechModel(model,id=>call('select_speech_model',{id}),refresh))notify(t('Models.model_selected',{name:model.name}));}
    finally {setSelecting(false);}
  });
  const connectionComplete=async(provider:string)=>{await refresh();notify(t('Models.provider_connected',{provider:modelProviderName(provider)}));};
  const performDownload = async (model:Model):Promise<boolean> => {
    if(downloads.current.has(model.id))return false;
    downloads.current.add(model.id);
    setDownloadErrors(current=>{const next={...current};delete next[model.id];return next;});
    setProgress(current => ({...current, [model.id]:0}));
    try {await call(model.provider==='local'?'download_text_model':'download_model', {id:model.id});await refresh();notify(t('Models.model_installed'));return true;}
    catch(error){
      if(errorMessage(error)==='Model download canceled'){notify(t('Models.download_canceled'));return false;}
      setDownloadErrors(current=>({...current,[model.id]:errorSource(error)}));throw error;
    }
    finally {
      downloads.current.delete(model.id);setProgress(current=>{const next={...current};delete next[model.id];return next;});
      try{await loadDownloadStates();}catch{/* Keep the original download result. */}
    }
  };
  const performRemove = async (model:Model) => {
    await call(model.provider==='local'?'remove_text_model':'remove_model',{id:model.id});
    await refresh();notify(t('Models.model_removed'));
  };
  const remove = (model:Model) => void run(()=>performRemove(model));
  const download = (model:Model) => void run(()=>performDownload(model));
  const downloadHub = async (entry:HubSearchEntry) => {
    const model=await call<Model>('add_hub_model',{kind:entry.asset.kind,repository:entry.asset.repository,revision:entry.asset.revision,file:entry.asset.file});
    await refresh();
    setTab(entry.asset.kind==='text'?'processing':'local');
    return await performDownload(model);
  };

  return <div className="settings-model-catalog">
    <div className="model-catalog-toolbar">
      <NoTypeTabs id="models" variant="segmented" label={t('ModelHubBrowser.model_type')} items={getModelSources()} value={tab} onChange={setTab}/>
      <div className="model-toolbar-actions">
        {tab==='cloud'&&<NoTypeButton onClick={()=>setConnection({provider:''})}>{t('Models.connect_api')}</NoTypeButton>}
        {tab==='processing'&&<NoTypeButton onClick={()=>setHubKind('text')}>{t('Models.search_hugging_face')}</NoTypeButton>}
        {tab==='processing'&&<NoTypeButton onClick={()=>setCustomText({name:'',url:'',path:null,source:'url'})}>{t('Models.import_model')}</NoTypeButton>}
      </div>
    </div>
    <div className="model-catalog-content" role="tabpanel" id={`models-panel-${tab}`} aria-labelledby={`models-tab-${tab}`}>
      <SettingsGroup title={t(tab==='processing'?'Models.current_text_model':'Models.current_dictation_model')} className="model-section">
      <div className="model-current-selection">
        <div className="model-current-copy"><h3>{currentModel?.name||(tab==='processing'?processing.model:selected.requested)}</h3>{currentSize&&<span className="model-current-size" aria-label={t('EnhancementModels.download_size',{value1:currentSize})}>{currentSize}</span>}</div>
        {currentModel?.local&&currentModel.installed&&<ModelRemoveButton model={currentModel} disabled={downloadBusy||selecting} onRemove={remove}/>}
      </div>
      </SettingsGroup>
      <SettingsGroup title={t('AvailableModels.available_models')} help={tab==='local'?t('Models.popular_models_help'):undefined} className="model-section model-library-section">
      <div className="model-local-filters">
        <input type="search" aria-label={t(tab==='processing'?'EnhancementModels.search_text_models':tab==='cloud'?'Models.search_api_models':'Models.search_dictation_models')} placeholder={t(tab==='processing'?'EnhancementModels.search_text_models':tab==='cloud'?'Models.search_api_models':'Models.search_dictation_models')} value={query} onChange={e=>setQueries(current=>({...current,[tab]:e.target.value}))}/>
        <Select aria-label={t('Models.filter_models')} value={filter} onValueChange={value=>setFilters(current=>({...current,[tab]:value}))}>{tab==='local'&&<SelectOption value="popular">{t('Models.popular_models')}</SelectOption>}<SelectOption value="all">{t('EnhancementModels.all_models')}</SelectOption><SelectOption value="ready">{t(tab==='cloud'?'Models.connected':'common.installed')}</SelectOption></Select>
      </div>
      {tab === 'processing' ? visibleModels.length>0&&<EnhancementModels models={visibleModels} inlineDownload showFilters={false} currentId={selectedText?.id} progress={progress}
        downloadStates={effectiveDownloads} downloadErrors={downloadErrors} onCancel={cancelDownload} onDownload={download} onRemove={remove}/>
        : tab==='cloud'?<div className="model-catalog-list">{visibleModels.map(model=><ModelCatalogCard key={model.id} model={model} current={selected.model?.id===model.id} actions={<>{model.hasKey&&<><span className="model-api-status">{t('Models.connected')}</span>{selected.model?.id!==model.id&&<SpeechModelActivation model={model} current={false} disabled={selecting} onSelect={select}/>}</>}<NoTypeButton aria-label={t('Models.manage_connection', { value1: modelProviderName(model.provider) })} onClick={()=>canConnectProvider(model.provider)?setConnection({provider:model.provider}):onApiKeys()}>{t(model.hasKey?'Models.manage':'Models.connect_api')}</NoTypeButton></>}/>)}</div> : <div>
          <div className="model-catalog-list">{visibleModels.map(model=>{
            const state=effectiveDownloads[model.id];
            return <ModelCatalogCard key={model.id} model={model} current={selected.model?.id===model.id} state={state} error={downloadErrors[model.id]} onCancel={cancelDownload} actions={model.installed
              ? <>{selected.model?.id!==model.id&&<SpeechModelActivation model={model} current={false} disabled={selecting||downloadBusy} onSelect={select}/>}<ModelRemoveButton model={model} disabled={downloadBusy||selecting} onRemove={remove}/></>
              : <ModelDownloadActions model={model} state={state} busy={downloadBusy} onDownload={download} onCancel={cancelDownload}/>}/>;
          })}</div>
        </div>}
      {visibleModels.length===0&&<Empty compact icon={query.trim()?'search':'models'}
        title={t(query.trim()?'EnhancementModels.no_matching_models':tab==='cloud'?'Empty.no_connected_models':filter==='ready'?'Empty.no_installed_models':'Empty.no_models')}
        body={t(query.trim()?'Empty.search_body':tab==='cloud'?'Empty.cloud_models_body':tab==='processing'?'Empty.text_models_body':'Empty.local_models_body')}>
        {query.trim()||filter!=='all'&&sourceModels.length>0?<NoTypeButton onClick={()=>{setQueries(current=>({...current,[tab]:''}));setFilters(current=>({...current,[tab]:'all'}));}}>{t('Empty.reset_filters')}</NoTypeButton>
          :tab==='cloud'?<NoTypeButton variant="primary" onClick={()=>setConnection({provider:''})}>{t('Models.connect_api')}</NoTypeButton>
          :tab==='processing'?<NoTypeButton variant="primary" onClick={()=>setHubKind('text')}>{t('Models.search_hugging_face')}</NoTypeButton>:<NoTypeButton onClick={()=>void run(async()=>{await call('refresh_model_catalog',{force:true});await refresh();})}>{t('Models.refresh_catalog')}</NoTypeButton>}
      </Empty>}
      </SettingsGroup>
    </div>
    {active&&(connection||hubKind||customText)&&createPortal(<>
    {connection&&<ApiConnectionDialog models={data.models} initialProvider={connection.provider} onClose={()=>setConnection(null)} onConnected={connectionComplete}/>}
    {hubKind&&<ModelHubBrowser kind={hubKind} onClose={()=>setHubKind(null)} search={search=>call<HubSearchResult>('search_model_hub',{search})} onDownload={downloadHub} progress={progress} downloadStates={effectiveDownloads} downloadErrors={downloadErrors} onCancel={cancelDownload} onRemove={performRemove}/>}
    {customText&&<Modal title={t('Models.add_text_model')} className="models-dialog" closeIcon={<Icon name="close" size={20}/>} onClose={()=>{if(!saving)setCustomText(null);}}>
      <p className="muted">{t('Models.import_a_gguf_file_or_add_a_direct')}</p>
      <div className="model-import-source"><NoTypeButton aria-pressed={customText.source==='url'} onClick={()=>setCustomText({...customText,source:'url'})}>{t('Models.download_link')}</NoTypeButton><NoTypeButton aria-pressed={customText.source==='file'} onClick={()=>setCustomText({...customText,source:'file'})}>{t('Models.gguf_file')}</NoTypeButton></div>
      <Field label={t('Models.name')}><input aria-label={t('Models.text_model_name')} value={customText.name} onChange={e=>setCustomText({...customText,name:e.target.value})}/></Field>
      {customText.source==='url'?<Field label={t('Models.direct_https_download_link')}><input type="url" aria-label={t('Models.gguf_download_link')} placeholder={t('Models.https_huggingface_co_resolve_main_model_gguf')} value={customText.url} onChange={e=>setCustomText({...customText,url:e.target.value})}/></Field>
        :<div className="model-import-file"><NoTypeButton disabled={saving} onClick={()=>void run(async()=>{const path=await open({multiple:false,filters:[{name:t('Models.gguf_filter'),extensions:['gguf']}]});if(typeof path==='string')setCustomText({...customText,path,name:customText.name||path.split(/[\\/]/).pop()?.replace(/\.gguf$/i,'')||t('Models.imported_model')});})}>{t('Models.choose_gguf_file')}</NoTypeButton><span className="muted">{customText.path?.split(/[\\/]/).pop()||t('Models.no_file_selected')}</span></div>}
      <footer><NoTypeButton variant="primary" disabled={saving||!customText.name.trim()||(customText.source==='url'?!customText.url.trim():!customText.path)} onClick={()=>void run(async()=>{
        setSaving(true);
        try {await call('add_text_model',{name:customText.name,path:customText.source==='file'?customText.path:null,url:customText.source==='url'?customText.url.trim():null});setCustomText(null);await refresh();notify(customText.source==='file'?t('Models.text_model_installed'):t('Models.text_model_added'));}
        finally {setSaving(false);}
      })}>{saving?t('common.adding'):customText.source==='file'?t('Models.install_model'):t('Models.add_model')}</NoTypeButton></footer>
    </Modal>}
    </>,document.body)}
  </div>;
}
