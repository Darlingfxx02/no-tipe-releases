import { t, useLocale, resolveLocale, type UiLanguage, type MessageKey, locale } from './i18n';
import { Select, SelectOption } from './Select';
import { useCallback, useEffect, useState } from 'react';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { call, errorMessage, native, errorSource } from './api';
import type { Preferences } from './types';
import type { Props } from './pages';
import { Audio } from './pages';
import { Icon, SettingsGroup as Panel, Row, Switch } from './ui';
import { SettingInput } from './SettingInput';
import { ShortcutRecorder } from './ShortcutRecorder';
import { defaultShortcut, defaultShortcutMode } from './shortcuts';
import { RetainedView, useViewActive } from './RetainedView';
import { UpdatesPanel } from './Updates';
import { LegalPanel } from './Legal';
import { ApiKeys } from './ApiKeys';
import { Models } from './Models';
import { DeveloperConsole } from './DeveloperConsole';
import { ProcessingModelInput } from './ProcessingModelInput';
import { SidebarSettings } from './SidebarSettings';

const sectionLabels: Record<string,MessageKey>={General:'Settings.general',Dictation:'Models.dictation',Models:'common.models',Data:'Settings.data',Console:'Console.title'};
const sections=['General','Dictation','Models','Data'] as const;
export type SettingsSection=typeof sections[number]|'Console';
export function Settings(props:Props&{dictationRequest?:number;modelsRequest?:number;sectionRequest?:{section:SettingsSection;revision:number}}){
  useLocale();
  const {data,save,run,refresh,notify,copyWithFeedback}=props;
  const [section,setSection]=useState<(typeof sections)[number]|'Console'>("General");
  useEffect(()=>{if(props.dictationRequest)setSection('Dictation');},[props.dictationRequest]);
  useEffect(()=>{if(props.modelsRequest)setSection('Models');},[props.modelsRequest]);
  useEffect(()=>{if(props.sectionRequest)setSection(props.sectionRequest.section);},[props.sectionRequest]);
  const p=data.preferences;
  const currentSection=section==='Console'&&!p.developerMode?'General':section;
  useEffect(()=>{if(!p.developerMode&&section==='Console')setSection('General');},[p.developerMode,section]);
  const toggle=(key:keyof Preferences,title:string,description?:string)=><Row title={title} description={description}><Switch label={title} value={Boolean(p[key])} onChange={value=>void run(()=>save({[key]:value}))}/></Row>;
  const input=(key:keyof Preferences,title:string,options?:{min:number;max:number;suffix?:string})=><Row title={title}><SettingInput label={title} value={p[key] as string|number} type={options?'number':'text'} {...options} onCommit={value=>save({[key]:options?Number(value):value})}/></Row>;
  return <div className="settings-layout">
    <SettingsTabs preferences={p} value={currentSection} onChange={setSection}/>
    {currentSection!=='Models'&&<div className="settings-detail" role="tabpanel" id={`settings-panel-${currentSection}`} aria-labelledby={`settings-tab-${currentSection}`} key={currentSection}>
    {currentSection==='Console'&&<DeveloperConsole {...props}/>}
    {currentSection==='General'&&<>
      <Panel><Row title={t('Settings.interface_language')} description={t('Settings.interface_language_hint')}><Select aria-label={t('Settings.interface_language')} value={p.uiLanguage} onValueChange={value=>void run(()=>save({uiLanguage:value as UiLanguage}))}><SelectOption value="system">{t('Settings.system_language',{language:resolveLocale('system',data.systemLocale?[data.systemLocale]:undefined)==='ru'?'Русский':'English'})}</SelectOption><SelectOption value="en">English</SelectOption><SelectOption value="ru">Русский</SelectOption></Select></Row></Panel>
      <Panel title={t('Settings.app_behavior')} titleIcon={<Icon name="settings" size={18}/>}>{toggle('launchAtLogin',t('Settings.launch_at_login'))}{toggle('keepInTray',t('Settings.keep_running_after_closing_the_window'))}</Panel>
      <SidebarSettings data={data} save={save} run={run}/>
      <PermissionsPanel platform={data.platform}/>
      <UpdatesPanel/>
      <Panel title={t('Settings.diagnostics')} titleIcon={<Icon name="activity" size={18}/>}><Row title={t('Settings.version')} description={`${data.version} · ${data.platform}`}><button onClick={event=>copyWithFeedback(event,()=>call('copy_system_info'))}>{t('Settings.copy_system_info')}</button></Row>{toggle('developerMode',t('Settings.developer_mode'),t('Settings.developer_mode_hint'))}{p.developerMode&&<Row title={t('Console.title')} description={t('Settings.console_hint')}><button onClick={()=>setSection('Console')}>{t('Settings.open_console')}</button></Row>}<Row title={t('Settings.cloud_recorder')}><button onClick={()=>void run(()=>call('show_cloud'))}>{t('Settings.show_cloud')}</button></Row></Panel>
      <LegalPanel/>
    </>}
    {section==='Dictation'&&<>
      <Panel title={t('Settings.shortcut')} titleIcon={<Icon name="keyboard" src="/assets/settings/keyboard.svg" size={18}/>}><Row title={t('Settings.start_or_stop_dictation')} description={data.platform!=="macos"?t('Settings.use_a_modifier_with_a_regular_key_for'):undefined}><ShortcutRecorder value={p.shortcut} platform={data.platform} onChange={shortcut=>save({shortcut})}/></Row><Row title={t('Settings.shortcut_behavior')}><Select aria-label={t('Settings.shortcut_behavior')} value={p.shortcutMode} onValueChange={value=>void run(()=>save({shortcutMode:value}))}><SelectOption value="toggle">{t('Settings.toggle')}</SelectOption><SelectOption value="pushToTalk">{t('App.hold_to_dictate')}</SelectOption><SelectOption value="hybrid">{t('Settings.tap_or_hold')}</SelectOption></Select></Row><button className="text-button" onClick={()=>void run(()=>save({shortcut:defaultShortcut(data.platform),shortcutMode:defaultShortcutMode(data.platform)}))}>{t('Settings.reset_dictation_shortcut')}</button></Panel>
      <Audio {...props} grouped showPermissionAction={false} headingIcon={<Icon name="microphone" src="/assets/mode-icons/microphone.svg" size={18}/>} />
      <Panel title={t('Settings.text_processing')} help={t('Settings.text_processing_uses_the_ai_provider_and_model')} titleIcon={<Icon name="magicpen" src="/assets/mode-icons/magicpen.svg" size={18}/>}>{toggle('enhance',t('Settings.clean_up_grammar_punctuation_and_repetition'))}{toggle('shorten',t('Settings.shorten_text'))}<Row title={t('Settings.remove_trailing_period')} help={t('Settings.remove_trailing_period_help')}><Switch label={t('Settings.remove_trailing_period')} value={p.removeTrailingPeriod} onChange={value=>void run(()=>save({removeTrailingPeriod:value}))}/></Row><Row title={t('Modes.translate_into')} description={t('Settings.source_language_is_detected_automatically')}><Select aria-label={t('Modes.translate_into')} value={p.translation} onValueChange={value=>void run(()=>save({translation:value}))}><SelectOption value="off">{t('common.no_translation')}</SelectOption><SelectOption value="english">{t('common.english')}</SelectOption><SelectOption value="russian">{t('common.russian')}</SelectOption></Select></Row></Panel>
      <Panel title={t('Modes.text_delivery')} titleIcon={<Icon name="copy" size={18}/>}>{toggle('restoreClipboard',t('Settings.restore_clipboard_after_text_insertion'),t('Settings.copied_results_stay_on_the_clipboard'))}{p.restoreClipboard&&data.platform!=='macos'&&input('clipboardRestoreDelay',t('Settings.restore_after'),{min:100,max:10000,suffix:t('common.milliseconds')})}{toggle('appendSpace',t('Settings.add_a_space_after_inserted_text'))}</Panel>
      <Panel title={t('Settings.text_processing_service')} help={t('Settings.modes_can_override_the_default_provider_and_model')} titleIcon={<Icon name="code" src="/assets/mode-icons/code.svg" size={18}/>}><Row title={t('Settings.default_text_model')}><ProcessingModelInput value={p.processingModel} provider={p.processingProvider} endpoint={p.processingEndpoint} onChange={processingModel=>save({processingModel})}/></Row>{p.processingProvider!=='local'&&input('processingEndpoint',t('Modes.api_endpoint'))}{input('processingTimeout',t('Settings.request_timeout'),{min:10,max:600,suffix:t('common.seconds')})}<ApiKeys {...props}/></Panel>
    </>}
    {section==='Data'&&<>
      <Panel title={t('Analytics.title')} titleIcon={<Icon name="activity" size={18}/>}><Row title={t('Analytics.setting')} description={t('Analytics.setting_description')} help={t('Analytics.help')}><Switch label={t('Analytics.setting')} value={p.usageAnalytics===true&&(p.usageAnalyticsVersion??0)>=2} onChange={value=>void run(()=>save({usageAnalytics:value}))}/></Row></Panel>
      <Panel title={t('Settings.library')} titleIcon={<Icon name="dictionary" size={18}/>}><Row title={t('Settings.import_library_from_the_previous_app')} description={data.legacyImported?t('Settings.last_imported', { value1: new Date(data.legacyImported).toLocaleDateString(locale()) }):t('Settings.history_modes_dictionary_and_preferences')}><button disabled={!data.legacyAvailable} onClick={()=>void run(async()=>{const count=await call<number>('import_legacy');await refresh();notify(t('common.imported_transcripts',{count}));})}>{t('common.import')}</button></Row><Row title={t('Settings.export_backup')} description={t('Settings.includes_your_library_and_preferences_api_keys_are')}><button onClick={()=>void run(async()=>{const path=await saveDialog({defaultPath:'No Type-backup.json',filters:[{name:t('common.backup_filter'),extensions:['json']}]});if(path){await call('export_backup',{path});notify(t('common.backup_exported'));}})}>{t('common.export')}</button></Row><Row title={t('Settings.import_backup')} description={t('Settings.existing_transcriptions_are_kept_preferences_are_restored_from')}><button onClick={()=>void run(async()=>{const path=await open({multiple:false,filters:[{name:t('common.backup_filter'),extensions:['json']}]});if(path){await call('import_backup',{path});await refresh();notify(t('common.backup_imported'));}})}>{t('common.import')}</button></Row></Panel>
      <Panel title={t('Settings.retention')} help={t('Settings.audio_retention_hint')} titleIcon={<Icon name="history" size={18}/>}><Row title={t('Settings.keep_transcription_history')}><Select aria-label={t('Settings.keep_transcription_history')} value={p.transcriptRetentionDays} onValueChange={value=>void run(()=>save({transcriptRetentionDays:Number(value)}))}>{[0,7,30,90].map(n=><SelectOption key={n} value={n}>{n===0?t('Settings.forever'):t('common.count_days',{count:n})}</SelectOption>)}</Select></Row></Panel>
    </>}
  </div>}
    <RetainedView active={section==='Models'}><div className="settings-detail settings-models" hidden={section!=='Models'} role="tabpanel" id="settings-panel-Models" aria-labelledby="settings-tab-Models">
      <Models {...props} onApiKeys={()=>setSection('Dictation')}/>
    </div></RetainedView>
  </div>;
}

export function SettingsTabs({preferences,value,onChange}:{preferences:Preferences;value:SettingsSection;onChange:(name:SettingsSection)=>void}){
  useLocale();
  const active=useViewActive();
  const visibleSections:SettingsSection[]=[...sections,...(preferences.developerMode?['Console' as const]:[])];
  if(!active)return null;
  return (<nav className="settings-tabs" role="tablist" aria-label={t('Settings.settings_categories')}>
      {visibleSections.map((name,index)=><button key={name} role="tab" id={`settings-tab-${name}`} aria-selected={value===name} aria-controls={`settings-panel-${name}`} tabIndex={value===name?0:-1} onClick={()=>onChange(name)} onKeyDown={event=>{
        let next=index;
        if(event.key==='ArrowRight')next=(index+1)%visibleSections.length;
        else if(event.key==='ArrowLeft')next=(index+visibleSections.length-1)%visibleSections.length;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=visibleSections.length-1;
        else return;
        event.preventDefault();onChange(visibleSections[next]);
        requestAnimationFrame(()=>document.getElementById(`settings-tab-${visibleSections[next]}`)?.focus());
      }}><span className="settings-tab-label">{t(sectionLabels[name])}</span><span className="settings-tab-sizer" aria-hidden="true">{t(sectionLabels[name])}</span></button>)}
    </nav>);
}

function PermissionsPanel({platform}:{platform:string}){
  useLocale();
  const active = useViewActive();
  const [status,setStatus]=useState<Record<string,string>>({}),[error,setError]=useState('');
  const refresh=useCallback(async()=>{if(!native)return;try{setStatus(await call('permission_status'));setError('');}catch(e){setError(errorSource(e));}},[]);
  useEffect(()=>{if(!active)return;void refresh();window.addEventListener('focus',refresh);const timer=setInterval(()=>{if(!document.hidden)void refresh();},2000);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[refresh,active]);
  return <Panel title={t('Settings.permissions')} titleIcon={<Icon name="shield" src="/assets/settings/shield-check.svg" size={18}/>}>{([['microphone',t('common.microphone')],['accessibility',platform==='macos'?t('Settings.accessibility_for_text_insertion'):t('common.text_insertion')]] as const).map(([key,title])=><Row key={key} title={title}><span className={status[key]==='granted'?'permission-ok':'muted'}>{status[key]==='granted'?t('Permissions.allowed'):status[key]==='notRequired'?t('Settings.not_required'):status[key]==='system'?t('Settings.system_managed'):t('Settings.not_allowed')}</span>{!['granted','notRequired'].includes(status[key])&&(status[key]!=='system'||platform==='windows')&&<button onClick={()=>void call('request_permissions',{kind:key}).then(refresh).catch(e=>setError(errorSource(e)))}>{platform==='windows'?t('Permissions.open_windows_settings'):t('Permissions.allow')}</button>}</Row>)}{error&&<p className="field-error" role="alert">{errorMessage(error)}</p>}</Panel>;
}
