import { t, useLocale, setUiLanguage } from './i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { call, defaults, native } from './api';
import type { Snapshot } from './types';
import { NotchMaterial } from './NotchMaterial';
import { PixelFace } from './PixelFace';
import { PixelControlIcon } from './PixelControlIcon';
import { RecorderChoices } from './RecorderChoices';
import { useTheme } from './theme';
import { LiveTranscript } from './LiveTranscript';
import { notchLayout } from './notchGeometry';
import type { NotchGeometry } from './notchGeometry';
import { connectRecorderBridge } from './recorder/nativeBridge.js';

const demo = location.pathname.endsWith('/notch-demo.html');
const preview = demo || new URLSearchParams(location.search).has('preview');
const customizationPreview = new URLSearchParams(location.search).get('preview')==='customization';
if(demo)document.documentElement.classList.add('notch-demo');
if(customizationPreview)document.documentElement.dataset.customizationPreview='true';
if(preview&&new URLSearchParams(location.search).has('onboarding'))document.documentElement.classList.add('onboarding-recorder-preview');
const initial:Snapshot={...defaults,state:'idle',paused:false,transcript:'',error:null};
const getLanguages = () => ([['english',t('common.english'),'EN'],['russian',t('common.russian'),'RU']] as const);
function Glyph({kind,pixel=false}:{kind:string;pixel?:boolean}){
  const glyph=<svg viewBox="0 0 24 24" aria-hidden="true">{kind==='empowerment'?<path d="m12 2 2.7 6.9L22 12l-7.3 3.1L12 22l-2.7-6.9L2 12l7.3-3.1L12 2Z"/>:kind==='translation'?<path d="M12.87 15.07 10.33 12.56l.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v2h11.17c-.67 1.92-1.73 3.74-3.17 5.34-.93-1.03-1.7-2.16-2.31-3.34h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04ZM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12ZM15.88 17l1.62-4.33L19.12 17h-3.24Z"/>:kind==='pause'?<path d="M6 5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zm8 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/>:kind==='play'?<path d="M7 4.5a1.5 1.5 0 0 1 2.3-1.27l11 7.5a1.5 1.5 0 0 1 0 2.54l-11 7.5A1.5 1.5 0 0 1 7 19.5z"/>:kind==='settings'?<path d="M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm11 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zm11 0h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"/>:kind==='close'?<path d="m7 5 5 5 5-5 2 2-5 5 5 5-2 2-5-5-5 5-2-2 5-5-5-5z"/>:kind==='copied'?<g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="8" y="8" width="12" height="13" rx="3"/><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></g>:kind==='failed'?<g><rect x="10.5" y="4" width="3" height="11" rx="1.5"/><circle cx="12" cy="19" r="1.6"/></g>:kind==='result'?<path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>:<circle className="notch-spinner" cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="33 18"/>}</svg>;
  return pixel?<PixelControlIcon kind={kind}>{glyph}</PixelControlIcon>:glyph;
}
export function Notch(){
  useLocale();
  const [snapshot,setSnapshot]=useState(initial),[geometry,setGeometry]=useState<NotchGeometry>({top:demo?32:0,cutoutWidth:demo?184:0,maximumWidth:Math.min(560,innerWidth-24)});
  const [hover,setHover]=useState(false),[interactiveSettings,setSettings]=useState(false),[empowermentPickerOpen,setEmpowermentPickerOpen]=useState(false),[translationPickerOpen,setTranslationPickerOpen]=useState(false);
  const settings=interactiveSettings||(customizationPreview&&snapshot.previewView==='settings');
  useTheme(snapshot.palette);
  const surface=useRef<HTMLDivElement>(null),hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const previousPhase=useRef(snapshot.state);
  const demoCompletion=useRef('result');
  const [textHeight,setTextHeight]=useState(20);
  const update=useCallback((s:Snapshot)=>{setUiLanguage(s.uiLanguage??'system',false);setSnapshot({...initial,...s});},[]);
  useEffect(()=>{
    if(previousPhase.current!==snapshot.state){setSettings(false);setEmpowermentPickerOpen(false);setTranslationPickerOpen(false);setHover(false);previousPhase.current=snapshot.state;}
  },[snapshot.state]);
  useEffect(()=>{
    const stops:(()=>void)[]=[];
    if(native&&!preview){
      const connection=connectRecorderBridge({core:{invoke:call},event:{listen}}, {update,dock:setGeometry,error:console.error});
      stops.push(connection.dispose);
    }
    const target=window as Window&{noTipe?:{update:(s:Snapshot)=>void}};
    target.noTipe={update};
    const receive=(event:MessageEvent)=>{
      const local=event.origin===location.origin||(location.protocol==='tauri:'&&['null','tauri://localhost'].includes(event.origin));
      if(!preview||event.source!==parent||!local)return;
      if(event.data?.type==='no-tipe-snapshot')update(event.data.snapshot);
      if(event.data?.type==='no-tipe-dock-preview')setGeometry(event.data.geometry);
    };
    window.addEventListener('message',receive);
    if(preview)parent.postMessage({type:'no-tipe-ready'},location.protocol==='tauri:'?'*':location.origin);
    return()=>{stops.forEach(stop=>stop());window.removeEventListener('message',receive);delete target.noTipe;};
  },[update]);
  useEffect(()=>()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current);},[]);
  useEffect(()=>{if((empowermentPickerOpen||translationPickerOpen)&&hoverTimer.current){clearTimeout(hoverTimer.current);hoverTimer.current=null;}},[empowermentPickerOpen,translationPickerOpen]);
  useEffect(()=>{
    if(!demo)return;
    if(snapshot.state==='preparing'){
      const timer=setTimeout(()=>update({...snapshot,state:demoCompletion.current,empowerment:null}),snapshot.enhance||snapshot.shorten||snapshot.translation!=='off'?1100:700);
      return()=>clearTimeout(timer);
    }
    if(['result','copied','failed'].includes(snapshot.state)){
      const timer=setTimeout(()=>update({...snapshot,state:'idle',transcript:'',paused:false}),1000);
      return()=>clearTimeout(timer);
    }
  },[snapshot,update]);
  const toggleSettings=()=>{setEmpowermentPickerOpen(false);setTranslationPickerOpen(false);setSettings(v=>!v);};
  const action=(name:string,detail:Record<string,unknown>={})=>{
    if(preview&&!demo)parent.postMessage({type:'no-tipe-action',action:name,detail},location.origin);
    if(native&&!preview)void call('cloud_action',{action:name,detail}).catch(console.error);
    else if(name==='record')update({...snapshot,state:'recording'});
    else if(name==='pause')update({...snapshot,paused:!snapshot.paused});
    else if(name==='finish'){demoCompletion.current='result';update({...snapshot,state:'preparing'});}
    else if(name==='empowerment')update({...snapshot,empowerment:String(detail.value)||null,empowermentColor:snapshot.empowerments?.find(item=>item.id===detail.value)?.color||'#F5C84C'});
    else if(name==='translation')update({...snapshot,translation:String(detail.value)});
    else if(name==='processing')update({...snapshot,[String(detail.value)]:detail.enabled});
  };
  const phase=snapshot.state,recording=phase==='recording',processing=phase==='preparing'||phase==='busy';
  const complete=['result','copied','failed'].includes(phase),open=settings||hover||phase!=='idle';
  const text=recording&&snapshot.showTranscript&&!settings&&!!snapshot.transcript;
  const {hardware,dockWidth,dockHeight,compactHeight,width,height,shortLanguages}=notchLayout(geometry,open,settings,text?textHeight:null);
  const report=useCallback(()=>{
    if(!native||preview||!surface.current)return;
    const node=surface.current;
    // Accept input on the visible controls, transcript and menu only. The
    // transparent space beside the dock leaves macOS menu items accessible.
    const detached=node.classList.contains('is-open');
    const targets=detached?[...node.querySelectorAll('.notch-menu,.notch-voice,.notch-status,.notch-finish,.notch-options,.notch-text')]:[node];
    targets.push(...node.querySelectorAll<HTMLElement>('.notch-language-chip[data-visible="true"]'));
    const regions=targets.map(target=>{const r=target.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
    void call('cloud_action',{action:'regions',detail:{regions}}).catch(()=>{});
  },[]);
  useLayoutEffect(()=>{
    let frame=0;const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(report);};
    const observer=new ResizeObserver(measure);observer.observe(surface.current!);measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[report]);
  useLayoutEffect(()=>{
    if(!native||preview)return;
    let frame=0;const start=performance.now();
    const measure=(now:number)=>{report();if(now-start<450)frame=requestAnimationFrame(measure);};
    frame=requestAnimationFrame(measure);return()=>cancelAnimationFrame(frame);
  },[geometry,phase,settings,open,translationPickerOpen,empowermentPickerOpen,report]);
  const hoverIn=()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current);hoverTimer.current=setTimeout(()=>setHover(true),140);};
  const hoverOut=()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current);if(translationPickerOpen||empowermentPickerOpen)return;hoverTimer.current=setTimeout(()=>{setHover(false);setSettings(false);setEmpowermentPickerOpen(false);setTranslationPickerOpen(false);},260);};
  const status=phase==='result'?t('Dashboard.inserted'):phase==='copied'?t('CopyFeedback.copied'):phase==='failed'?t('Notch.error'):processing?t('Notch.preparing'):snapshot.paused?t('Dashboard.paused'):t('Notch.listening');
  return <>{demo&&hardware&&<div className="notch-demo-hardware" aria-hidden="true"/>}<div className={`notch-anchor wraps-cutout ${preview?'notch-preview':''}`} data-display-kind={hardware?'hardware':'flat'} data-display-id={geometry.displayId} style={{top:0,'--cutout-width':`${dockWidth}px`,'--cutout-height':`${dockHeight}px`,'--compact-height':`${compactHeight}px`} as CSSProperties}>
    <div ref={surface} className={`notch-surface ${open?'is-open':''} ${text?'has-text':''} ${settings?'has-settings':''}`} data-phase={phase} data-recorder-style={snapshot.recorderStyle} style={{width,height} as CSSProperties}
      onPointerEnter={hoverIn} onPointerLeave={hoverOut} onPointerDown={e=>{if(native&&!preview)e.preventDefault();}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();if(empowermentPickerOpen){setEmpowermentPickerOpen(false);requestAnimationFrame(()=>surface.current?.querySelector<HTMLButtonElement>('.notch-empowerment-trigger')?.focus());}else if(translationPickerOpen){setTranslationPickerOpen(false);requestAnimationFrame(()=>surface.current?.querySelector<HTMLButtonElement>('.notch-translation-trigger')?.focus());}else if(settings){setSettings(false);surface.current?.querySelector<HTMLButtonElement>('.notch-menu')?.focus();}else{setHover(false);if(native&&!preview)action('cancel');}}if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();action('finish');}}}>
      <div className="notch-shading"/>
      <NotchMaterial snapshot={snapshot} open={open} menu={settings||text} translationVisible={settings&&!translationPickerOpen} empowermentVisible={settings&&!empowermentPickerOpen} dockWidth={dockWidth} dockHeight={dockHeight} hardwareCutout={hardware} panelWidth={width} panelHeight={height} demo={demo}/>
      {snapshot.recorderStyle==='pixel'&&<PixelFace snapshot={snapshot} demo={preview}/>}
      {!open&&<button className="notch-peek" aria-label={t('Notch.open_no_tipe')} onClick={()=>setHover(true)}/>}
      {text&&<LiveTranscript className="notch-text" text={snapshot.transcript} maxLines={2} onHeight={setTextHeight}/>}
      {settings&&<div id="notch-settings-options" className="notch-options" aria-label={t('Notch.dictation_settings')}>
        {translationPickerOpen?<RecorderChoices label={t('Modes.translation')} value={snapshot.translation} options={[["off",t('common.no_translation')],...getLanguages().map(([value,label])=>[value,label] as const)]} onSelect={value=>{action('translation',{value});setTranslationPickerOpen(false);requestAnimationFrame(()=>surface.current?.querySelector<HTMLButtonElement>('.notch-translation-trigger')?.focus());}}/>:empowermentPickerOpen?<RecorderChoices label={t('Empowerments.title')} value={snapshot.empowerment||''} options={[["",t('Empowerments.none')],...(snapshot.empowerments?.length?snapshot.empowerments:[{id:'brief',name:t('Empowerments.brief'),color:'#F5C84C'}]).map(item=>[item.id,item.name,item.color] as const)]} onSelect={value=>{action('empowerment',{value});setEmpowermentPickerOpen(false);requestAnimationFrame(()=>surface.current?.querySelector<HTMLButtonElement>('.notch-empowerment-trigger')?.focus());}}/>:([['enhance',t('Modes.improve_text')],['shorten',t('common.shorten')]] as const).map(([key,label])=><button className="notch-setting" role="switch" aria-checked={snapshot[key]} key={key} onClick={()=>action('processing',{value:key,enabled:!snapshot[key]})}><span>{label}</span><i aria-hidden="true"><b/></i></button>)}
      </div>}
      <div className="notch-language-row" role="group" aria-label={t('Notch.dictation_settings')} aria-hidden={!settings} inert={!settings} data-short={shortLanguages}>
        <button className="notch-language-chip notch-translation-trigger" data-lobe="0" data-visible={settings&&!translationPickerOpen} inert={!settings||translationPickerOpen} data-enabled={snapshot.translation!=='off'} aria-label={t('Modes.translation')} aria-expanded={settings&&translationPickerOpen} aria-controls="notch-settings-options" onClick={()=>{setEmpowermentPickerOpen(false);setTranslationPickerOpen(true);}}><Glyph kind="translation" pixel={snapshot.recorderStyle==='pixel'}/></button>
        <button className="notch-language-chip notch-translation-trigger notch-empowerment-trigger" data-lobe="3" data-visible={settings&&!empowermentPickerOpen} inert={!settings||empowermentPickerOpen} data-enabled={!!snapshot.empowerment} aria-label={t('Empowerments.title')} title={t('Empowerments.title')} aria-expanded={settings&&empowermentPickerOpen} aria-controls="notch-settings-options" onClick={()=>{setTranslationPickerOpen(false);setEmpowermentPickerOpen(true);}}><Glyph kind="empowerment" pixel={snapshot.recorderStyle==='pixel'}/></button>
      </div>
      {hardware&&<div className="notch-cutout-exclusion" aria-hidden="true"/>}
      <div className="notch-controls" aria-hidden={!open} inert={!open}>
          <button className="notch-control notch-menu" aria-label={settings?t('Notch.close_settings'):t('Notch.dictation_settings')} aria-expanded={settings} onClick={toggleSettings}><Glyph kind={settings?'close':'settings'} pixel={snapshot.recorderStyle==='pixel'}/></button>
          {processing||complete?<button className={`notch-status ${complete?'complete':''}`} title={status} onClick={()=>{if(demo&&complete)update({...snapshot,state:phase==='result'?'copied':phase==='copied'?'failed':'idle'});else if(complete)action('history');}} disabled={processing} aria-label={status}><Glyph kind={phase}/><span className="sr-only" role="status">{status}</span></button>:<button className="notch-voice" aria-label={recording?(snapshot.paused?t('Notch.resume_dictation'):t('Notch.pause_dictation')):t('Dashboard.start_dictation')} onClick={()=>action(recording?'pause':'record')}><span className="notch-voice-icon"><Glyph kind={recording&&!snapshot.paused?'pause':'play'} pixel={snapshot.recorderStyle==='pixel'}/></span></button>}
          {!hardware&&<button className="notch-finish" aria-label={recording?t('Notch.finish_dictation'):processing||complete?status:t('Dashboard.start_dictation')} disabled={processing} onClick={()=>action(complete?'history':recording?'finish':'record')}><span className="sr-only">{status}</span></button>}

      </div>
    </div>
  </div></>;
}
