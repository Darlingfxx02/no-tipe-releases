import { t, useLocale } from './i18n';
import { ThemePicker } from './ThemePicker';
import { Select, SelectOption } from './Select';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Preferences } from './types';
import type { Props } from './pages';
import { SettingsGroup as Panel, Row, Switch } from './ui';
import { useViewActive } from './RetainedView';
import { call } from './api';
import { PreviewStateWheel, previewPhases, previewPhaseIndex } from './PreviewStateWheel';

export function RecorderPlacementControl({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  useLocale();
  const buttons=useRef<(HTMLButtonElement|null)[]>([]);
  const options=[['island',t('Permissions.recorder_cloud')],['notch',t('Settings.notch')]] as const;
  const selected=value==='notch'?1:0;
  return <div className="recorder-placement-control" role="radiogroup" aria-label={t('Settings.recorder_position')}>
    {options.map(([placement,label],index)=><button key={placement} ref={button=>{buttons.current[index]=button;}} type="button" role="radio" aria-checked={selected===index} tabIndex={selected===index?0:-1}
      onClick={event=>{event.currentTarget.focus();if(value!==placement)onChange(placement);}}
      onKeyDown={event=>{
        let next=index;
        if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(event.key))next=1-index;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=1;
        else return;
        event.preventDefault();buttons.current[next]?.focus();if(value!==options[next][0])onChange(options[next][0]);
      }}>{label}</button>)}
  </div>;
}

export function Customization({data,save,run}:Props){
  useLocale();
  const p=data.preferences;
  const [appearanceDraft,setAppearanceDraft]=useState<Partial<Preferences>>({});
  const appearance={...p,...appearanceDraft};
  const appearanceSlider=(key:'lightIntensity'|'waveBrightness'|'recorderScale',title:string)=><Row title={title}><AppearanceSlider label={title} minimum={key==='recorderScale'?60:0} maximum={key==='lightIntensity'?200:100} fullScale={key==='waveBrightness'?4:1} value={appearance[key]} onChange={value=>setAppearanceDraft(d=>({...d,[key]:value}))} onCommit={value=>void run(async()=>{
    try{await save({[key]:value});}finally{setAppearanceDraft(d=>{if(d[key]!==value)return d;const next={...d};delete next[key];return next;});}
  })}/></Row>;
  const toggle=(key:keyof Preferences,title:string,description?:string)=><Row title={title} description={description}><Switch label={title} value={Boolean(p[key])} onChange={value=>void run(()=>save({[key]:value}))}/></Row>;
  return <div className="settings-detail customization-detail">
      <div className="customization-preview"><CloudPreview preferences={appearance}/></div>
      <ThemePicker value={p.palette} onChange={palette=>void run(()=>save({palette}))}/>
      <Panel><Row title={t('Settings.recorder_style')}><div className="recorder-style-control" role="radiogroup" aria-label={t('Settings.recorder_style')}>{(['liquid','pixel'] as const).map(style=><label key={style}><input type="radio" name="recorder-style" value={style} checked={p.recorderStyle===style} onChange={()=>void run(()=>save({recorderStyle:style}))}/><span>{t(style==='pixel'?'Settings.pixel_eyes':'Settings.liquid_waves')}</span></label>)}</div></Row>{p.recorderPlacement!=='notch'&&<Row title={t('Settings.control_layout_without_transcription')} description={t('Settings.separated_controls_merge_while_settings_are_open')}><Select aria-label={t('Settings.control_layout_without_transcription')} value={p.hiddenStyle} onValueChange={value=>void run(()=>save({hiddenStyle:value}))}><SelectOption value="split">{t('Settings.separated')}</SelectOption><SelectOption value="unified">{t('Settings.unified')}</SelectOption></Select></Row>}{p.recorderStyle==='pixel'&&<Row title={t('Settings.idle_eye_expression')}><Select aria-label={t('Settings.idle_eye_expression')} value={p.pixelEmotion} onValueChange={value=>void run(()=>save({pixelEmotion:value}))}>{[['auto',t('Settings.changing_moods')],['neutral',t('Settings.neutral')],['happy',t('Settings.smile')],['wink',t('Settings.wink')],['curious',t('Settings.surprised')],['love',t('Settings.heart')]].map(([value,label])=><SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Row>}{p.recorderStyle==='pixel'&&<Row title={t('Settings.processing_animation')} description={t('Settings.auto_changes_the_game_between_dictations_and_every')}><Select aria-label={t('Settings.processing_animation')} value={p.pixelProcessing} onValueChange={value=>void run(()=>save({pixelProcessing:value as Preferences['pixelProcessing']}))}>{[['auto',t('Settings.changing_games')],['pong',t('Settings.pong')],['starship',t('Settings.starship')],['snake',t('Settings.snake')],['breakout',t('Settings.breakout')]].map(([value,label])=><SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></Row>}{p.recorderStyle==='liquid'&&toggle('chromatic',t('Settings.colored_wave_edges'))}
      {appearanceSlider('lightIntensity',t('Settings.recorder_glow_intensity'))}
      {appearanceSlider('waveBrightness',p.recorderStyle==='pixel'?t('Settings.pixel_and_wave_brightness'):t('Settings.wave_brightness'))}
      {toggle('showDictationWaves',t('Settings.show_voice_visualization_during_dictation'))}
      {toggle('dashboardEffectOnly',t('Settings.background_waves_only_on_dashboard'))}
      </Panel>
      <Panel title={t('Settings.recorder_layout')}>{p.recorderPlacement==='island'&&<><Row title={t('Settings.floating_position')} help={t('Settings.floating_position_help')}><button type="button" onClick={()=>void run(()=>call('cloud_action',{action:'reset-position',detail:{}}))}>{t('Settings.reset_floating_position')}</button></Row>{appearanceSlider('recorderScale',t('Settings.recorder_size'))}</>}{toggle('alwaysShowCloud',t('Settings.always_show_the_idle_recorder'))}<Row title={t('Settings.hide_recorder_on_hover')} description={t('Settings.hide_recorder_on_hover_description')} help={t('Settings.hide_recorder_on_hover_help')}><Switch label={t('Settings.hide_recorder_on_hover')} value={p.hideRecorderOnHover} onChange={value=>void run(()=>save({hideRecorderOnHover:value}))}/></Row>{toggle('showTranscript',t('Settings.show_live_transcription'))}</Panel>
  </div>;
}
function CloudPreview({preferences}:{preferences:Preferences}){
  useLocale();
  const active = useViewActive();
  const [step,setStep]=useState(0);
  const [automatic,setAutomatic]=useState(true);
  const {phase,delay}=previewPhases[previewPhaseIndex(step)];
  useEffect(()=>{
    if(!active||!automatic)return;
    let timer:ReturnType<typeof setTimeout>;
    const schedule=()=>{clearTimeout(timer);if(!document.hidden)timer=setTimeout(()=>setStep(value=>value+1),delay);};
    schedule();document.addEventListener('visibilitychange',schedule);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',schedule);};
  },[active,automatic,step,delay]);
  return <div className="recorder-preview" data-phase={phase} data-transcript={preferences.showTranscript}>
    {active&&<RecorderPreview preferences={preferences} phase={phase}/>}
    <PreviewStateWheel position={step} onSelect={position=>{setAutomatic(false);setStep(position);}}/>
  </div>;
}
type PreviewPlacement='island'|'notch';
const previewTransitionMs=180;
function RecorderPreview({preferences,phase}:{preferences:Preferences;phase:string}){
  const placement:PreviewPlacement=preferences.recorderPlacement==='notch'?'notch':'island';
  const requested=useRef(placement);requested.current=placement;
  const [layers,setLayers]=useState<{visible:PreviewPlacement|null;outgoing:PreviewPlacement|null}>({visible:null,outgoing:null});
  const show=useCallback((readyPlacement:PreviewPlacement)=>{
    if(requested.current!==readyPlacement)return;
    setLayers(previous=>previous.visible===readyPlacement?previous:{visible:readyPlacement,outgoing:previous.visible});
  },[]);
  useEffect(()=>{
    if(!layers.outgoing)return;
    const timer=setTimeout(()=>setLayers(previous=>({...previous,outgoing:null})),previewTransitionMs);
    return()=>clearTimeout(timer);
  },[layers.visible,layers.outgoing]);
  // Each renderer keeps its own viewport until its opacity transition finishes.
  // Never resize an outgoing cloud using the incoming notch's geometry.
  const placements=[...new Set([placement,layers.visible,layers.outgoing].filter((value):value is PreviewPlacement=>value!==null))];
  return placements.map(value=><RecorderPreviewFrame key={value} placement={value} preferences={preferences} phase={phase} requested={value===placement} visible={value===layers.visible} onReady={show}/>);
}
function RecorderPreviewFrame({placement,preferences,phase,requested,visible,onReady}:{placement:PreviewPlacement;preferences:Preferences;phase:string;requested:boolean;visible:boolean;onReady:(placement:PreviewPlacement)=>void}){
  useLocale();
  const frame=useRef<HTMLIFrameElement>(null),current=useRef({preferences,phase});current.current={preferences,phase};
  const lastSent=useRef(''),paintFrames=useRef<number[]>([]),initializing=useRef(false);
  const [ready,setReady]=useState(false);
  const send=useCallback((force=false)=>{
    const target=frame.current?.contentWindow;if(!target)return;
    const {preferences,phase}=current.current;
    const previewView=phase==='expanded'?'expanded':phase==='settings'?'settings':'compact';
    const showTranscript=preferences.showTranscript||previewView==='expanded';
    // Send only appearance controls and sample text, never the user's recording.
    const next={uiLanguage:preferences.uiLanguage,state:phase==='paused'||previewView!=='compact'?'recording':phase,paused:phase==='paused',previewView,previewAudio:true,recorderStyle:preferences.recorderStyle,pixelEmotion:preferences.pixelEmotion,pixelProcessing:preferences.pixelProcessing,palette:preferences.palette,chromatic:preferences.chromatic,lightIntensity:preferences.lightIntensity,waveBrightness:preferences.waveBrightness,recorderScale:preferences.recorderScale,showDictationWaves:preferences.showDictationWaves,showTranscript,hiddenStyle:preferences.hiddenStyle,translation:preferences.translation,enhance:preferences.enhance,shorten:preferences.shorten,transcript:showTranscript?t('Settings.your_live_dictation_appears_here'):''};
    const serialized=JSON.stringify(next);if(!force&&lastSent.current===serialized)return;lastSent.current=serialized;
    // The preview is a bundled same-origin renderer. Direct delivery also works
    // in WKWebView, whose custom-scheme postMessage origins differ by OS release.
    try {const api=(target as Window&{noTipe?:{update:(s:typeof next)=>void}}).noTipe;if(api){api.update(next);return;}}catch{/* use the checked message bridge */}
    // WebKit treats custom-scheme iframe origins as opaque. The bundled frame
    // validates the parent window and sends no data to external destinations.
    target.postMessage({type:'no-tipe-snapshot',snapshot:next},location.protocol==='tauri:'?'*':location.origin);
  },[]);
  useEffect(()=>{send();},[preferences,phase,send]);
  const initialized=useCallback(()=>{
    send(true);if(initializing.current)return;initializing.current=true;
    // Let React commit the requested appearance and the canvas paint before reveal.
    paintFrames.current.push(requestAnimationFrame(()=>paintFrames.current.push(requestAnimationFrame(()=>setReady(true)))));
  },[send]);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{if(event.source===frame.current?.contentWindow&&event.data?.type==='no-tipe-ready')initialized();};
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);paintFrames.current.forEach(cancelAnimationFrame);};
  },[initialized]);
  useEffect(()=>{if(ready&&requested)onReady(placement);},[ready,requested,placement,onReady]);
  return <iframe ref={frame} className="recorder-preview-frame" data-placement={placement} data-visible={visible} aria-hidden={!visible} inert={!visible} tabIndex={-1} title={t('Settings.recorder_appearance_preview')} src={placement==='notch'?'/notch.html?preview=customization':'/cloud.html?preview=customization'} onLoad={()=>{
    send(true);
    try{if((frame.current?.contentWindow as Window&{noTipe?:unknown})?.noTipe)initialized();}catch{/* wait for the ready bridge */}
  }}/>;
}
function AppearanceSlider({label,value,minimum=0,maximum,fullScale,onChange,onCommit}:{label:string;value:number;minimum?:number;maximum:number;fullScale:number;onChange:(value:number)=>void;onCommit:(value:number)=>void}){
  const dirty=useRef(false),latest=useRef(value);
  const commit=()=>{if(dirty.current){dirty.current=false;onCommit(latest.current);}};
  // Keep stored values in renderer energy units so older settings/backups keep
  // their actual brightness when the visible percentage scale changes.
  const percentage=Math.round(value/fullScale*100);
  return <div className="appearance-slider"><input type="range" aria-label={label} aria-valuetext={`${percentage}%`} min={minimum} max={maximum} step="1" style={{'--range-fill':`${Math.max(0,Math.min(100,(percentage-minimum)/(maximum-minimum)*100))}%`} as React.CSSProperties} value={percentage} onChange={event=>{latest.current=Number(event.target.value)/100*fullScale;dirty.current=true;onChange(latest.current);}} onPointerUp={commit} onPointerCancel={commit} onBlur={commit} onKeyUp={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))commit();}}/><output aria-hidden="true">{percentage}%</output></div>;
}
