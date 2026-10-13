import { t } from './i18n';
import type {Model} from './types';

// Only providers with an implemented native connection check are offered here.
export const connectableProviders = ['openai','groq','mistral','deepgram','elevenlabs','gemini','soniox','assemblyai','speechmatics','xai','cartesia'] as const;
export const canConnectProvider = (provider:string) => (connectableProviders as readonly string[]).includes(provider);
export const connectedApiModels = (models:Model[]) => models.filter(model=>!model.local&&model.hasKey);
export const providerSpeechModels = (models:Model[],provider:string) => models.filter(model=>!model.local&&model.provider===provider);

export async function connectApiProvider(provider:string,key:string,connect:(provider:string,key:string)=>Promise<unknown>) {
  if(!canConnectProvider(provider))throw new Error(t('apiConnections.choose_a_supported_provider'));
  const trimmed=key.trim();
  if(!trimmed)throw new Error(t('apiConnections.enter_an_api_key'));
  // The native command verifies the chosen provider before storing the key.
  await connect(provider,trimmed);
}
