import { useCallback,useEffect,useRef,useState } from 'react';
import type { CSSProperties } from 'react';
import { defaults } from './api';
import { themeOptions,themeSwatch } from './theme';
import type { Snapshot } from './types';
import type { PixelProcessing } from './recorder/processing.js';
import './pixel-preview.css';

const states=[['idle','Ожидание'],['recording','Запись'],['paused','Пауза'],['preparing','Обработка'],['result','Вставлено'],['copied','В буфере'],['failed','Ошибка'],['busy','Занято']] as const;
const emotions=[['auto','Живые эмоции'],['neutral','Спокойствие'],['happy','Улыбка'],['wink','Подмигивание'],['curious','Удивление'],['love','Сердечко'],['focused','Сосредоточенность'],['surprised','Изумление'],['joy','Радость'],['squint','Прищур'],['playful','Азарт'],['star','Звёздочки']] as const;
const descriptions:Record<string,string>={idle:'Погладьте робота движением курсора — он покажет красное сердечко.',recording:'Живой эквалайзер быстро реагирует на голос и плавно качается.',paused:'Запись приостановлена. Глаза отдыхают.',preparing:'Ретро-игра, пока обрабатывается текст.',result:'Галочка — текст успешно вставлен.',copied:'Значок копирования — текст готов в буфере обмена.',failed:'Восклицательный знак — ошибка обработки.',busy:'Ретро-игра, пока занята другая запись.'};
export default function PixelPreview(){
  const [phase,setPhase]=useState('idle'),[emotion,setEmotion]=useState('auto'),[palette,setPalette]=useState('prism'),[processing,setProcessing]=useState<PixelProcessing>('auto');
  const [placement,setPlacement]=useState('island'),[zoom,setZoom]=useState(2),[transcript,setTranscript]=useState(false),[hiddenStyle,setHiddenStyle]=useState('split'),[scale,setScale]=useState(1);
  const frame=useRef<HTMLIFrameElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const snapshot:Snapshot&{previewAudio:boolean}={...defaults,state:phase==='paused'?'recording':phase,paused:phase==='paused',recorderStyle:'pixel',pixelEmotion:emotion,pixelProcessing:processing,palette,recorderScale:scale,showTranscript:transcript,hiddenStyle,transcript:transcript?'Так выглядит текст, который появляется во время диктовки.':'',previewAudio:true,error:null};
  const current=useRef(snapshot);current.current=snapshot;
  const send=useCallback(()=>{
    const target=frame.current?.contentWindow;if(!target)return;
    try{const api=(target as Window&{noTipe?:{update:(s:Snapshot)=>void}}).noTipe;if(api){api.update(current.current);return;}}catch{/* same-origin message fallback */}
    target.postMessage({type:'no-tipe-snapshot',snapshot:current.current},location.origin);
  },[]);
  const chooseState=(value:string)=>{if(timer.current)clearTimeout(timer.current);timer.current=null;setPhase(value);};
  useEffect(()=>{send();},[phase,emotion,processing,palette,placement,transcript,hiddenStyle,scale,send]);
  useEffect(()=>{
    const receive=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow)return;
      if(event.data?.type==='no-tipe-ready')send();
      if(event.data?.type!=='no-tipe-action')return;
      const action=event.data.action;
      if(action==='record')chooseState('recording');
      if(action==='pause')setPhase(value=>value==='paused'?'recording':'paused');
      if(action==='cancel'||action==='close')chooseState('idle');
      if(action==='finish'){chooseState('preparing');timer.current=setTimeout(()=>setPhase('result'),1200);}
    };
    window.addEventListener('message',receive);return()=>{window.removeEventListener('message',receive);if(timer.current)clearTimeout(timer.current);};
  },[send]);
  return <main className="pixel-lab">
    <header><a href="/pixel-preview.html" aria-label="No Type pixel preview"><span className="lab-logo" aria-hidden>▦</span>No Type<span className="lab-divider">/</span><span>Pixel recorder</span></a><span className="lab-badge"><i/>Локальное превью</span></header>
    <div className="lab-heading"><p>PIXEL EYES</p><h1>Пиксельная диктовалка</h1></div>
    <section className="lab-stage" aria-label="Превью пиксельной диктовалки" data-placement={placement} style={{'--preview-zoom':zoom} as CSSProperties}>
      <div className="lab-stage-label"><span>PIXEL EYES</span><div className="lab-zoom" role="group" aria-label="Масштаб превью">{[1,2,3].map(value=><button key={value} aria-pressed={zoom===value} onClick={()=>setZoom(value)}>{value}×</button>)}</div></div>
      <div className="lab-device" style={{transform:`translate(-50%,-50%) scale(${zoom})`}}><iframe key={placement} ref={frame} title="Новая пиксельная диктовалка" src={placement==='notch'?'/notch.html?preview=1':'/cloud.html?preview=1'} onLoad={send}/></div>
      <div className="lab-stage-caption" aria-live="polite"><strong>{states.find(([value])=>value===phase)?.[1]}</strong><span>{descriptions[phase]}</span>{phase==='recording'&&<small>Симуляция голоса</small>}</div>
    </section>
    <section className="lab-controls"><div className="lab-control-heading"><h2>Состояние</h2><span>Переключайте вручную или нажмите на диктовалку</span></div><div className="lab-states" role="group" aria-label="Состояние диктовалки">{states.map(([value,label])=><button key={value} data-state={value} aria-pressed={phase===value} onClick={()=>chooseState(value)}><i/>{label}</button>)}</div>
      <div className="lab-settings"><label>Выражение в покое<select aria-label="Выражение в покое" value={emotion} onChange={event=>{setEmotion(event.target.value);chooseState('idle');}}>{emotions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Анимация обработки<select aria-label="Анимация обработки" value={processing} onChange={event=>{setProcessing(event.target.value as PixelProcessing);chooseState('preparing');}}>{[['auto','Чередование игр'],['pong','Пинг-понг'],['starship','Космический кораблик'],['snake','Змейка'],['breakout','Арканоид']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Расположение<select aria-label="Расположение" value={placement} onChange={event=>setPlacement(event.target.value)}><option value="island">Плавающий остров</option><option value="notch">У верхнего края</option></select></label><label>Управление<select aria-label="Управление" value={hiddenStyle} onChange={event=>setHiddenStyle(event.target.value)}><option value="split">Раздельные кнопки</option><option value="unified">Единая панель</option></select></label><label>Размер диктовалки<select aria-label="Размер диктовалки" value={scale} onChange={event=>setScale(Number(event.target.value))}><option value={1}>100%</option><option value={.8}>80%</option><option value={.6}>60%</option></select></label></div>
      <div className="lab-theme-row"><div><h2>Цветовая тема</h2><span>{themeOptions.find(([value])=>value===palette)?.[1]}</span></div><div className="lab-swatches" role="group" aria-label="Цветовая тема">{themeOptions.map(([value,label])=><button key={value} style={{background:themeSwatch(value)}} aria-label={label} title={label} aria-pressed={palette===value} onClick={()=>setPalette(value)}/>)}</div><label className="lab-transcript"><input type="checkbox" checked={transcript} onChange={event=>setTranscript(event.target.checked)}/>Живой текст</label></div>
    </section><footer>21 × 11 пикселей<span>Тот же рендер, что в приложении</span></footer>
  </main>;
}
