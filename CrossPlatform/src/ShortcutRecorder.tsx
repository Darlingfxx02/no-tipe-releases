import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, native, errorMessage, errorSource } from './api';
import { isModifierKey, isWindowsSystemMenuShortcut, shortcutFromKey, shortcutLabel } from './shortcuts';
import { useViewActive } from './RetainedView';
import { ShortcutCapture } from './shortcutCapture';

export function ShortcutRecorder({value,platform,onChange,onBusyChange,disabled=false}:{value:string;platform:string;onChange:(value:string)=>Promise<void>;onBusyChange?:(busy:boolean)=>void;disabled?:boolean}) {
  useLocale();
  const active = useViewActive();
  const [listening,setListening]=useState(false),[candidate,setCandidate]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const chosen=useRef(''),finished=useRef(false),commitRef=useRef(onChange),capture=useRef<ShortcutCapture|null>(null);commitRef.current=onChange;
  useEffect(()=>{onBusyChange?.(listening||saving);},[listening,saving,onBusyChange]);
  useEffect(()=>()=>{onBusyChange?.(false);},[onBusyChange]);
  function choose(value:string){chosen.current=value;setCandidate(value);}
  useEffect(()=>{
    if(!active){setListening(false);void capture.current?.finish().catch(e=>setError(errorSource(e)));return;}
    if(!listening)return;
    let disposed=false;const off:(()=>void)[]=[];const session=capture.current;const held=new Set<string>();finished.current=false;
    async function finish(save:boolean){
      if(finished.current)return;finished.current=true;
      setSaving(save);setListening(false);
      try{await session?.finish(save?chosen.current:undefined);setError('');}
      catch(e){setError(errorSource(e));}finally{setSaving(false);}
    }
    const down=(event:KeyboardEvent)=>{
      event.preventDefault();event.stopPropagation();
      if(event.key==='Escape'){void finish(false);return;}
      if(event.repeat)return;
      held.add(event.code||event.key);
      // Windows registers combinations with a regular key. Ignore intermediate
      // modifier presses so Ctrl, then Alt, then D captures the whole shortcut.
      if(platform!=='macos'&&isModifierKey(event)){
        // Right Ctrl is a standalone Windows gesture. If another modifier or
        // regular key follows, capture that combination instead of its prefix.
        if(platform==='windows'&&event.code==='ControlRight'&&held.size===1){choose('ControlRight');setError('');}
        else choose('');
        return;
      }
      const result=shortcutFromKey(event,platform);
      if(result){choose(result);setError('');}else{choose('');setError(platform==='macos'?t('ShortcutRecorder.use_a_modifier_with_a_key_or_a'):t('ShortcutRecorder.use_a_modifier_with_a_regular_key_such'));}
    };
    const up=(event:KeyboardEvent)=>{
      event.preventDefault();event.stopPropagation();
      held.delete(event.code||event.key);
      if(!held.size&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&!event.metaKey&&chosen.current)void finish(true);
    };
    const blur=()=>{void finish(false);};
    document.addEventListener('keydown',down,true);document.addEventListener('keyup',up,true);window.addEventListener('blur',blur);
    const subscriptions=[listen('shortcut-reserved',()=>{choose('');setError(t(platform==='windows'?'native.shortcut.windows_system_menu':'ShortcutRecorder.reserved'));})];
    if(platform==='macos')subscriptions.push(
      listen<{code:number;flags:number}>('shortcut-modifier',e=>{
        const codes:Record<number,string>={61:'AltRight',58:'AltLeft',62:'ControlRight',59:'ControlLeft',60:'ShiftRight',56:'ShiftLeft',54:'MetaRight',55:'MetaLeft',63:'Fn'};
        const single=e.payload.flags>0&&(e.payload.flags&(e.payload.flags-1))===0;
        if(single&&codes[e.payload.code]&&!chosen.current.includes('+'))choose(codes[e.payload.code]);
        if(e.payload.flags===0&&!held.size&&chosen.current)void finish(true);
      })
    );
    void Promise.all(subscriptions).then(cleanups=>{if(disposed)cleanups.forEach(fn=>fn());else off.push(...cleanups);}).catch(e=>{setError(errorSource(e));void finish(false);});
    const timer=setTimeout(()=>void finish(false),15000);
    return()=>{disposed=true;off.forEach(fn=>fn());clearTimeout(timer);document.removeEventListener('keydown',down,true);document.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);void session?.finish().catch(e=>setError(errorSource(e)));};
  },[listening,active,platform]);
  useEffect(()=>()=>{void capture.current?.finish().catch(()=>{});},[]);
  const warning=error||(platform==='windows'&&!listening&&isWindowsSystemMenuShortcut(value)?t('native.shortcut.windows_system_menu'):'');
  return <div className="shortcut-recorder"><button className={listening?'shortcut-capture listening':'shortcut-capture'} disabled={disabled||!native||saving} aria-label={listening?t('ShortcutRecorder.listening_for_shortcut'):t('ShortcutRecorder.record_dictation_shortcut')} aria-busy={saving} onClick={()=>void(async()=>{setSaving(true);try{if(listening){setListening(false);await capture.current?.finish();return;}const session=new ShortcutCapture(active=>call('shortcut_capture',{active}),value=>commitRef.current(value));capture.current=session;await session.start();choose('');setError('');setListening(true);}catch(e){setError(errorSource(e));}finally{setSaving(false);}})()}><kbd>{listening?(candidate?shortcutLabel(candidate,platform):t('ShortcutRecorder.press_keys')):shortcutLabel(value,platform)}</kbd></button>{warning&&<p role="alert" className="field-error">{errorMessage(warning)}</p>}</div>;
}
