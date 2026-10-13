import {useEffect,useRef,useState} from 'react';
import {t,useLocale} from './i18n';
import {PixelRecorder} from './recorder/pixels.js';
import {EmpowermentEffect,empoweredWaveFragment} from './recorder/empowerment.js';
import cloud from './generated/cloudWave.json';
import {themePalette} from './theme';
import {useViewActive} from './RetainedView';

function EffectCanvas({color,style}:{color:string;style:'pixel'|'liquid'}) {
  const active=useViewActive(),canvas=useRef<HTMLCanvasElement>(null),current=useRef(color),wake=useRef<(()=>void)|null>(null);current.current=color;
  useEffect(()=>{wake.current?.();},[color]);
  useEffect(()=>{
    if(!active)return;
    const node=canvas.current!,reduced=matchMedia('(prefers-reduced-motion:reduce)');
    const pixels=style==='pixel'?new PixelRecorder(node):null;
    const gl=pixels?null:node.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false});
    let program:WebGLProgram|null=null,vao:WebGLVertexArrayObject|null=null,frame=0,last=0,time=0;
    const locations=new Map<string,WebGLUniformLocation|null>(),power=new EmpowermentEffect();
    const set=(name:string,value:number|number[])=>{
      if(!gl||!program)return;
      if(!locations.has(name))locations.set(name,gl.getUniformLocation(program,name));
      const at=locations.get(name)!;
      if(typeof value==='number')gl.uniform1f(at,value);else if(value.length===2)gl.uniform2fv(at,value);else if(value.length===3)gl.uniform3fv(at,value);else gl.uniform4fv(at,value);
    };
    if(gl){
      const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error||'Shader compile');}return shader;};
      try {
        const v=compile(gl.VERTEX_SHADER,cloud.vertex),f=compile(gl.FRAGMENT_SHADER,empoweredWaveFragment(cloud.fragment));
        program=gl.createProgram()!;gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Shader link');
        vao=gl.createVertexArray();
      }catch(error){console.error(error);node.dataset.fallback='true';}
    }
    function draw(now:number){
      frame=0;if(document.hidden){last=0;return;}
      const delta=last?Math.min(.05,(now-last)/1000):1/60;last=now;if(!reduced.matches)time+=delta;
      const selection={id:'preview',color:current.current},level=reduced.matches?.35:.35+Math.sin(time*3)*.2+Math.sin(time*7)*.12;
      if(pixels)pixels.draw({state:'recording',level,time,empowerment:selection,brightness:.7,pitch:3,reducedMotion:reduced.matches},delta);
      else if(gl&&program){
        const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(node.clientWidth*dpr),h=Math.round(node.clientHeight*dpr);
        if(node.width!==w||node.height!==h){node.width=w;node.height=h;}
        gl.viewport(0,0,w,h);gl.useProgram(program);gl.bindVertexArray(vao);
        for(const [key,value] of Object.entries(cloud.defaults))if(key.startsWith('u'))set(key,value);
        set('uResolution',[w,h]);set('uResolved',1);set('uLayerOpacity',.88);set('uEffectScale',.85);set('uAnchor',[.5,.5]);set('uWavePhase',time);set('uWaveCount',3);set('uLow',level);set('uMid',level*.82);set('uHigh',level*.58);set('uBrightnessLow',level);set('uAudioBrightnessResponse',1);set('uWaveBrightness',.7);set('uChromatic',1);
        themePalette('prism').colors.forEach((color,i)=>{set(`uWaveColor${i}`,color);set(`uWaveHighlightColor${i}`,color.map(value=>.76+.24*value));});
        const effect=power.update(selection,delta,reduced.matches);set('uEmpowermentColor',effect.color);set('uEmpowerment',effect.amount);set('uEmpowermentTime',effect.age);
        gl.drawArrays(gl.TRIANGLES,0,3);
      }
      if(!reduced.matches)frame=requestAnimationFrame(draw);
    }
    const schedule=()=>{if(!frame&&!document.hidden)frame=requestAnimationFrame(draw);};wake.current=schedule;
    document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);schedule();
    return()=>{wake.current=null;document.removeEventListener('visibilitychange',schedule);reduced.removeEventListener('change',schedule);cancelAnimationFrame(frame);pixels?.dispose();if(gl){gl.deleteProgram(program);gl.deleteVertexArray(vao);queueMicrotask(()=>{if(!node.isConnected)gl.getExtension('WEBGL_lose_context')?.loseContext();});}};
  },[style,active]);
  return <canvas ref={canvas} className="empowerment-preview-canvas" data-style={style} aria-hidden="true"/>;
}
export function EmpowermentPreview({color}:{color:string}) {
  useLocale();const [style,setStyle]=useState<'pixel'|'liquid'>('pixel'),[replay,setReplay]=useState(0);
  return <section className="empowerment-preview" aria-label={t('Empowerments.preview')}>
    <div className="empowerment-preview-toolbar"><span>{t('Empowerments.preview')}</span><div className="tabs" role="group" aria-label={t('Empowerments.preview')}><button type="button" aria-pressed={style==='pixel'} className={style==='pixel'?'selected':''} onClick={()=>setStyle('pixel')}>{t('Empowerments.pixel')}</button><button type="button" aria-pressed={style==='liquid'} className={style==='liquid'?'selected':''} onClick={()=>setStyle('liquid')}>{t('Empowerments.liquid')}</button></div></div>
    <div className="empowerment-preview-stage"><EffectCanvas key={style+replay} color={color} style={style}/><button type="button" className="icon-button empowerment-replay" aria-label={t('Empowerments.replay')} onClick={()=>setReplay(value=>value+1)}>↻</button></div>
  </section>;
}
