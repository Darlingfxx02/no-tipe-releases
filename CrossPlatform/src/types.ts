export interface Preferences {
  uiLanguage: import('./i18n').UiLanguage; transcriptionModel: string; language: string; audioDevice: string; shortcut: string; shortcutMode: string;
  recorderPlacement: string; alwaysShowCloud: boolean; hideRecorderOnHover: boolean; showTranscript: boolean; hiddenStyle: string; enhance: boolean; shorten: boolean; removeTrailingPeriod: boolean; translation: string;
  palette: string; recorderStyle: 'liquid'|'pixel'; pixelEmotion: string; pixelProcessing: import('./recorder/processing.js').PixelProcessing; chromatic: boolean; lightIntensity: number; waveBrightness: number; recorderScale: number; showDictationWaves: boolean; dashboardEffectOnly: boolean; processingProvider: string; processingModel: string; processingEndpoint: string;
  processingTimeout: number; restoreClipboard: boolean; clipboardRestoreDelay: number; appendSpace: boolean;
  sounds: boolean; pauseMedia: boolean; launchAtLogin: boolean; keepInTray: boolean; developerMode: boolean; activeMode: string | null;
  sidebarOrder: import('./navigation').SidebarPage[]; sidebarHidden: import('./navigation').SidebarPage[];
  usageAnalytics: boolean | null; usageAnalyticsVersion: number; transcriptRetentionDays: number; typingWpm: number; appearance: string;
}
export interface SessionConfiguration {
  version: number;
  speechModel: { id: string; name: string; provider: string; model: string; endpoint: string; local: boolean };
  language: string; audioDevice: string; modeId: string | null; modeName: string | null;
  processing: { removeTrailingPeriod?: boolean; empowerment?: {id:string;instruction:string;name?:string;color?:string} | null; provider: string; model: string; endpoint: string; timeout: number; enhance: boolean; shorten: boolean; translation: string; instructions: string; prompt: string | null };
  delivery: { output: string; command: string; autoSend: string; appendSpace: boolean; restoreClipboard: boolean; clipboardRestoreDelay: number };
  clipboardContext: boolean; selectedTextContext: boolean;
}
export type ProcessingConfiguration = SessionConfiguration['processing'];
export interface Transcript {
  recognitionError?: string | null;
  deliveryError?: string | null;
  processingState?: 'idle' | 'processing' | 'completed' | 'failed' | 'interrupted';
  processingConfig?: ProcessingConfiguration | null;
  manualCorrection?: {previousText: string; correctedAt: number} | null;
  sessionConfig?: SessionConfiguration | null;
  id: string; text: string; enhancedText: string | null; processingError: string | null; timestamp: number;
  duration: number; audioFile: string | null; model: string | null; processingModel: string | null;
  mode: string | null; status: string; transcriptionDuration: number | null; enhancementDuration: number | null;
}
export interface Statistics { wordsCorrected?: number; dictionaryFixes?: number; correctionSamples?: number; dictionarySamples?: number; applications?: {id: string; words: number; sessions: number}[]; words: number; duration: number; savedSeconds: number; sessions: number; speedWords?: number; speedSeconds?: number; speedSamples?: number; daily: {date: string; words: number; seconds: number; sessions: number}[]; models: {name: string; words: number; seconds: number; sessions: number}[] }
export interface Mode { processingProvider?: string | null; processingModel?: string | null; processingEndpoint?: string | null; id: string; name: string; icon: string; enabled: boolean; model: string | null; language: string; prompt: string; enhance: boolean; shorten: boolean; translation: string; output: string; command: string; autoSend: string; shortcut: string; appPatterns: string[]; urlPatterns: string[]; triggerWords: string[]; clipboardContext: boolean; selectedTextContext: boolean; legacy: unknown }
export interface DictionaryEntry { id: string; word: string; replacement: string | null; enabled: boolean }
export interface Model { id: string; name: string; provider: string; model: string; endpoint: string; local: boolean; path: string | null; downloadUrl: string | null; size: number; installed: boolean; hasKey: boolean; languages: string; description: string }
export interface EmpowermentDefinition {id:string;name:string;instruction:string;color:string;builtin:boolean}
export interface Snapshot { previewView?: 'compact'|'expanded'|'settings'; empowerments?: EmpowermentDefinition[]; empowermentColor?: string | null; empowerment?: string | null; uiLanguage?: import('./i18n').UiLanguage; state: string; transcript: string; paused: boolean; showTranscript: boolean; hiddenStyle: string; enhance: boolean; shorten: boolean; translation: string; palette: string; recorderStyle: 'liquid'|'pixel'; pixelEmotion: string; pixelProcessing: import('./recorder/processing.js').PixelProcessing; chromatic: boolean; lightIntensity: number; waveBrightness: number; recorderScale: number; showDictationWaves: boolean; error: string | null }
export interface Device { id: string; name: string; default: boolean }
export interface ModelCatalogStatus {source:string;updatedAt:number|null;error:string|null;count:number}
export interface HubAsset {kind:'speech'|'text';repository:string;revision:string;file:string;size:number;sha256:string;name:string;languages:string;languageCodes?:string[];description:string;license:string;architecture:string;quantization:string}
export interface HubSearchEntry {asset:HubAsset;model:Model}
export interface HubSearch {kind:'speech'|'text';query:string;quantization:string|null;maxBytes:number|null;language:string|null}
export interface HubSearchResult {models:HubSearchEntry[];cached:boolean;warning:string|null}
export interface Bootstrap { appName?: string; releaseChannel?: "stable" | "dev"; systemLocale?: string; onboardingComplete: boolean; preferences: Preferences; recent: Transcript[]; latestTranscriptText?: string | null; stats: Statistics; modes: Mode[]; empowerments?: EmpowermentDefinition[]; dictionary: DictionaryEntry[]; snippets: Snippet[]; models: Model[]; textModels: Model[]; modelCatalog?:ModelCatalogStatus; snapshot: Snapshot; legacyAvailable: boolean; legacyImported: string | null; platform: string; version: string }
export type Page = 'Dashboard' | 'Insights' | 'Modes' | 'Transcribe' | 'Dictionary' | 'AI Models' | 'Customization' | 'Settings' | 'Transcription settings';
export interface FileProcessing {name:string;provider:string;model:string;endpoint:string;prompt:string;enhance:boolean;shorten:boolean;translation:string}
export interface FileOptions {requestId:string;model:string;language:string;live:boolean;processing:FileProcessing|null}
export interface FileProgress {requestId:string;stage:string;text:string;translatedText:string;duration:number;completedSeconds:number;error:string|null}

export interface SnippetStyle { start: number; end: number; bold: boolean; italic: boolean; link: string | null }
export interface Snippet { id: string; trigger: string; expansion: string; enabled: boolean; dateAdded: number; formatting: SnippetStyle[] }

export interface VoiceFinding { text: string; count: number; sessions: number; replacement: string | null }
export interface VoicePeak { weekday: number; hour: number; sessions: number; words: number; application: string | null }
export interface VoiceReport {
  createdAt: number; title: string; description: string; theme: string; method: 'patterns' | 'localModel'; model: string | null;
  sampledWords: number; sampledSessions: number; catchphrase: VoiceFinding | null; mostUsedWord: VoiceFinding | null;
  mostCorrectedWord: VoiceFinding | null; peak: VoicePeak | null;
}
export interface VoiceProfileState {
  profile: VoiceReport | null; totalWords: number; storedWords: number; remainingWords: number; progress: number;
  canGenerate: boolean; canRefine: boolean; building: boolean;
}
