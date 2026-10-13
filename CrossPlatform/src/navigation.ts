import type {MessageKey} from './i18n';
import type {Page, Preferences} from './types';

export const sidebarRoutes = [
  ['Dashboard','dashboard'], ['Insights','insights'], ['Modes','modes'],
  ['Transcribe','transcribe'], ['Dictionary','dictionary'], ['Customization','customization'],
] as const;
export type SidebarPage = typeof sidebarRoutes[number][0];
export const pageLabels: Record<Page,MessageKey> = {Dashboard:'App.dashboard',Insights:'common.insights',Modes:'common.modes',Transcribe:'common.transcribe',Dictionary:'common.dictionary','AI Models':'App.models',Customization:'App.customization',Settings:'common.settings','Transcription settings':'Transcribe.transcription_settings'};

// Append new pages and ignore stale entries when restoring older preferences.
export function orderedSidebar(preferences: Pick<Preferences,'sidebarOrder'>) {
  const order = [...new Set([...(preferences.sidebarOrder ?? []), ...sidebarRoutes.map(([page])=>page)])];
  return order.flatMap(page=>sidebarRoutes.filter(([name])=>name===page));
}
