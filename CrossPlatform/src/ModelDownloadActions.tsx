import {errorMessage} from './api';
import { t, useLocale } from './i18n';
import type {Model} from './types';
import {NoTypeButton} from './DesignControls';
import {downloadActive,downloadFraction,downloadLabel,type ModelDownloadState} from './modelDownloads';
import './model-actions.css';

export function ModelDownloadActions({model,state,busy,onDownload,onCancel,pending}:{model:Model;state?:ModelDownloadState;busy:boolean;pending?:boolean;onDownload:(model:Model)=>void;onCancel?:(model:Model)=>void}) {
  useLocale();
  const active=downloadActive(state);
  return <>
    {pending&&!state?<NoTypeButton disabled aria-label={t('ModelDownloadActions.preparing_download_of', { value1: model.name })}>{t('Dashboard.preparing')}</NoTypeButton>:active?<NoTypeButton disabled={!onCancel} aria-label={t('ModelDownloadActions.cancel_download_of', { value1: model.name })} onClick={()=>onCancel?.(model)}>{t('common.cancel')}</NoTypeButton>
      :<NoTypeButton variant="primary" className="model-download-button" disabled={busy||!model.downloadUrl} aria-label={`${state?.resumable?t('ModelDownloadActions.resume_download_of'):t('common.download')} ${model.name}`} onClick={()=>onDownload(model)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></svg>{state?.resumable?t('ModelDownloadActions.resume'):model.downloadUrl?t('common.download'):t('ModelDownloadActions.requires_native_model')}</NoTypeButton>}
  </>;
}
export function ModelDownloadStatus({model,state,error}:{model:Model;state?:ModelDownloadState;error?:string}) {
  useLocale();
  return <div className="model-download-details">
    {state&&<>
      <p role="status">{downloadLabel(state)}</p>
      {downloadActive(state)&&<progress className="model-download-progress" aria-label={`${state.phase==="verifying"?t('ModelDownloadActions.checking'):t('ModelDownloadActions.downloading')} ${model.name}`} value={state.phase==='downloading'?downloadFraction(state):undefined} max={1}/>}
    </>}
    {error&&<p className="field-error" role="alert">{errorMessage(error)}</p>}
  </div>;
}

// Fits in the card's existing action row throughout preparation, download and verification.
export function ModelDownloadProgress({model,state,onCancel}:{model:Model;state:ModelDownloadState;onCancel?:(model:Model)=>void}) {
  useLocale();
  const label=downloadLabel(state);
  return <div className="model-download-inline">
    <div className="model-download-inline-body">
      <p role="status" title={label}>{label}</p>
      <progress className="model-download-progress" aria-label={`${state.phase==='verifying'?t('ModelDownloadActions.checking'):t('ModelDownloadActions.downloading')} ${model.name}`} value={state.phase==='downloading'?downloadFraction(state):undefined} max={1}/>
    </div>
    <NoTypeButton className="model-download-cancel" disabled={!onCancel} aria-label={t('ModelDownloadActions.cancel_download_of',{value1:model.name})} title={t('common.cancel')} onClick={()=>onCancel?.(model)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
    </NoTypeButton>
  </div>;
}
