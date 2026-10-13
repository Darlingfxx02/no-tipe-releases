import { t, useLocale, locale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { call, errorMessage, errorSource } from './api';
import type { Mode } from './types';
import type { Props } from './pages';
import { Empty, Field, Icon, Panel, Row, Switch } from './ui';
import { Select, SelectOption } from './Select';
import { ModeDraft, modeDrafts, type DraftStatus } from './modeDraft';
import './modes.css';
import { ProcessingModelInput } from './ProcessingModelInput';
import {processingProviders,processingProviderName,providerEndpoints} from './fileTranscription';
import { SpeechModelSelect } from './SpeechModelSelect';
import { ModeIcon, ModeIconPicker } from './ModeIcon';
import { defaultModeIcon } from './modeIcons';
import { Empowerments } from './Empowerments';

const getLanguages = () => ([['auto',t('common.automatic')],['en',t('common.english')],['ru',t('common.russian')],['de',t('Modes.german')],['fr',t('Modes.french')],['es',t('Modes.spanish')],['it',t('Modes.italian')],['pt',t('Modes.portuguese')],['zh',t('Modes.chinese')],['ja',t('Modes.japanese')],['ko',t('Modes.korean')],['uk',t('Modes.ukrainian')]]);
const newMode = (): Mode => ({id:crypto.randomUUID(),name:t('Modes.new_mode'),icon:defaultModeIcon,enabled:true,model:null,language:'auto',prompt:'',enhance:false,shorten:false,translation:'off',output:'paste',command:'',autoSend:'none',shortcut:'',appPatterns:[],urlPatterns:[],triggerWords:[],clipboardContext:false,selectedTextContext:false,legacy:null});

export function Modes(props: Props) {
  useLocale();
  const {data,run,refresh,save} = props;
  const [editing,setEditing] = useState<Mode|null>(null);
  const [section,setSection] = useState<'modes'|'empowerments'>('modes');
  const tabs = useRef<(HTMLButtonElement|null)[]>([]);
  const activate = (mode: Mode) => save({activeMode:mode.id,enhance:mode.enhance,shorten:mode.shorten,translation:mode.translation});
  if (editing) return <ModeEditor key={editing.id} {...props} initial={editing} activate={activate} onBack={()=>setEditing(null)}/>;
  return <>
    <header className="page-header"><h1>{t('common.modes')}</h1></header>
    <div className="mode-library-tabs" role="tablist" aria-label={t('Modes.library_sections')}>{(['modes','empowerments'] as const).map((value,index)=><button key={value} ref={element=>{tabs.current[index]=element;}} id={`modes-${value}-tab`} role="tab" aria-selected={section===value} aria-controls={`modes-${value}-panel`} tabIndex={section===value?0:-1} onClick={()=>setSection(value)} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;
      setSection(next===0?'modes':'empowerments');tabs.current[next]?.focus();
    }}>{value==='modes'?t('common.modes'):t('Empowerments.title')}</button>)}</div>
    <div id={`modes-${section}-panel`} role="tabpanel" aria-labelledby={`modes-${section}-tab`} className="mode-library-panel">
    {section==='empowerments'?<Empowerments {...props}/>:<>
    <div className="page-actions"><p className="muted">{t('Modes.a_different_way_to_dictate_for_every_task')}</p><button className="primary" onClick={()=>setEditing(newMode())}>{t('Modes.create_mode')}</button></div>
    {!!data.modes.length&&<div className="mode-grid">{data.modes.map(mode=><Panel key={mode.id} className={data.preferences.activeMode===mode.id?'active-mode':''}>
      <div className="mode-heading"><span className="mode-symbol"><ModeIcon value={mode.icon}/></span><Switch label={t('Modes.enable', { value1: mode.name })} value={mode.enabled} onChange={enabled=>void run(async()=>{await call('save_mode',{mode:{...mode,enabled}});await refresh();})}/></div>
      <h2>{mode.name}</h2><p className="muted">{mode.prompt||t('Modes.original_dictation_ready_to_paste')}</p>
      <div className="mode-footer"><button disabled={!mode.enabled} className={data.preferences.activeMode===mode.id?'secondary selected':'primary'} onClick={()=>void run(()=>data.preferences.activeMode===mode.id?save({activeMode:null}):activate(mode))}>{data.preferences.activeMode===mode.id?t('Modes.active'):t('Modes.use_mode')}</button><button aria-label={t('Dictionary.edit', { value1: mode.name })} onClick={()=>setEditing(mode)}>{t('Modes.edit')}</button></div>
    </Panel>)}</div>}
    {!data.modes.length&&<Empty icon="modes" title={t('Modes.make_it_your_own')} body={t('Empty.modes_body')}><button className="primary" onClick={()=>setEditing(newMode())}>{t('Modes.create_mode')}</button></Empty>}
    </>}
    </div>
  </>;
}

function ModeEditor({initial,onBack,activate,...props}:Props&{initial:Mode;onBack:()=>void;activate:(mode:Mode)=>Promise<void>}) {
  useLocale();
  const {data,refresh,run,notify} = props;
  const [draft,setDraft] = useState(()=>structuredClone(modeDrafts.get(initial.id)??initial));
  const [status,setStatus] = useState<DraftStatus>('saved'),[error,setError] = useState('');
  const [editorTab,setEditorTab] = useState('instructions');
  const editorTabs=useRef<(HTMLButtonElement|null)[]>([]);
  const [sample,setSample] = useState(''),[result,setResult] = useState(''),[testError,setTestError] = useState(''),[testing,setTesting] = useState(false),[deleting,setDeleting] = useState(false);
  const previewVersion=useRef(0);
  const mounted=useRef(true),removed=useRef(false),writer=useRef<ModeDraft|null>(null);
  if (!writer.current) writer.current = new ModeDraft(initial,async mode=>{await call('save_mode',{mode});await refresh();},(next,e)=>{if(mounted.current){setStatus(next);setError(e?errorSource(e):'');}});
  const update=(patch:Partial<Mode>)=>{previewVersion.current++;writer.current!.update(patch);setDraft(writer.current!.value);setResult('');setTestError('');};
  useEffect(()=>{
    mounted.current=true;
    return()=>{mounted.current=false;if(!removed.current)void writer.current!.flush().catch(e=>notify(t('Modes.mode_changes_are_not_saved', { value1: errorMessage(e) })));};
  },[]);
  const flush=()=>writer.current!.flush();
  const active=data.preferences.activeMode===draft.id;
  const untouchedNew=!data.modes.some(mode=>mode.id===draft.id)&&!writer.current!.hasChanges;
  const legacy=draft.legacy as {selectedAIProvider?:string;selectedAIModel?:string}|null;
  const processingService=draft.processingProvider==='default'?'':draft.processingProvider??legacy?.selectedAIProvider?.toLowerCase()??'';
  const processingModel=draft.processingModel??(draft.processingProvider?null:legacy?.selectedAIModel)??'';
  const test=async()=>{
    const version=previewVersion.current;setTesting(true);setTestError('');setResult('');
    try {const text=await call<string>('preview_mode',{mode:writer.current!.value,text:sample});if(mounted.current&&previewVersion.current===version)setResult(text);}
    catch(e){if(mounted.current&&previewVersion.current===version)setTestError(errorSource(e));}finally{if(mounted.current)setTesting(false);}
  };
  return <div className="mode-editor">
    <div className="mode-editor-toolbar"><button className="mode-back" onClick={()=>void run(async()=>{await flush();onBack();})}><Icon name="arrow-left" size={16}/>{t('common.modes')}</button><span className={`mode-save-status ${status}`} role="status">{status==='error'?t('Modes.not_saved'):status==='saving'?t('common.saving'):''}</span><button disabled={untouchedNew||!draft.enabled||!draft.name.trim()} className={active?'secondary selected':'primary'} onClick={()=>void run(async()=>{await flush();await activate(writer.current!.value);})}>{active?t('Modes.active_mode'):t('Modes.use_mode')}</button></div>
    <header className="mode-editor-heading"><span className="mode-editor-symbol"><ModeIcon value={draft.icon} size={28}/></span><input className="mode-name" aria-label={t('Modes.mode_name')} value={draft.name} placeholder={t('Modes.untitled_mode')} onChange={e=>update({name:e.target.value})} onBlur={()=>void run(flush)}/><Switch label={t('Modes.enable_mode')} value={draft.enabled} onChange={enabled=>update({enabled})}/></header>
    <ModeIconPicker value={draft.icon} onChange={icon=>update({icon})}/>
    {error&&<div className="inline-error" role="alert">{errorMessage(error)}<button onClick={()=>void run(flush)}>{t('common.retry')}</button></div>}
    <div className="mode-editor-tabs tabs" role="tablist" aria-label={t('Modes.mode_settings')}>{[['instructions',t('Modes.instructions')],['configuration',t('Modes.configuration')]].map(([value,label],index)=><button key={value} ref={element=>{editorTabs.current[index]=element;}} tabIndex={editorTab===value?0:-1} id={`mode-tab-${value}`} role="tab" aria-selected={editorTab===value} aria-controls={`mode-panel-${value}`} className={editorTab===value?'selected':''} onClick={()=>setEditorTab(value)} onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;
      setEditorTab(next===0?'instructions':'configuration');editorTabs.current[next]?.focus();
    }}>{label}</button>)}</div>
    <div id="mode-panel-instructions" role="tabpanel" aria-labelledby="mode-tab-instructions" hidden={editorTab!=='instructions'} className="mode-tab-panel">
    <section className="mode-section mode-instructions"><div className="mode-section-title"><label htmlFor="mode-prompt">{t('Modes.prompt')}</label><span className="muted">{draft.prompt.length.toLocaleString(locale())}</span></div><textarea id="mode-prompt" aria-label={t('Modes.instructions_for_processing')} rows={8} spellCheck={false} placeholder={t('Modes.describe_how_to_edit_your_dictation')} value={draft.prompt} onChange={e=>update({prompt:e.target.value})} onBlur={()=>void run(flush)}/>
      <Row title={t('Modes.improve_text')}><Switch label={t('Modes.improve_text')} value={draft.enhance} onChange={enhance=>update({enhance})}/></Row>
      <Row title={t('common.shorten')}><Switch label={t('common.shorten')} value={draft.shorten} onChange={shorten=>update({shorten})}/></Row>
      <Row title={t('Modes.translate_into')}><Select aria-label={t('Modes.translation')} value={draft.translation} onValueChange={translation=>update({translation})}><SelectOption value="off">{t('common.no_translation')}</SelectOption><SelectOption value="english">{t('common.english')}</SelectOption><SelectOption value="russian">{t('common.russian')}</SelectOption></Select></Row>
      <details className="mode-disclosure"><summary>{t('Modes.text_processing_model')}</summary>
        <Row title={t('Modes.service')}><Select aria-label={t('Modes.processing_service')} value={processingService} onValueChange={processingProvider=>update({processingProvider:processingProvider||'default',processingModel:processingProvider==='local'?'qwen3.5-4b':null,processingEndpoint:null})}><SelectOption value="">{t('Modes.application_default')}</SelectOption>{processingProviders.map(p=><SelectOption key={p} value={p}>{processingProviderName(p)}</SelectOption>)}</Select></Row>
        {processingService&&<><Row title={t('common.model')}><ProcessingModelInput value={processingModel||data.preferences.processingModel} provider={processingService} endpoint={processingService==='local'?'':draft.processingEndpoint||(providerEndpoints[processingService]||data.preferences.processingEndpoint)} onChange={async processingModel=>{update({processingModel,processingProvider:processingService});await flush();}}/></Row>{processingService!=='local'&&<Row title={t('Modes.api_endpoint')}><input aria-label={t('Modes.processing_endpoint')} value={draft.processingEndpoint??''} placeholder={t('Modes.use_provider_default')} onChange={e=>update({processingEndpoint:e.target.value||null})} onBlur={()=>void run(flush)}/></Row>}</>}
      </details>
    </section>
    <details className="mode-section mode-disclosure mode-test"><summary>{t('Modes.try_instructions')}</summary><Field label={t('Modes.sample_dictation')}><textarea rows={3} placeholder={t('Modes.enter_a_sample')} value={sample} onChange={e=>{previewVersion.current++;setSample(e.target.value);setResult('');}}/></Field><div className="mode-test-actions"><button disabled={!sample.trim()||testing} onClick={()=>void test()}>{testing?t('Modes.processing'):t('Modes.test_instructions')}</button></div>{testError&&<p className="field-error" role="alert">{errorMessage(testError)}</p>}{result&&<div className="mode-test-result" aria-label={t('Modes.preview_result')}><span className="muted">{t('Modes.result')}</span><p>{result}</p></div>}</details>
    </div>
    <div id="mode-panel-configuration" role="tabpanel" aria-labelledby="mode-tab-configuration" hidden={editorTab!=='configuration'} className="mode-tab-panel">
    <section className="mode-section"><h2>{t('Modes.speech_recognition')}</h2><Row title={t('Modes.speech_model')}><SpeechModelSelect models={data.models} value={draft.model||''} allowDefault onValueChange={model=>update({model:model||null})}/></Row><Row title={t('Modes.spoken_language')}><Select aria-label={t('Modes.spoken_language')} value={draft.language} onValueChange={language=>update({language})}>{getLanguages().map(([id,label])=><SelectOption key={id} value={id}>{label}</SelectOption>)}</Select></Row></section>
    <section className="mode-section"><h2>{t('Modes.text_delivery')}</h2><Row title={t('Modes.send_result_to')}><Select aria-label={t('Modes.output')} value={draft.output} onValueChange={output=>update({output})}><SelectOption value="paste">{t('Modes.active_text_field')}</SelectOption><SelectOption value="clipboard">{t('Modes.clipboard')}</SelectOption><SelectOption value="respond">{t('Modes.app_only')}</SelectOption><SelectOption value="customCommand">{t('Modes.custom_command')}</SelectOption></Select></Row>{draft.output==='customCommand'&&<Field label={t('Modes.command_transcript_is_provided_on_standard_input')}><textarea rows={2} value={draft.command} onChange={e=>update({command:e.target.value})} onBlur={()=>void run(flush)}/></Field>}
      {draft.output==='paste'&&data.platform==='macos'&&<Row title={t('Modes.after_inserting')}><Select aria-label={t('Modes.after_inserting')} value={draft.autoSend} onValueChange={autoSend=>update({autoSend})}><SelectOption value="none">{t('Modes.do_nothing')}</SelectOption><SelectOption value="enter">{t('Modes.press_enter')}</SelectOption><SelectOption value="tab">{t('Modes.press_tab')}</SelectOption><SelectOption value="commandEnter">{t('Modes.press_enter_2')}</SelectOption></Select></Row>}
    </section>
    <section className="mode-section"><details className="mode-disclosure"><summary>{t('Modes.application_rules_and_context')}</summary><Field label={t('Modes.automatically_use_in_apps_one_application_identifier_per')}><textarea rows={3} value={draft.appPatterns.join('\n')} placeholder={t('Modes.com_apple_notes')} onChange={e=>update({appPatterns:e.target.value.split('\n')})} onBlur={()=>void run(flush)}/></Field><Row title={t('Modes.include_clipboard_context')} description={t('Modes.send_clipboard_text_to_the_processing_model_as')}><Switch label={t('Modes.include_clipboard_context')} value={draft.clipboardContext} onChange={clipboardContext=>update({clipboardContext})}/></Row></details></section>
    </div>
    <footer className="mode-editor-footer">{deleting?<><span>{t('Modes.delete')}{draft.name}{t('Modes.this_cannot_be_undone')}</span><button onClick={()=>setDeleting(false)}>{t('common.cancel')}</button><button className="danger" onClick={()=>void run(async()=>{await flush();await call('delete_item',{collection:'modes',id:draft.id});removed.current=true;modeDrafts.delete(draft.id);await refresh();onBack();})}>{t('Modes.delete_mode')}</button></>:<button className="text-button danger" onClick={()=>setDeleting(true)}>{t('Modes.delete_mode')}</button>}</footer>
  </div>;
}
