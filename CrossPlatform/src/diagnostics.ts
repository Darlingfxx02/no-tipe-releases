export interface DiagnosticEntry {
  id: number; timestamp: string; level: 'debug' | 'info' | 'warn' | 'error';
  source: string; message: string; details: Record<string, unknown> | null; session: string;
}
export interface DiagnosticSnapshot {
  enabled: boolean; entries: DiagnosticEntry[]; storageError: string | null; maxEntries: number;
}
declare global {
  interface Window {
    __noTypeDiagnostics?: {
      report: (level: string, message: string, details?: Record<string, unknown>) => void;
      setEnabled: (enabled: boolean) => void;
    };
  }
}
export function recordDiagnostic(level: string, message: string, details?: Record<string, unknown>) {
  window.__noTypeDiagnostics?.report(level, message, details);
}
export function configureDiagnostics(enabled: boolean) {
  window.__noTypeDiagnostics?.setEnabled(enabled);
}
export function filterDiagnostics(entries: DiagnosticEntry[], level: string, query: string) {
  const search = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (level === 'all' || entry.level === level) && (!search ||
    `${entry.timestamp} ${entry.level} ${entry.source} ${entry.message} ${JSON.stringify(entry.details)}`.toLocaleLowerCase().includes(search)));
}
