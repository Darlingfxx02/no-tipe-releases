import { t } from './i18n';
import type {Model} from './types';
import {modelDownloadSize} from './modelComparison';

export interface ModelDownloadState {id:string;phase:'preparing'|'downloading'|'verifying'|'paused';done:number;total:number;resumable:boolean}
export function downloadActive(state?:ModelDownloadState) {return !!state&&state.phase!=='paused';}
export function downloadFraction(state?:ModelDownloadState) {return state&&state.total>0?Math.min(1,Math.max(0,state.done/state.total)):undefined;}
export function downloadLabel(state?:ModelDownloadState) {
  if(!state)return '';
  if(state.phase==='preparing')return t('modelDownloads.checking_disk_space_and_source');
  if(state.phase==='verifying')return t('modelDownloads.checking_model_before_installation');
  const done=modelDownloadSize(state.done)||'0 MB';
  const total=modelDownloadSize(state.total);
  if(state.phase==='paused')return t('modelDownloads.saved_resume_will_continue_if_the_source_supports', { value1: done });
  return `${done}${total?t('modelDownloads.of', { value1: total, value2: Math.floor((downloadFraction(state)||0)*100) }): t('modelDownloads.downloaded_total_size_unknown')}`;
}
export function speechModelStatus(model?:Model) {
  if(!model)return t('modelDownloads.choose_a_dictation_model');
  if(model.local)return model.installed?t('modelDownloads.installed_ready_for_dictation'):t('modelDownloads.download_this_model_to_use_it');
  return model.hasKey?t('modelDownloads.api_key_saved_test_dictation_to_verify_the'):t('modelDownloads.add_an_api_key_to_use_this_model');
}
