import { t, cachedLanguage, translateMessage } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import type { Bootstrap, Preferences } from './types';
import { detectPlatform } from './platform';
import { defaultShortcut, defaultShortcutMode } from './shortcuts';
import { recordDiagnostic } from './diagnostics';
export const native = '__TAURI_INTERNALS__' in window;
export const defaults: Preferences = {uiLanguage:'system',transcriptionModel:'whisper-base',language:'auto',audioDevice:'',shortcut:defaultShortcut(detectPlatform(typeof navigator==='undefined'?undefined:navigator)),shortcutMode:defaultShortcutMode(detectPlatform(typeof navigator==='undefined'?undefined:navigator)),recorderPlacement:'island',alwaysShowCloud:true,hideRecorderOnHover:false,showTranscript:false,hiddenStyle:'split',enhance:false,shorten:false,removeTrailingPeriod:false,translation:'off',palette:'prism',recorderStyle:'pixel',pixelEmotion:'auto',pixelProcessing:'auto',chromatic:false,lightIntensity:.28,waveBrightness:.35,recorderScale:1,showDictationWaves:true,dashboardEffectOnly:false,processingProvider:'local',processingModel:'qwen3.5-4b',processingEndpoint:'',processingTimeout:90,restoreClipboard:true,clipboardRestoreDelay:1500,appendSpace:false,sounds:true,pauseMedia:false,launchAtLogin:false,keepInTray:true,developerMode:false,usageAnalytics:null,usageAnalyticsVersion:0,activeMode:null,transcriptRetentionDays:0,typingWpm:40,appearance:'dark',sidebarOrder:[],sidebarHidden:[]};
export const preview: Bootstrap = {onboardingComplete:true,preferences: {...defaults,uiLanguage:cachedLanguage()}, recent: [], stats: {words:0,duration:0,savedSeconds:0,sessions:0,daily:[],models:[]},modes:[],dictionary:[],snippets:[],models:[],textModels:[],snapshot:{...defaults,state:'idle',transcript:'',paused:false,error:null},legacyAvailable:false,legacyImported:null,platform:detectPlatform(typeof navigator==='undefined'?undefined:navigator),version:'0.1.0'};
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!native) {
    if (command === 'bootstrap') return structuredClone(preview) as T;
    if (command === 'save_preferences' && args?.patch && Object.keys(args.patch as object).every(key => ['uiLanguage','developerMode','usageAnalytics'].includes(key))) {
      Object.assign(preview.preferences,args.patch); if(Object.hasOwn(args.patch,'usageAnalytics'))preview.preferences.usageAnalyticsVersion=2; return structuredClone(preview.preferences) as T;
    }
    if (command === 'audio_devices' || command === 'history') return [] as T;
    if (command === 'statistics') return preview.stats as T;
    if (command === 'developer_logs') return {enabled:preview.preferences.developerMode,entries:[],storageError:null,maxEntries:4000} as T;
    throw new Error(t('api.open_the_desktop_application_to_use_this_feature'));
  }
  const started = performance.now();
  try {
    const result = await invoke<T>(command,args);
    if (!command.startsWith('developer_')) recordDiagnostic('debug','command.completed',{command,elapsedMs:Math.round(performance.now()-started)});
    return result;
  } catch (error) {
    recordDiagnostic('error','command.failed',{command,elapsedMs:Math.round(performance.now()-started),error:errorSource(error)});
    throw error;
  }
}
export async function openUrl(url: string) { if (native) await call('open_url',{url}); else window.open(url,'_blank','noopener,noreferrer'); }
export { deliveredText } from './transcriptProcessing';
export function savedTime(seconds:number) { const minutes=Math.floor(seconds/60);return t('api.h_m', { value1: Math.floor(minutes/60), value2: minutes%60 }); }
export function duration(seconds:number) {return `${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;}
// Keep the native message identifier in state; translate it when rendering.
export function errorSource(error:unknown) {return error instanceof Error?error.message:String(error);}
export function errorMessage(error:unknown) {return translateMessage(errorSource(error));}
