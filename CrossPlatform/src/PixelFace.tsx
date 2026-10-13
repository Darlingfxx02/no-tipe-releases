import { useEffect,useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { native } from './api';
import { themePalette } from './theme';
import type { Snapshot } from './types';
import { PixelRecorder,type PixelPointer } from './recorder/pixels.js';
import { pixelVoiceDrive } from './recorder/motion.js';
export function PixelFace({snapshot,demo=false}:{snapshot:Snapshot;demo?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),current=useRef(snapshot),wake=useRef<(()=>void)|null>(null);current.current=snapshot;
  useEffect(()=>{wake.current?.();},[snapshot]);
  useEffect(()=>{
    const node=canvas.current!,renderer=new PixelRecorder(node),reduced=matchMedia('(prefers-reduced-motion:reduce)');
    let frame=0,last=0,time=1,lastAudio=0,disposed=false,stopAudio:(()=>void)|undefined,stopPointer:(()=>void)|undefined;let audio={level:0,peak:0};
    const draw=(now:number)=>{
      frame=0;if(disposed||document.hidden)return;
      const dt=last?Math.min((now-last)/1000,.05):1/60;last=now;if(!reduced.matches)time+=dt;
      const s=current.current,recording=s.state==='recording'&&!s.paused;
      const input=recording?(demo?Math.max(0,Math.sin(time*3)*.35+Math.sin(time*9)*.18+.3):now-lastAudio<220?audio.level:0):0;
      const level=pixelVoiceDrive(input,demo?input:recording&&now-lastAudio<220?audio.peak:0);
      const palette=themePalette(s.palette),tint=s.chromatic?[1,1,1]:palette.accent.slice(1).match(/../g)!.map(hex=>parseInt(hex,16)/255);
      renderer.draw({state:s.state,paused:s.paused,emotion:s.pixelEmotion,processing:s.pixelProcessing,time,level,reducedMotion:reduced.matches,tint,brightness:s.waveBrightness,pitch:32/21},dt);
      if(!reduced.matches)frame=requestAnimationFrame(draw);
    };
    const schedule=()=>{if(!frame&&!disposed&&!document.hidden)frame=requestAnimationFrame(draw);};wake.current=schedule;
    renderer.attachPetting(node.parentElement!,schedule,{nativePointer:native&&!demo});
    if(native&&!demo)void listen<typeof audio>('cloud-audio',event=>{audio=event.payload;lastAudio=performance.now();schedule();}).then(stop=>{if(disposed)stop();else stopAudio=stop;});
    if(native&&!demo)void listen<PixelPointer>('cloud-pointer',event=>renderer.petPointer(event.payload)).then(stop=>{if(disposed)stop();else stopPointer=stop;});
    const observer=new ResizeObserver(schedule);observer.observe(node);document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);node.addEventListener('webglcontextrestored',schedule);schedule();
    return()=>{disposed=true;wake.current=null;cancelAnimationFrame(frame);stopAudio?.();stopPointer?.();observer.disconnect();document.removeEventListener('visibilitychange',schedule);reduced.removeEventListener('change',schedule);node.removeEventListener('webglcontextrestored',schedule);renderer.dispose();};
  },[demo]);
  return <canvas ref={canvas} className="notch-pixel-face" data-hidden={snapshot.state==='recording'&&!snapshot.showDictationWaves} aria-hidden="true"/>;
}
