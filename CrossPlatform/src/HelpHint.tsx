import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t, useLocale } from './i18n';
import { useViewActive } from './RetainedView';
import './help-hint.css';

// Supplementary explanations belong here; labels and primary descriptions stay visible.
export function HelpHint({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  useLocale();
  const active = useViewActive(), id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(closeTimer.current); setOpen(true); };
  const close = () => { clearTimeout(closeTimer.current); setOpen(false); setPosition(null); };
  const leave = () => {
    if (document.activeElement === trigger.current) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => { if (!active) close(); }, [active]);
  useLayoutEffect(() => {
    if (!open || !active) return;
    const place = () => {
      if (!trigger.current || !tooltip.current) return;
      const anchor = trigger.current.getBoundingClientRect(), hint = tooltip.current.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) { close(); return; }
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - hint.width - 12));
      const below = anchor.bottom + 8;
      const top = below + hint.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - hint.height - 8);
      setPosition({ left, top });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('blur', close);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('blur', close);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, active, children]);
  return <span className="help-hint">
    <button ref={trigger} type="button" className="icon-button help-hint-trigger" aria-label={t('common.help_for', { value1: label })} aria-describedby={open && active ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={close} onClick={()=>{if(onClick){close();onClick();}else show();}}
      onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); event.stopPropagation(); } }}>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M7.8 7.4a2.3 2.3 0 0 1 4.5.7c0 1.5-2.3 1.6-2.3 3.2M10 14.1h.01"/></svg>
    </button>
    {open && active && createPortal(<div ref={tooltip} id={id} role="tooltip" className="help-hint-content"
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }} onMouseEnter={show} onMouseLeave={leave}>
      {children}
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </span>;
}
