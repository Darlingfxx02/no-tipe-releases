import {modelDescription} from './modelMetadata';
import { t, useLocale } from './i18n';
import {useState} from 'react';
import {Empty} from './ui';
import {NoTypeButton} from './DesignControls';
import type {Model} from './types';
import {ModelInstalledLabel,ModelRemoveButton} from './ModelActions';
import {ModelDownloadActions,ModelDownloadProgress,ModelDownloadStatus} from './ModelDownloadActions';
import {downloadActive,type ModelDownloadState} from './modelDownloads';
import {Select, SelectOption} from './Select';
import {ModelIndicators} from './ModelIndicators';
import {modelComparison,modelDownloadSize} from './modelComparison';
import './enhancement-models.css';

export type EnhancementLayout = 'list'|'table'|'cards';
interface Props {
  models:Model[];
  downloadStates?:Record<string,ModelDownloadState>;downloadErrors?:Record<string,string>;onCancel?:(model:Model)=>void;
  progress:Record<string,number>;
  onDownload:(model:Model)=>void; onRemove:(model:Model)=>void; layout?:EnhancementLayout;
  showFilters?:boolean; currentId?:string; inlineDownload?:boolean;
}

export function EnhancementModels({models,progress,onDownload,onRemove,downloadStates={},downloadErrors={},onCancel,layout='list',showFilters=true,currentId,inlineDownload=false}:Props) {
  useLocale();
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const visible=models.filter(model=>(filter!=='installed'||model.installed)&&`${model.name} ${modelDescription(model)} ${model.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const busy=Object.keys(progress).length>0||Object.values(downloadStates).some(downloadActive);
  return <div className="enhancement-models">
    {showFilters&&<div className="model-local-filters">
      <input className="enhancement-search" type="search" aria-label={t('EnhancementModels.search_text_models')} placeholder={t('EnhancementModels.search_text_models')} value={query} onChange={e=>setQuery(e.target.value)}/>
      <Select aria-label={t('EnhancementModels.filter_text_models')} value={filter} onValueChange={setFilter}>
        <SelectOption value="all">{t('EnhancementModels.all_models')}</SelectOption>
        <SelectOption value="installed">{t('common.installed')}</SelectOption>
      </Select>
    </div>}
      <div className={`enhancement-library enhancement-layout-${layout}`}>
        {layout==='table'&&<div className="enhancement-table-head" aria-hidden="true"><span>{t('common.model')}</span><span>{t('EnhancementModels.size')}</span><span>{t('EnhancementModels.status_action')}</span></div>}
        {visible.map(model=>{
          const state=downloadStates[model.id]||(model.id in progress?{id:model.id,phase:'downloading' as const,done:progress[model.id]*model.size,total:model.size,resumable:false}:undefined);
          const size=modelDownloadSize(model.size);
          const actions=<div className="enhancement-model-actions">
            {!model.installed?<ModelDownloadActions model={model} state={state} busy={busy} onDownload={onDownload} onCancel={onCancel}/>
              :<ModelRemoveButton model={model} disabled={busy} onRemove={onRemove}/>}
          </div>;
          const comparison=<div className="enhancement-model-comparison"><ModelIndicators name={model.name} comparison={modelComparison(model)} quality compact/></div>;
          return <article key={model.id} className="enhancement-model" aria-label={model.name}>
            <div className="enhancement-model-title"><h3>{model.name}</h3>{model.installed&&<ModelInstalledLabel current={currentId===model.id}/>} {model.id==='qwen3.5-4b'&&<span className="enhancement-recommended">{t('EnhancementModels.recommended')}</span>}</div>
            <p className="enhancement-model-description">{modelDescription(model)}</p>
            <span className="enhancement-model-size" aria-label={t('EnhancementModels.download_size', { value1: size||t('EnhancementModels.unknown') })}>{size||t('EnhancementModels.unknown')}</span>
            {inlineDownload?<div className="model-catalog-footer">
              {downloadActive(state)?<ModelDownloadProgress model={model} state={state!} onCancel={onCancel}/>:<>{actions}{comparison}</>}
            </div>:<>{actions}{comparison}</>}
            <ModelDownloadStatus model={model} state={inlineDownload?undefined:state} error={downloadErrors[model.id]}/>
          </article>;
        })}
        {visible.length===0&&<Empty compact icon={query.trim()?'search':'models'} title={t(query.trim()?'EnhancementModels.no_matching_models':filter==='installed'?'Empty.no_installed_models':'Empty.no_models')} body={t(query.trim()?'Empty.search_body':'Empty.text_models_body')}>
          {showFilters&&(query.trim()||filter!=='all')&&<NoTypeButton onClick={()=>{setQuery('');setFilter('all');}}>{t('Empty.reset_filters')}</NoTypeButton>}
        </Empty>}
      </div>
  </div>;
}
