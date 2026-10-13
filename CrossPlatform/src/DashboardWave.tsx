import { themePalette } from './theme';
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { native } from './api';
import type { CSSProperties } from 'react';
import type { Snapshot } from './types';
import cloud from './generated/cloudWave.json';

// Map the *same* spectral pass onto the panel edges. Only coordinates
// change; wave shape, audio response, soft clipping and themes stay shared.
const edgeFragment=cloud.fragment.replace('out vec4 outColor;',`uniform vec2 uCanvasResolution;
uniform float uEdge;
out vec4 outColor;`).replace(
  'vec2 gid = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);',
  `vec2 pixel = vec2(gl_FragCoord.x, uCanvasResolution.y - gl_FragCoord.y);
  float depth = uResolution.y * 0.5;
  vec2 gid = uEdge < 0.5 ? vec2(pixel.y, depth + pixel.x)
    : uEdge < 1.5 ? vec2(pixel.x, depth + pixel.y)
    : uEdge < 2.5 ? vec2(pixel.y, depth + uCanvasResolution.x - pixel.x)
    : vec2(pixel.x, depth + uCanvasResolution.y - pixel.y);`,
);
type AudioLevel={level:number;peak:number};
export function DashboardWave({snapshot,visible=true,edgeReach,bottomEdge=false}:{snapshot:Snapshot;visible?:boolean;edgeReach?:number;bottomEdge?:boolean}){return <SpectralWave snapshot={snapshot} surface="edges" visible={visible} edgeReach={edgeReach} bottomEdge={bottomEdge}/>;}
export function RecorderWave({snapshot,demo=false}:{snapshot:Snapshot;demo?:boolean}){return <SpectralWave snapshot={snapshot} surface="inline" demo={demo}/>;}
function SpectralWave({snapshot,surface,demo=false,visible=true,edgeReach,bottomEdge=false}:{snapshot:Snapshot;surface:'edges'|'inline';demo?:boolean;visible?:boolean;edgeReach?:number;bottomEdge?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),current=useRef(snapshot);
  const showing=useRef(visible);showing.current=visible;
  const requestDraw=useRef<(()=>void)|null>(null);
  current.current=snapshot;
  useEffect(()=>{requestDraw.current?.();},[snapshot,visible]);
  useEffect(()=>{
    const node=canvas.current!;
    const gl=node.getContext('webgl2',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:true});
    if(!gl){node.dataset.fallback='true';return;}
    let disposed=false,frame=0,last=0,phase=0,level=0,lastAudio=0;
    let audio:AudioLevel={level:0,peak:0},stopAudio:(()=>void)|undefined;
    let program:WebGLProgram|null=null,vao:WebGLVertexArrayObject|null=null;
    const uniforms=new Map<string,WebGLUniformLocation|null>();
    const reduced=matchMedia('(prefers-reduced-motion:reduce)');
    const uniform=(name:string,value:number|number[])=>{
      if(!uniforms.has(name))uniforms.set(name,gl.getUniformLocation(program!,name));
      const at=uniforms.get(name)!;
      if(typeof value==='number')gl.uniform1f(at,value);
      else if(value.length===2)gl.uniform2fv(at,value);
      else if(value.length===3)gl.uniform3fv(at,value);
      else gl.uniform4fv(at,value);
    };
    const compile=(type:number,source:string)=>{
      const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error||'Wave shader compilation failed');}
      return shader;
    };
    const initialize=()=>{
      const vertex=compile(gl.VERTEX_SHADER,cloud.vertex),fragment=compile(gl.FRAGMENT_SHADER,surface==='edges'?edgeFragment:cloud.fragment);
      program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Wave link failed');
      vao=gl.createVertexArray();uniforms.clear();node.dataset.fallback='false';
    };
    const draw=(now:number)=>{
      frame=0;if(disposed||document.hidden||gl.isContextLost()||!program)return;
      const delta=last?Math.min((now-last)/1000,.05):0;last=now;
      // Visibility is a switch. Preserve the field while Insights is open,
      // so returning resumes the same wave without an entrance animation.
      if(surface==='edges'&&!showing.current){last=0;return;}
      const s=current.current,recording=s.state==='recording'&&!s.paused;
      const input=recording?(demo?Math.max(0,Math.sin(now*.003)*.45+Math.sin(now*.009)*.2+.25):now-lastAudio<220?Math.max(audio.level,audio.peak*.72):0):0;
      const drive=Math.pow(Math.max(0,(Math.min(1,input)-.035)/.965),.68);
      level+=(drive-level)*(1-Math.exp(-delta/(drive>level?.025:.12)));
      if(!reduced.matches)phase+=delta*(.7+level*.85);
      const width=node.clientWidth,height=node.clientHeight,dpr=Math.min(devicePixelRatio||1,1.5);
      const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));
      if(node.width!==w||node.height!==h){node.width=w;node.height=h;}
      gl.viewport(0,0,w,h);gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);gl.bindVertexArray(vao);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      for(const [name,value] of Object.entries(cloud.defaults))if(name.startsWith('u'))uniform(name,value);
      uniform('uCanvasResolution',[w,h]);uniform('uTime',phase);uniform('uWavePhase',phase);
      uniform('uResolved',1);uniform('uLayerOpacity',.78);uniform('uEffectScale',1);
      uniform('uAnchor',[.5,.5]);uniform('uMouse',[0,0,0,0]);uniform('uWaveCount',3);
      uniform('uLow',level);uniform('uMid',level*.82);uniform('uHigh',level*.58);
      const palette=themePalette(s.palette);
      uniform('uBrightnessLow',level);uniform('uAudioBrightnessResponse',1);uniform('uChromatic',s.chromatic&&!palette.neutral?1:0);
      uniform('uWaveBrightness',s.waveBrightness??.35);
      if(surface==='inline'&&s.showDictationWaves===false)uniform('uLayerOpacity',0);
      palette.colors.forEach((color,i)=>{uniform(`uWaveColor${i}`,color);uniform(`uWaveHighlightColor${i}`,palette.highlights?.[i]||color.map(v=>.76+.24*v));});
      // Full waves are centred on the boundary, with half their width clipped
      // by the panel, exactly as in the Figma reference.
      const reach=(edgeReach??Math.min(156,Math.max(95,width*.138)))*dpr;
      if(surface==='inline'){
        uniform('uResolution',[w,h]);uniform('uLayerOpacity',s.showDictationWaves===false?0:.88);
        gl.drawArrays(gl.TRIANGLES,0,3);
      }else{
      gl.enable(gl.SCISSOR_TEST);
      for(let edge=0;edge<(bottomEdge?4:3);edge++){
        uniform('uEdge',edge);uniform('uResolution',[edge===1||edge===3?w:h,reach*2]);
        if(edge===0)gl.scissor(0,0,Math.ceil(reach),h);
        else if(edge===1)gl.scissor(0,Math.max(0,h-Math.ceil(reach)),w,Math.ceil(reach));
        else if(edge===2)gl.scissor(Math.max(0,w-Math.ceil(reach)),0,Math.ceil(reach),h);
        else gl.scissor(0,0,w,Math.ceil(reach));
        gl.drawArrays(gl.TRIANGLES,0,3);
      }
      gl.disable(gl.SCISSOR_TEST);
      }
      if(!reduced.matches)frame=requestAnimationFrame(draw);
    };
    const schedule=()=>{if(!frame&&!document.hidden&&!disposed&&(surface==='inline'||showing.current))frame=requestAnimationFrame(draw);};
    requestDraw.current=schedule;
    const lost=(event:Event)=>{event.preventDefault();cancelAnimationFrame(frame);frame=0;node.dataset.fallback='true';};
    const restored=()=>{try{initialize();schedule();}catch{node.dataset.fallback='true';}};
    try{initialize();schedule();}catch(error){console.error(error);node.dataset.fallback='true';}
    if(native)void listen<AudioLevel>('cloud-audio',event=>{audio=event.payload;lastAudio=performance.now();schedule();}).then(stop=>{if(disposed)stop();else stopAudio=stop;});
    const observer=new ResizeObserver(schedule);observer.observe(node);
    document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);
    node.addEventListener('webglcontextlost',lost);node.addEventListener('webglcontextrestored',restored);
    return()=>{disposed=true;requestDraw.current=null;cancelAnimationFrame(frame);stopAudio?.();observer.disconnect();document.removeEventListener('visibilitychange',schedule);reduced.removeEventListener('change',schedule);node.removeEventListener('webglcontextlost',lost);node.removeEventListener('webglcontextrestored',restored);gl.deleteProgram(program);gl.deleteVertexArray(vao);queueMicrotask(()=>{if(!node.isConnected)gl.getExtension('WEBGL_lose_context')?.loseContext();});};
  },[surface,demo,edgeReach,bottomEdge]);
  return <canvas ref={canvas} className={surface==='edges'?'dashboard-wave':'notch-wave'} data-visible={visible} data-wave-visible={surface==='edges'||snapshot.showDictationWaves!==false} style={{'--wave-brightness':snapshot.waveBrightness??.35} as CSSProperties} aria-hidden="true"/>;
}
