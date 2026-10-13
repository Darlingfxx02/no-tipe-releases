import { t, useLocale } from './i18n';
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Native scrollbars can reserve layout width on macOS and Windows. Keep native
// wheel/keyboard scrolling, but draw its draggable indicator in an overlay.
export function ScrollArea({children,className='',indicator=true,hidden=false,fadeTop=false}:{children:ReactNode;className?:string;indicator?:boolean;hidden?:boolean;fadeTop?:boolean}){
  useLocale();
  const viewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
  const id=useId();
  const [metrics,setMetrics]=useState({offset:0,maximum:0,thumb:0,travel:0});
  const drag=useRef<{y:number;offset:number}|null>(null);
  useEffect(()=>{
    const node=viewport.current!;
    let frame=0;
    const measure=()=>{
      frame=0;
      const maximum=Math.max(0,node.scrollHeight-node.clientHeight);
      const track=Math.max(0,node.clientHeight-16);
      const thumb=Math.min(track,Math.max(32,track*node.clientHeight/Math.max(1,node.scrollHeight)));
      setMetrics({offset:node.scrollTop,maximum,thumb,travel:track-thumb});
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(node);observer.observe(content.current!);
    node.addEventListener('scroll',schedule,{passive:true});measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();node.removeEventListener('scroll',schedule);};
  },[]);
  return <div className="scroll-area" hidden={hidden} inert={hidden} aria-hidden={hidden || undefined}>
    <div ref={viewport} id={id} className={`scroll-area-viewport ${className}`}><div ref={content} className="scroll-area-content">{children}</div></div>
    {fadeTop&&<div className="scroll-area-top-fade" aria-hidden="true" style={{'--scroll-fade-opacity':Math.min(1,metrics.offset/24)} as CSSProperties}>
      {Array.from({length:4},(_,index)=><span key={index}/>)}
    </div>}
    {indicator&&metrics.maximum>1&&<div className="scroll-area-track">
      <div className="scroll-area-thumb" role="scrollbar" aria-label={t('ScrollArea.scroll_page')} aria-controls={id} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(metrics.maximum)} aria-valuenow={Math.round(metrics.offset)} tabIndex={0}
        style={{height:metrics.thumb,transform:`translateY(${metrics.maximum?metrics.offset/metrics.maximum*metrics.travel:0}px)`} as CSSProperties}
        onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={y:event.clientY,offset:viewport.current!.scrollTop};}}
        onPointerMove={event=>{if(drag.current&&metrics.travel>0)viewport.current!.scrollTop=drag.current.offset+(event.clientY-drag.current.y)*metrics.maximum/metrics.travel;}}
        onPointerUp={event=>{drag.current=null;event.currentTarget.releasePointerCapture(event.pointerId);}}
        onLostPointerCapture={()=>{drag.current=null;}}
        onKeyDown={event=>{
          const node=viewport.current!;
          const targets:Record<string,number>={ArrowDown:node.scrollTop+40,ArrowUp:node.scrollTop-40,PageDown:node.scrollTop+node.clientHeight*.9,PageUp:node.scrollTop-node.clientHeight*.9,Home:0,End:metrics.maximum};
          if(event.key in targets){event.preventDefault();node.scrollTop=targets[event.key];}
        }}/>
    </div>}
  </div>;
}
