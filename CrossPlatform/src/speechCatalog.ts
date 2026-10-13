import {t} from './i18n';
import {modelProviderName} from './modelComparison';
import type {Model} from './types';

const featured:Record<string,number>={'parakeet-tdt-0.6b-v3-int8':0,'gigaam-v3-e2e-rnnt-coreml':1,'gigaam-v3-e2e-rnnt-int8':1,'whisper-large-v3-turbo':2,'whisper-large-v3':3,'gigaam-multilingual-ctc-int8':4,'gigaam-multilingual-large-ctc-int8':4};
export const speechModelRank=(model:Model)=>featured[model.id]??100;
export const popularSpeechModel=(model:Model)=>speechModelRank(model)<100;
export const gigaamSpeechModel=(model:Model)=>model.local&&((model.provider==='coreml'&&model.id==='gigaam-v3-e2e-rnnt-coreml')||(model.provider==='sherpa-onnx'&&['gigaam-v3-e2e-rnnt-int8','gigaam-multilingual-ctc-int8','gigaam-multilingual-large-ctc-int8'].includes(model.id)));
export const speechModelSearchAliases=(model:Model)=>gigaamSpeechModel(model)?'GigaAM GigaChat гигаам гигачат Сбер':'';
export function speechModelPublisher(model:Model):string {
  if(model.provider==='whisper')return 'OpenAI';
  if(model.provider==='sherpa-onnx'&&model.id==='parakeet-tdt-0.6b-v3-int8')return 'NVIDIA';
  if(gigaamSpeechModel(model))return t('speechCatalog.sber');
  return model.local?'':modelProviderName(model.provider);
}
