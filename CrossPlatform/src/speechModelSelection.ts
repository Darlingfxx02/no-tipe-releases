import type { Bootstrap, Model } from './types';
import { modelReady } from './fileTranscription';

export function speechModelSelection(data: Pick<Bootstrap, 'models' | 'modes' | 'preferences'>) {
  const mode = data.modes.find(mode => mode.enabled && mode.id === data.preferences.activeMode);
  const requested = mode?.model || data.preferences.transcriptionModel;
  const configured = data.models.find(model => model.id === requested || model.model === requested);
  const application = data.models.find(model => model.id === data.preferences.transcriptionModel || model.model === data.preferences.transcriptionModel);
  const fallback = !modelReady(configured) && modelReady(application);
  const model = fallback ? application : configured;
  return { mode, model, requested, fallback, ready: modelReady(model) };
}

export async function activateSpeechModel(model: Model, select: (id: string) => Promise<unknown>, refresh: () => Promise<void>) {
  if (!modelReady(model)) return false;
  await select(model.id);
  await refresh();
  return true;
}
