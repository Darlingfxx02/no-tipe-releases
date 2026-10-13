import { t } from './i18n';
import type { ProcessingConfiguration, Transcript } from './types';

export type ProcessingSource = 'saved' | 'current';
export interface ProcessingProps { processing: ReadonlySet<string>; onProcess: ProcessTranscript; onRecognize: RetryRecognition }
export interface ProcessingOptions { saved: ProcessingConfiguration | null; current: ProcessingConfiguration }
export type ProcessTranscript = (item: Transcript, source: ProcessingSource, configuration?: ProcessingConfiguration) => Promise<Transcript | undefined>;
export type RetryRecognition = (item: Transcript) => Promise<Transcript | undefined>;

export const deliveredText = (item: {text:string;enhancedText:string|null}) => item.enhancedText?.trim() ? item.enhancedText : item.text;
export const processingBusy = (item: Transcript) => item.processingState === 'processing';
export const recognitionBusy = (item: Transcript) => item.status === 'pending';
export const savedProcessing = (item: Transcript) => item.sessionConfig && item.sessionConfig.version !== 1 ? undefined : item.processingConfig ?? item.sessionConfig?.processing;
export function transcriptErrors(item: Transcript) {
  const legacy = item.processingError;
  const legacyDelivery = Boolean(legacy?.startsWith('Text could not be delivered.'));
  const legacyRecognition = item.status === 'failed' && !item.recognitionError && !legacyDelivery;
  return {
    recognition: item.recognitionError || (legacyRecognition ? legacy : null),
    processing: legacyRecognition || legacyDelivery ? null : legacy,
    delivery: item.deliveryError || (legacyDelivery ? legacy : null),
  };
}
export const canRetryProcessing = (item: Transcript) => Boolean(transcriptErrors(item).processing && item.status === 'completed' && item.text.trim());
export const canRetryRecognition = (item: Transcript) => item.status === 'failed' && !deliveredText(item).trim() && Boolean(item.audioFile) && !isNoSpeechTranscript(item);
export const isNoSpeechTranscript = (item: Transcript) => item.status === 'failed' && !deliveredText(item).trim() && ['no speech detected', 'no speech text was returned'].includes(transcriptErrors(item).recognition?.trim().toLowerCase() ?? '');
export function processingSummary(config: ProcessingConfiguration) {
  const changes = [config.enhance && t('common.enhance'), config.shorten && t('common.shorten'), config.removeTrailingPeriod && t('Settings.remove_trailing_period'), config.translation !== 'off' && t('transcriptProcessing.translate_to', { value1: config.translation }), config.empowerment && (config.empowerment.id === 'brief' ? t('Empowerments.brief') : config.empowerment.name || t('Empowerments.title'))].filter(Boolean);
  return `${changes.join(' · ') || t('transcriptProcessing.format')} · ${config.provider} / ${config.model}`;
}
