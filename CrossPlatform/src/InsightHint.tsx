import type { ReactNode } from 'react';
import {HelpHint} from './HelpHint';

export function InsightHint({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return <span className="insight-hint"><HelpHint label={label} onClick={onClick}>{children}</HelpHint></span>;
}
