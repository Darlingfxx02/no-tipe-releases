import { t, useLocale } from './i18n';
import { Select, SelectOption } from './Select';
import { useState, useEffect, type ReactNode } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, native } from './api';
import type { Bootstrap, Preferences, Device } from './types';
import { Panel, SettingsGroup, Row, Switch } from './ui';
import { useViewActive } from './RetainedView';

import type { CopyWithFeedback } from './CopyFeedback';

export interface Props { copyWithFeedback:CopyWithFeedback; data:Bootstrap; refresh:()=>Promise<void>; run:<T>(work:()=>Promise<T>)=>Promise<T|undefined>; notify:(message:string)=>void; save:(patch:Partial<Preferences>)=>Promise<void> }
const getLanguages = () => ([['auto',t('common.automatic')],['en',t('common.english')],['ru',t('common.russian')],['de',t('Modes.german')],['fr',t('Modes.french')],['es',t('Modes.spanish')],['it',t('Modes.italian')],['pt',t('Modes.portuguese')],['zh',t('Modes.chinese')],['ja',t('Modes.japanese')],['ko',t('Modes.korean')],['uk',t('Modes.ukrainian')]]);
function Language({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  useLocale();return <Select aria-label={t('common.language')} value={value} onValueChange={value=>onChange(value)}>{getLanguages().map(([id,label])=><SelectOption value={id} key={id}>{label}</SelectOption>)}</Select>;}
export function Audio({data,run,save,showPermissionAction=true,headingIcon,grouped=false}:Props&{showPermissionAction?:boolean;headingIcon?:ReactNode;grouped?:boolean}) {
  useLocale();
  const active=useViewActive();
  const [devices,setDevices]=useState<Device[]|null>(null),[level,setLevel]=useState(0);
  useEffect(()=>{
    if(!active)return;
    let mounted=true,pending=false;
    const refreshDevices=()=>{
      if(pending)return;
      pending=true;
      void run(async()=>{
        const next=await call<Device[]>('audio_devices');
        if(mounted)setDevices(next);
      }).finally(()=>{pending=false;});
    };
    refreshDevices();
    if(!native)return()=>{mounted=false;};
    // Read the same catalog as the recorder so automatic selection follows
    // device/default changes without opening a microphone stream.
    const timer=window.setInterval(refreshDevices,3000);
    window.addEventListener('focus',refreshDevices);
    const stop=listen<{level:number}>('cloud-audio',e=>{if(mounted)setLevel(e.payload.level);});
    return()=>{mounted=false;window.clearInterval(timer);window.removeEventListener('focus',refreshDevices);void stop.then(f=>f());};
  },[active,run]);
  const available=devices??[];
  const automaticDevice=available.find(device=>device.default);
  const automaticLabel=t('pages.automatic', { value1: devices===null?t('pages.detecting_microphone'):automaticDevice?.name??t('pages.no_microphone_available') });
  const selectedUnavailable=devices!==null&&data.preferences.audioDevice&&!available.some(device=>device.id===data.preferences.audioDevice);
  const AudioPanel=grouped?SettingsGroup:Panel;
  return <><AudioPanel title={t('common.microphone')} titleIcon={headingIcon}>
    <Row title={t('pages.input_device')} help={t('pages.the_level_meter_responds_while_recording')}>
      <Select aria-label={t('pages.input_device')} value={data.preferences.audioDevice} onValueChange={value=>void run(()=>save({audioDevice:value}))}>
        <SelectOption value="">{automaticLabel}</SelectOption>
        {selectedUnavailable&&<SelectOption value={data.preferences.audioDevice} disabled>{data.preferences.audioDevice} {t('pages.unavailable')}</SelectOption>}
        {available.map(device=><SelectOption key={device.id} value={device.id}>{device.name}</SelectOption>)}
      </Select>
    </Row>
    <div className="audio-input-level"><div className="input-meter" aria-label={t('pages.microphone_level')}><span style={{width:`${level*100}%`}}/></div></div>
    <Row title={t('pages.dictation_language')}><Language value={data.preferences.language} onChange={language=>void run(()=>save({language}))}/></Row>
    <Row title={t('pages.pause_media_during_dictation')} description={t('pages.playback_resumes_when_dictation_ends')}><Switch label={t('pages.pause_media_during_dictation')} value={data.preferences.pauseMedia} onChange={pauseMedia=>void run(()=>save({pauseMedia}))}/></Row>
    <Row title={t('pages.recording_sounds')}><Switch label={t('pages.recording_sounds')} value={data.preferences.sounds} onChange={sounds=>void run(()=>save({sounds}))}/></Row>
    {showPermissionAction&&<Row title={t('pages.microphone_permission')}><button onClick={()=>void run(()=>call('request_permissions',{kind:'microphone'}))}>{t('pages.check_access')}</button></Row>}
  </AudioPanel></>;
}
