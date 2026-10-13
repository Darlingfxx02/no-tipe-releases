import { useId, type ReactNode } from 'react';
import { EmptyWave } from './EmptyWave';
import { EmptyGlass } from './EmptyGlass';
import './empty-state.css';

type EmptyIcon = 'history' | 'modes' | 'dictionary' | 'snippets' | 'transcribe' | 'insights' | 'audio' | 'models' | 'settings' | 'search';

// One visual language for first use, empty libraries and filtered results.
// The illustration is decorative; the explanation and next step stay visible.
export function Empty({ title, body, icon = 'history', compact = false, detail, children, className = '' }: {
  title: string; body: string; icon?: EmptyIcon; compact?: boolean;
  detail?: ReactNode; children?: ReactNode; className?: string;
}) {
  const heading = useId();
  const asset = `/assets/cloud-nav-${icon}.svg`;
  return <div className={`empty-state${compact ? ' empty-state-compact' : ''} ${className}`} role="group" aria-labelledby={heading} aria-describedby={`${heading}-body`}>
    <div className="empty-state-art" aria-hidden="true">
      <EmptyWave/>
      <span className="empty-state-symbol"><EmptyGlass/>{icon === 'search'
        ? <svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg>
        : <span style={{maskImage:`url('${asset}')`,WebkitMaskImage:`url('${asset}')`}}/>}</span>
    </div>
    <h3 id={heading} className="empty-state-title">{title}</h3>
    <p id={`${heading}-body`} className="empty-state-body">{body}</p>
    {detail && <div className="empty-state-detail">{detail}</div>}
    {children && <div className="empty-state-actions">{children}</div>}
  </div>;
}
