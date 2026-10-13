import { useCallback, useEffect, useRef } from 'react';
import type { Preferences } from './types';
import type { PixelPointer } from './recorder/pixels.js';

export function OnboardingCompanion({preferences,appearance=false}:{preferences:Preferences|null;appearance?:boolean}) {
  const frame=useRef<HTMLIFrameElement>(null),current=useRef({preferences,appearance});current.current={preferences,appearance};
  const send=useCallback((type:'no-tipe-snapshot'|'no-tipe-pointer',value:unknown)=>{
    const target=frame.current?.contentWindow;if(!target)return;
    try {
      const api=(target as Window&{noTipe?:{update:(value:unknown)=>void;pointer?:(value:PixelPointer)=>void}}).noTipe;
      if(api){if(type==='no-tipe-snapshot')api.update(value);else api.pointer?.(value as PixelPointer);return;}
    }catch{/* WKWebView can use an opaque origin for the bundled frame. */}
    target.postMessage(type==='no-tipe-snapshot'?{type,snapshot:value}:{type,pointer:value},location.protocol==='tauri:'?'*':location.origin);
  },[]);
  const update=useCallback(()=>{
    const {preferences:p,appearance}=current.current;
    send('no-tipe-snapshot',{state:'idle',uiLanguage:p?.uiLanguage??'system',palette:p?.palette??'prism',recorderStyle:appearance?p?.recorderStyle??'pixel':'pixel',pixelEmotion:'neutral',hiddenStyle:'unified',showTranscript:false,showDictationWaves:true,recorderScale:2,chromatic:appearance?p?.chromatic??false:false,lightIntensity:p?.lightIntensity??.28,waveBrightness:appearance?p?.waveBrightness??.35:.8});
  },[send]);
  useEffect(()=>{update();},[preferences,appearance,update]);
  useEffect(()=>{
    let raf=0,position:{x:number;y:number}|null=null;
    const flush=()=>{
      raf=0;const bounds=frame.current?.getBoundingClientRect();if(!bounds||!position)return;
      send('no-tipe-pointer',{x:position.x-bounds.left,y:position.y-bounds.top,valid:true});
    };
    const move=(event:PointerEvent)=>{
      if(event.pointerType!=='mouse')return;
      position={x:event.clientX,y:event.clientY};if(!raf)raf=requestAnimationFrame(flush);
    };
    const reset=()=>{position=null;cancelAnimationFrame(raf);raf=0;send('no-tipe-pointer',{x:0,y:0,valid:false});};
    const leave=(event:MouseEvent)=>{if(!event.relatedTarget)reset();};
    const ready=(event:MessageEvent)=>{if(event.source===frame.current?.contentWindow&&event.data?.type==='no-tipe-ready'){update();flush();}};
    const reposition=()=>{if(position&&!raf)raf=requestAnimationFrame(flush);};
    const observer=new ResizeObserver(reposition),container=frame.current?.closest('.dictation-setup');if(container)observer.observe(container);
    window.addEventListener('pointermove',move,{passive:true});window.addEventListener('blur',reset);window.addEventListener('mouseout',leave);window.addEventListener('message',ready);
    window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);document.addEventListener('visibilitychange',reset);
    return()=>{
      observer.disconnect();cancelAnimationFrame(raf);window.removeEventListener('pointermove',move);window.removeEventListener('blur',reset);window.removeEventListener('mouseout',leave);window.removeEventListener('message',ready);
      window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);document.removeEventListener('visibilitychange',reset);
    };
  },[send,update]);
  const placement=appearance&&preferences?.recorderPlacement==='notch'?'notch':'cloud';
  return <div className="onboarding-companion" data-placement={placement} aria-hidden="true"><iframe ref={frame} title="No Type" src={`/${placement==='notch'?'notch':'cloud'}.html?preview=1&onboarding=1`} tabIndex={-1} onLoad={update}/></div>;
}
