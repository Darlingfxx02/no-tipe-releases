import { t, useLocale } from './i18n';
import { useLayoutEffect, useRef } from 'react';
import './live-transcript.css';

// Show the newest lines without a scrollable control. Height and tail position
// follow the same viewport while the surrounding recorder changes size.
export function LiveTranscript({text,maxLines=3,className='',onHeight}:{text:string;maxLines?:number;className?:string;onHeight?:(height:number)=>void}){
  useLocale();
  const frame=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
  const heightChanged=useRef(onHeight);heightChanged.current=onHeight;
  useLayoutEffect(()=>{
    const node=frame.current!,body=content.current!,viewport=node.querySelector<HTMLElement>('.live-transcript-viewport')!;
    const reduced=matchMedia('(prefers-reduced-motion:reduce)');
    let animation=0,last=0,offset=0,first=true;
    const measure=()=>{
      const lineHeight=parseFloat(getComputedStyle(body).lineHeight);
      const height=Math.min(body.scrollHeight,lineHeight*maxLines);
      node.style.setProperty('--transcript-height',`${height}px`);
      heightChanged.current?.(height);
      if(!animation)animation=requestAnimationFrame(draw);
    };
    const draw=(now:number)=>{
      const delta=last?Math.min(.05,(now-last)/1000):0;last=now;
      const limit=parseFloat(getComputedStyle(body).lineHeight)*maxLines;
      const target=body.scrollHeight>limit+1?Math.max(0,body.scrollHeight-viewport.clientHeight):0;
      if(first||reduced.matches){offset=target;first=false;}
      else offset+=(target-offset)*(1-Math.exp(-delta/.055));
      if(Math.abs(target-offset)<.1)offset=target;
      body.style.transform=`translateY(${-offset}px)`;
      node.dataset.overflow=String(target>1);
      node.querySelector('.live-transcript-overflow')?.setAttribute('aria-hidden',String(target<=1));
      // ResizeObserver wakes us as the height transition reveals each line.
      animation=Math.abs(target-offset)>.1?requestAnimationFrame(draw):0;
    };
    const observer=new ResizeObserver(measure);observer.observe(body);observer.observe(viewport);measure();
    return()=>{observer.disconnect();cancelAnimationFrame(animation);};
  },[maxLines]);
  return <div ref={frame} className={`live-transcript ${className}`}>
    <span className="live-transcript-overflow" role="img" aria-label={t('LiveTranscript.previous_text_is_hidden_above')} aria-hidden="true"><i/><i/><i/></span>
    <div className="live-transcript-viewport"><div ref={content} className="live-transcript-content">{text}</div></div>
  </div>;
}
