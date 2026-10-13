import { t, useLocale } from './i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import './copy-feedback.css';

export interface CopyAnchor { x: number; y: number }
export interface CopyNotice { anchor: CopyAnchor; id: number }
export type CopyWithFeedback = (event: MouseEvent<HTMLButtonElement>, work: () => Promise<unknown>) => void;

export function copyAnchor(event: MouseEvent<HTMLButtonElement>): CopyAnchor {
  // Keyboard activation has no pointer coordinates. Use the focused button.
  if (event.detail === 0) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top };
  }
  return { x: event.clientX, y: event.clientY };
}

export function CopyFeedback({ notice }: { notice: CopyNotice }) {
  useLocale();
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = element.current!.getBoundingClientRect();
      const margin = 8;
      setPosition({
        left: Math.max(margin, Math.min(window.innerWidth - rect.width - margin, notice.anchor.x - rect.width / 2)),
        top: Math.max(margin, Math.min(window.innerHeight - rect.height - margin, notice.anchor.y - rect.height - 12)),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [notice]);

  return createPortal(<div ref={element} className="copy-feedback" role="status" aria-live="polite" aria-atomic="true"
    style={position ?? { left: 0, top: 0, visibility: 'hidden' }}>
    <span>{t('CopyFeedback.copied')}</span>
  </div>, document.body);
}
