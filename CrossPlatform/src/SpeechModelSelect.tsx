import { t, useLocale } from './i18n';
import type { Model } from './types';
import { modelReady } from './fileTranscription';
import { Select, SelectOption } from './Select';

export function SpeechModelSelect({models,value,onValueChange,disabled=false,allowDefault=false,variant='default','aria-label':label=t('Modes.speech_model')}:{
  models:Model[];value:string;onValueChange:(value:string)=>void;disabled?:boolean;allowDefault?:boolean;variant?:'default'|'transcription'|'inline';'aria-label'?:string;
}) {
  useLocale();
  const available = models.filter(modelReady);
  const selected = value?available.find(model=>model.id===value||model.model===value):undefined;
  // Keep saved choices intact when a model is removed or disconnected.
  // An unavailable choice is a placeholder, never an option in the menu.
  return <Select variant={variant} aria-label={label} value={selected?.id??(allowDefault&&!value?'':null)}
    placeholder={available.length||allowDefault?t('ProcessingModelInput.choose_a_model'):t('SpeechModelSelect.no_models_available')}
    disabled={disabled||(!allowDefault&&!available.length)} onValueChange={onValueChange}>
    {allowDefault&&<SelectOption value="">{t('Modes.application_default')}</SelectOption>}
    {available.map(model=><SelectOption key={model.id} value={model.id}>{model.name}</SelectOption>)}
  </Select>;
}
