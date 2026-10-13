import { describe, expect, it, vi, afterEach } from 'vitest';
import { filterDiagnostics, recordDiagnostic, configureDiagnostics, type DiagnosticEntry } from './diagnostics';
const entries: DiagnosticEntry[] = [
  {id:1,timestamp:'2026-10-04T09:00:00Z',level:'info',source:'event',message:'cloud-state',details:{state:'recording'},session:'session-1'},
  {id:2,timestamp:'2026-10-04T09:00:01Z',level:'error',source:'provider',message:'http.response',details:{status:503},session:'session-1'},
];
afterEach(() => vi.unstubAllGlobals());
describe('diagnostic log view', () => {
  it('combines level and case-insensitive search across operational metadata', () => {
    expect(filterDiagnostics(entries,'all',' RECORDING ')).toEqual([entries[0]]);
    expect(filterDiagnostics(entries,'error','503')).toEqual([entries[1]]);
    expect(filterDiagnostics(entries,'info','503')).toEqual([]);
    expect(filterDiagnostics(entries,'all','provider')).toEqual([entries[1]]);
    expect(entries.map(entry => entry.id)).toEqual([1,2]);
  });
  it('handles a missing native logger and delegates to the installed webview bridge', () => {
    vi.stubGlobal('window', {});
    expect(() => recordDiagnostic('info','navigation',{page:'Settings'})).not.toThrow();
    const report = vi.fn(), setEnabled = vi.fn();
    vi.stubGlobal('window', {__noTypeDiagnostics:{report,setEnabled}});
    configureDiagnostics(true);
    recordDiagnostic('error','command.failed',{command:'record'});
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(report).toHaveBeenCalledWith('error','command.failed',{command:'record'});
  });
});
