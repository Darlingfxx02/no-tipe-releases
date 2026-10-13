import { useEffect,useRef } from 'react';
import type { ReactNode } from 'react';
import { PixelRecorder } from './recorder/pixels.js';
export function PixelControlIcon({kind,children}:{kind:string;children:ReactNode}){
  const canvas=useRef<HTMLCanvasElement>(null),source=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const node=canvas.current!,renderer=new PixelRecorder(node);
    const iconSource=source.current!.querySelector('svg')!.outerHTML;
    const draw=()=>renderer.draw({iconSource,reducedMotion:true,pitch:node.clientWidth/8,brightness:.35});
    const observer=new ResizeObserver(draw);observer.observe(node);node.addEventListener('webglcontextrestored',draw);draw();
    return()=>{observer.disconnect();node.removeEventListener('webglcontextrestored',draw);renderer.dispose();};
  },[kind]);
  return <><span ref={source} style={{display:'none'}} aria-hidden="true">{children}</span><canvas ref={canvas} className="pixel-control-icon" data-icon={kind} aria-hidden="true"/></>;
}
