import { t, useLocale } from './i18n';
import { useEffect, useState, useCallback } from 'react';
import { call, errorMessage, native, errorSource, preview } from './api';
import { Row } from './ui';
import { Select, SelectOption } from './Select';
import { ShortcutRecorder } from './ShortcutRecorder';
import { OnboardingCompanion } from './OnboardingCompanion';
import { resolveTheme, themeOptions, themeSwatch, useTheme } from './theme';
import type { Bootstrap, Preferences } from './types';
import './onboarding.css';

interface Access { microphone: string; accessibility: string }
type OnboardingPatch=Partial<Pick<Preferences,'shortcut'|'shortcutMode'|'recorderPlacement'|'alwaysShowCloud'|'recorderStyle'|'palette'|'usageAnalytics'>>;
export function PermissionSetup({platform,onClose,canClose=false}:{platform:string;onClose:()=>void;canClose?:boolean}) {
  useLocale();
  const [step,setStep]=useState<'permissions'|'settings'|'appearance'>('permissions');
  const [access,setAccess]=useState<Access|null>(null),[error,setError]=useState(''),[pending,setPending]=useState('');
  const [preferences,setPreferences]=useState<Preferences|null>(native?null:preview.preferences),[settingsError,setSettingsError]=useState(''),[settingsPending,setSettingsPending]=useState(false),[captureBusy,setCaptureBusy]=useState(false);
  useTheme(preferences?.palette??'prism');
  useEffect(()=>{
    if(!native)return;
    let disposed=false;
    // Read persisted choices; reopening setup never applies the new defaults
    // over settings a user already selected.
    void call<Bootstrap>('bootstrap').then(data=>{if(!disposed)setPreferences(data.preferences);}).catch(e=>{if(!disposed)setSettingsError(errorSource(e));});
    return()=>{disposed=true;};
  },[]);
  async function saveSettings(patch:OnboardingPatch) {
    setSettingsPending(true);setSettingsError('');
    try{setPreferences(await call<Preferences>('save_preferences',{patch}));}
    catch(e){if(!patch.shortcut)setSettingsError(errorSource(e));throw e;}
    finally{setSettingsPending(false);}
  }
  const refresh=useCallback(async()=>{
    if(!native)return;
    try {setAccess(await call<Access>('permission_status'));setError('');}catch(e){setError(errorSource(e));}
  },[]);
  useEffect(()=>{
    void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},1500);
    window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[refresh]);
  async function request(kind:string) {
    setPending(kind);try{await call('request_permissions',{kind});await refresh();}catch(e){setError(errorSource(e));}finally{setPending('');}
  }
  async function checkAgain() {
    await refresh();
    if(native&&!preferences) {
      try{const data=await call<Bootstrap>('bootstrap');setPreferences(data.preferences);setSettingsError('');}
      catch(e){setSettingsError(errorSource(e));}
    }
  }
  async function finishSetup() {
    setPending('complete');
    try{if(preferences?.usageAnalytics===null)await saveSettings({usageAnalytics:false});await call('complete_onboarding');onClose();}catch(e){setError(errorSource(e));}finally{setPending('');}
  }
  async function continueSetup() {
    if(step==='permissions') {
      try{if(preferences?.usageAnalytics===null)await saveSettings({usageAnalytics:false});setStep('settings');}catch{}
    }else if(step==='settings')setStep('appearance');else void finishSetup();
  }
  const granted=(value:string|undefined)=>value==='granted'||value==='notRequired'||value==='system';
  const title=t(step==='permissions'?'Permissions.set_up_permissions':step==='settings'?'Permissions.set_up_dictation':'Permissions.set_up_recorder');
  const settingsName=platform==='windows'?t('Permissions.windows_settings'):platform==='macos'?t('Permissions.system_settings'):t('Permissions.system_settings_2');
  return <div className="onboarding-screen" data-platform={platform}>
    <div className="onboarding-drag-region" data-tauri-drag-region aria-hidden="true"/>
    <main className="dictation-setup" data-step={step} aria-label={title}>
    <OnboardingCompanion preferences={preferences} appearance={step==='appearance'}/>
    <header><h1>{title}</h1>{canClose&&<button className="icon-button" aria-label={t('common.close')} disabled={pending!==''||settingsPending||captureBusy} onClick={onClose}>×</button>}</header>
    <ol className="onboarding-steps" aria-label={t('Permissions.setup_steps')}>
      <li className="filled" aria-label={t('Permissions.permissions_step')} aria-current={step==='permissions'?'step':undefined}/>
      <li className={step!=='permissions'?'filled':undefined} aria-label={t('Permissions.settings_step')} aria-current={step==='settings'?'step':undefined}/>
      <li className={step==='appearance'?'filled':undefined} aria-label={t('Permissions.appearance_step')} aria-current={step==='appearance'?'step':undefined}/>
    </ol>
    <div className="onboarding-content" key={step}>
    {step==='permissions'?<>
    {([['microphone',t('common.microphone')],['accessibility',platform==='macos'?t('Permissions.accessibility'):t('common.text_insertion')]] as const).map(([kind,title])=><section className="permission-step" key={kind}>
      <div><h3>{title}</h3><span className={granted(access?.[kind])?'permission-ok':'muted'}>{!access?t('common.checking'):access[kind]==='system'?t('Permissions.managed_in', { value1: settingsName }):granted(access[kind])?t('Permissions.ready'):access[kind]==='denied'?t('Permissions.disabled_in', { value1: settingsName }):access[kind]==='restricted'?t('Permissions.restricted_by_the_system'):t('Permissions.permission_needed')}</span></div>
      <button className={granted(access?.[kind])?'':'primary'} disabled={!access||(granted(access[kind])&&!(platform==='windows'&&access[kind]==='system'))||pending!==''||access[kind]==='restricted'} onClick={()=>void request(kind)}>{pending===kind?t('Permissions.opening'):platform==='windows'&&access?.[kind]==='system'?t('Permissions.open_windows_settings'):granted(access?.[kind])?t('Permissions.allowed'):access?.[kind]==='denied'?t('Permissions.open', { value1: settingsName }):t('Permissions.allow')}</button>
    </section>)}
    <Row title={t('Analytics.share')} description={t('Analytics.onboarding_description')} help={t('Analytics.help')}><input className="analytics-checkbox" type="checkbox" aria-label={t('Analytics.share')} checked={preferences?.usageAnalytics===true&&(preferences.usageAnalyticsVersion??0)>=2} disabled={!preferences||settingsPending} onChange={event=>void saveSettings({usageAnalytics:event.target.checked}).catch(()=>{})}/></Row>
    {settingsError&&<p role="alert" className="inline-error">{errorMessage(settingsError)}</p>}
    </>:step==='settings'?<>
      <OnboardingSettings preferences={preferences} platform={platform} pending={settingsPending} captureBusy={captureBusy} error={settingsError} onChange={saveSettings} onBusyChange={setCaptureBusy} onRetry={()=>void checkAgain()}/>
    </>:<OnboardingAppearance preferences={preferences} pending={settingsPending} error={settingsError} onChange={saveSettings} onRetry={()=>void checkAgain()}/>}
    {error&&<p role="alert" className="inline-error">{errorMessage(error)}</p>}
    </div>
    <footer>
      <button disabled={pending!==''||settingsPending||captureBusy} onClick={()=>{if(step==='permissions')void checkAgain();else setStep(step==='appearance'?'settings':'permissions');}}>{t(step==='permissions'?'Permissions.check_again':'Permissions.back')}</button>
      <button className="primary" disabled={!granted(access?.microphone)||pending!==''||!preferences||settingsPending||captureBusy} onClick={()=>void continueSetup()}>{t(step==='appearance'?'Permissions.finish_setup':'Permissions.continue')}</button>
    </footer>
    </main>
  </div>;
}

export function OnboardingSettings({preferences,platform,pending,captureBusy,error,onChange,onBusyChange,onRetry}:{preferences:Preferences|null;platform:string;pending:boolean;captureBusy:boolean;error:string;onChange:(patch:OnboardingPatch)=>Promise<void>;onBusyChange:(busy:boolean)=>void;onRetry:()=>void}) {
  useLocale();
  return <section className="onboarding-settings" aria-label={t('Permissions.settings_step')}>
      <h3>{t('Permissions.choose_your_shortcut')}</h3>
      {preferences?<>
        <Row title={t('Settings.start_or_stop_dictation')}><ShortcutRecorder value={preferences.shortcut} platform={platform} disabled={pending} onChange={shortcut=>onChange({shortcut})} onBusyChange={onBusyChange}/></Row>
        <Row title={t('Settings.shortcut_behavior')}><Select aria-label={t('Settings.shortcut_behavior')} value={preferences.shortcutMode} disabled={!native||pending||captureBusy} onValueChange={shortcutMode=>void onChange({shortcutMode}).catch(()=>{})}>
          <SelectOption value="toggle">{t('Settings.toggle')}</SelectOption>
          <SelectOption value="pushToTalk">{t('App.hold_to_dictate')}</SelectOption>
          <SelectOption value="hybrid">{t('Settings.tap_or_hold')}</SelectOption>
        </Select></Row>
      </>:<p className="muted" role="status">{t('common.checking')}</p>}
      {error&&<p role="alert" className="inline-error">{errorMessage(error)}</p>}
      {error&&!preferences&&<button onClick={onRetry}>{t('Permissions.check_again')}</button>}
    </section>;
}

export function OnboardingAppearance({preferences,pending,error,onChange,onRetry}:{preferences:Preferences|null;pending:boolean;error:string;onChange:(patch:OnboardingPatch)=>Promise<void>;onRetry:()=>void}) {
  useLocale();
  return <section className="onboarding-settings onboarding-appearance" aria-label={t('Permissions.appearance_step')}>
        {preferences?<>
          <Row title={t('Permissions.recorder_visibility')}><Select aria-label={t('Permissions.recorder_visibility')} value={preferences.alwaysShowCloud?'always':'dictation'} disabled={!native||pending} onValueChange={value=>void onChange({alwaysShowCloud:value==='always'}).catch(()=>{})}>
            <SelectOption value="always">{t('Permissions.recorder_always')}</SelectOption>
            <SelectOption value="dictation">{t('Permissions.recorder_during_dictation')}</SelectOption>
          </Select></Row>
          <Row title={t('Settings.recorder_position')}><Select aria-label={t('Settings.recorder_position')} value={preferences.recorderPlacement} disabled={!native||pending} onValueChange={recorderPlacement=>void onChange({recorderPlacement}).catch(()=>{})}>
            <SelectOption value="island">{t('Permissions.recorder_cloud')}</SelectOption>
            <SelectOption value="notch">{t('Permissions.recorder_notch')}</SelectOption>
          </Select></Row>
          <Row title={t('Settings.recorder_style')}><Select aria-label={t('Settings.recorder_style')} value={preferences.recorderStyle} disabled={!native||pending} onValueChange={value=>void onChange({recorderStyle:value==='liquid'?'liquid':'pixel'}).catch(()=>{})}>
            <SelectOption value="pixel">{t('Settings.pixel_eyes')}</SelectOption>
            <SelectOption value="liquid">{t('Settings.liquid_waves')}</SelectOption>
          </Select></Row>
          <Row title={t('Settings.color_theme')}><div className="onboarding-theme-picker" role="group" aria-label={t('Settings.color_theme')}>
            <span className="muted">{themeOptions.find(([id])=>id===resolveTheme(preferences.palette))?.[1]}</span>
            <div className="onboarding-swatches">{themeOptions.map(([palette,label])=><button key={palette} title={label} style={{background:themeSwatch(palette)}} aria-label={label} aria-pressed={resolveTheme(preferences.palette)===palette} disabled={!native||pending} onClick={()=>void onChange({palette}).catch(()=>{})}/>)}</div>
          </div></Row>
      </>:<p className="muted" role="status">{t('common.checking')}</p>}
      {error&&<p role="alert" className="inline-error">{errorMessage(error)}</p>}
      {error&&!preferences&&<button onClick={onRetry}>{t('Permissions.check_again')}</button>}
    </section>;
}
