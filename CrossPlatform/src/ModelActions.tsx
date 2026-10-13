import { t, useLocale } from './i18n';
import type {Model} from './types';
import {NoTypeButton} from './DesignControls';
import './model-actions.css';

export function ModelInstalledLabel({current=false}:{current?:boolean}) {
  useLocale();
  const label=t(current?'Models.current_model':'common.installed');
  return <span className={`model-installed-label${current?' model-installed-current':''}`} role="status" aria-label={label} title={label}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={current?'m2 12 5 5L18 6':'m5 12 4 4L19 6'}/>{current&&<path d="m12 15 2 2L23 8"/>}</svg>
  </span>;
}

export function SpeechModelActivation({model,current,disabled,onSelect}:{model:Model;current:boolean;disabled?:boolean;onSelect:(model:Model)=>void}) {
  useLocale();
  return current
    ? <ModelInstalledLabel current/>
    : <NoTypeButton className="model-use-button" disabled={disabled} aria-label={t('Models.use_model', {name:model.name})} onClick={()=>onSelect(model)}>{t('Models.use')}</NoTypeButton>;
}

export function ModelRemoveButton({model,disabled,onRemove}:{model:Model;disabled?:boolean;onRemove:(model:Model)=>void}) {
  useLocale();
  const label=t('ModelActions.remove', {value1:model.name});
  return <NoTypeButton className="model-remove-button" disabled={disabled} aria-label={label} title={label} onClick={()=>onRemove(model)}><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h14M8 5V3h4v2M5 5l.7 11a1 1 0 0 0 1 1h6.6a1 1 0 0 0 1-1L15 5M8 8v6m4-6v6"/></svg></NoTypeButton>;
}
