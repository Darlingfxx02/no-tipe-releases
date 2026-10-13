import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { t, useLocale } from './i18n';

export const previewPhases = [
  { phase: 'idle', label: 'Settings.idle', delay: 3000 },
  { phase: 'expanded', label: 'Settings.preview_expanded', delay: 3500 },
  { phase: 'settings', label: 'common.settings', delay: 4000 },
  { phase: 'recording', label: 'Notch.listening', delay: 6000 },
  { phase: 'paused', label: 'Dashboard.paused', delay: 2500 },
  { phase: 'preparing', label: 'Settings.processing', delay: 5000 },
  { phase: 'result', label: 'common.done', delay: 2500 },
  { phase: 'failed', label: 'Notch.error', delay: 2500 },
] as const;

export const previewPhaseIndex = (position: number) => ((position % previewPhases.length) + previewPhases.length) % previewPhases.length;
const distanceTo = (index: number, position: number) => previewPhaseIndex(index - position + previewPhases.length / 2) - previewPhases.length / 2;

export function PreviewStateWheel({ position, onSelect }: { position: number; onSelect: (position: number) => void }) {
  useLocale();
  const wheel = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = useRef(position);
  const [animatedPosition, setAnimatedPosition] = useState(position);
  const latest = useRef({ position, onSelect });
  latest.current = { position, onSelect };
  const gesture = useRef<{ id: number; y: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const selected = previewPhaseIndex(position);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const settle = () => { cancelAnimationFrame(frame); current.current = position; setAnimatedPosition(position); };
    if (reduced.matches) { settle(); return; }
    const start = performance.now(), from = current.current;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 380);
      current.current = from + (position - from) * (1 - Math.pow(1 - progress, 3));
      setAnimatedPosition(current.current);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    const motionChanged = () => { if (reduced.matches) settle(); };
    reduced.addEventListener('change', motionChanged);
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', motionChanged); };
  }, [position]);

  useEffect(() => {
    const node = wheel.current;
    if (!node) return;
    let accumulated = 0, lastEvent = 0, lastSelection = -Infinity;
    const scroll = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault(); event.stopPropagation();
      const now = performance.now();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
      if (now - lastEvent > 160 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      lastEvent = now;
      if (now - lastSelection < 220) return;
      accumulated += delta;
      if (Math.abs(accumulated) < 18) return;
      latest.current.onSelect(latest.current.position + Math.sign(accumulated));
      accumulated = 0; lastSelection = now;
    };
    node.addEventListener('wheel', scroll, { passive: false });
    return () => node.removeEventListener('wheel', scroll);
  }, []);

  // Keep keyboard focus attached to the selected state when the wheel moves.
  useEffect(() => {
    if (wheel.current?.contains(document.activeElement)) buttons.current[selected]?.focus({ preventScroll: true });
  }, [selected]);

  return <div ref={wheel} className="preview-state-wheel" role="radiogroup" aria-label={t('Settings.preview_recorder_state')}
    onKeyDown={event => {
      let next = position;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next++;
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next--;
      else if (event.key === 'Home') next += distanceTo(0, position);
      else if (event.key === 'End') next += distanceTo(previewPhases.length - 1, position);
      else return;
      event.preventDefault(); onSelect(next);
    }}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, y: event.clientY, dragged: false };
    }}
    onPointerMove={event => {
      const start = gesture.current;
      if (!start || start.id !== event.pointerId || Math.abs(event.clientY - start.y) < 8) return;
      start.dragged = true; suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerUp={event => {
      const start = gesture.current; gesture.current = null;
      if (!start || start.id !== event.pointerId || !start.dragged) return;
      const delta = start.y - event.clientY;
      if (Math.abs(delta) >= 24) onSelect(position + Math.sign(delta) * Math.min(2, Math.max(1, Math.round(Math.abs(delta) / 42))));
    }}
    onPointerCancel={() => { gesture.current = null; }}
    onLostPointerCapture={() => { gesture.current = null; }}
    onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
    {previewPhases.map(({ phase, label }, index) => {
      const offset = distanceTo(index, animatedPosition), distance = Math.abs(offset);
      // Evaluate the curve throughout the animation, so labels follow the arc
      // instead of travelling along straight lines between its endpoints.
      const style = {
        '--state-x': `${48 - 11 * offset * offset}px`,
        '--state-y': `${offset * 42}px`,
        '--state-scale': 1 - Math.min(distance, 3) * .075,
        '--state-opacity': Math.max(0, 1 - distance * .3),
      } as CSSProperties;
      return <button key={phase} ref={button => { buttons.current[index] = button; }} className="text-button" type="button" role="radio"
        aria-checked={selected === index} tabIndex={selected === index ? 0 : -1} data-phase={phase} data-hidden={distance > 2.65} style={style}
        onClick={() => onSelect(position + distanceTo(index, position))}>{t(label)}</button>;
    })}
  </div>;
}
