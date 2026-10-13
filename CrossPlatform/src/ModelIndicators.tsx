import { t, useLocale } from './i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelComparison,ModelMetric } from './modelComparison';
import { useViewActive } from './RetainedView';

function Metric({ name, kind, fill, label, value, detail,compact=false }: { name: string; kind: 'accuracy' | 'speed' | 'quality'; fill: number; label: string; value: string; detail: string;compact?:boolean }) {
  useLocale();
  const active = useViewActive();
  const id = useId(), [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const close = () => { clearTimeout(closeTimer.current); setOpen(false); setPosition(null); };
  const leave = () => { if(document.activeElement===trigger.current)return;clearTimeout(closeTimer.current);closeTimer.current = setTimeout(close, 150); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => { if (!active) { clearTimeout(closeTimer.current); setOpen(false); setPosition(null); } }, [active]);
  useLayoutEffect(() => {
    if (!open || !active) return;
    const place = () => {
      if (!trigger.current || !tooltip.current) return;
      const anchor = trigger.current.getBoundingClientRect(), hint = tooltip.current.getBoundingClientRect();
      if(anchor.bottom<0||anchor.top>window.innerHeight){close();return;}
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - hint.width - 12));
      const below = anchor.bottom + 8;
      setPosition({ left, top: below + hint.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - hint.height - 8) });
    };
    const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!tooltip.current?.contains(event.target as Node))close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape,true);
    window.addEventListener('blur',close);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',close); };
  }, [open, active]);
  const title = kind === 'speed' ? t('ModelIndicators.speed') : kind === 'quality' ? t('ModelIndicators.quality') : t('ModelIndicators.accuracy');
  return <>
    <button ref={trigger} type="button" className={`model-metric${compact?' model-metric-compact':''}`} aria-label={t('ModelIndicators.for_show_details', { value1: title, value2: name, value3: value })} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={close} onClick={show}
      onKeyDown={event => { if (event.key === 'Escape') { close(); event.stopPropagation(); } }}>
      {compact?<svg className="model-metric-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">{kind==='speed'?<><path d="M4.1 17a9 9 0 1 1 15.8 0M12 4v2M5.7 7.7l1.4 1.4M18.3 7.7l-1.4 1.4M3 14h2M19 14h2M12 14l4-4"/><circle cx="12" cy="14" r="1.5"/></>:<><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".75"/></>}</svg>:<span className="model-metric-label">{title}</span>}
      {!compact&&<span className="model-metric-segments" aria-hidden="true">{Array.from({ length: 5 }, (_, index) =>
        <span className="model-metric-segment" key={index}><span style={{ width: `${Math.max(0, Math.min(1, fill * 5 - index)) * 100}%` }}/></span>
      )}</span>}
      <span className="model-metric-value">{compact?(fill===0?'—':value.replace(/\/10$/,'')):value}</span>
    </button>
    {open && active && createPortal(<div ref={tooltip} id={id} role="tooltip" className="model-metric-tooltip" style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }} onMouseEnter={show} onMouseLeave={leave}>
      <strong>{title} · {label}</strong><span>{detail}</span>
    </div>, trigger.current?.closest('dialog')??document.body)}
  </>;
}

const getUnratedMetric = (): ModelMetric => ({fill:0,value:t('ModelIndicators.not_rated'),detail:t('ModelIndicators.no_verified_comparison_profile_is_available_for_this')});
export function ModelIndicators({name,comparison,quality=false,compact=false}:{name:string;comparison:ModelComparison|null;quality?:boolean;compact?:boolean}) {
  useLocale();
  const accuracy=comparison?.accuracy||getUnratedMetric(),speed=comparison?.speed||getUnratedMetric();
  return <span className="model-comparison-indicators">
    {compact&&<Metric name={name} kind="speed" label={speed.value} {...speed} compact/>}
    <Metric name={name} kind={quality||comparison?.qualityTitle==='Quality'?'quality':'accuracy'} label={accuracy.value} {...accuracy} compact={compact}/>
    {!compact&&<Metric name={name} kind="speed" label={speed.value} {...speed}/>}
  </span>;
}
