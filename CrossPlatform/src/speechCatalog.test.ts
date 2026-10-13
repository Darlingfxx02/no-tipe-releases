import {describe,it,expect} from 'vitest';
import {popularSpeechModel,speechModelPublisher,speechModelRank,speechModelSearchAliases} from './speechCatalog';
import type {Model} from './types';

const model=(id:string,provider:string,local=true)=>({id,provider,local,model:id,name:id} as Model);
describe('popular dictation catalog',()=>{
  it('puts NVIDIA, Sber and the OpenAI flagships ahead of extra Whisper variants',()=>{
    const models=[model('whisper-tiny','whisper'),model('whisper-large-v3','whisper'),model('gigaam-v3-e2e-rnnt-coreml','coreml'),model('parakeet-tdt-0.6b-v3-int8','sherpa-onnx'),model('whisper-large-v3-turbo','whisper')];
    expect(models.sort((a,b)=>speechModelRank(a)-speechModelRank(b)).map(m=>m.id)).toEqual(['parakeet-tdt-0.6b-v3-int8','gigaam-v3-e2e-rnnt-coreml','whisper-large-v3-turbo','whisper-large-v3','whisper-tiny']);
    expect(popularSpeechModel(models[0])).toBe(true);
    expect(popularSpeechModel(models.at(-1)!)).toBe(false);
  });
  it('identifies the publisher even before a model or API key is installed',()=>{
    expect(speechModelPublisher(model('parakeet-tdt-0.6b-v3-int8','sherpa-onnx'))).toBe('NVIDIA');
    expect(speechModelPublisher(model('gigaam-v3-e2e-rnnt-coreml','coreml'))).toBe('Sber');
    expect(speechModelPublisher(model('whisper-large-v3','whisper'))).toBe('OpenAI');
    expect(speechModelPublisher(model('openai:gpt-4o-transcribe','openai',false))).toBe('OpenAI');
  });
  it('keeps the Windows GigaAM variants discoverable before download and after removal',()=>{
    for(const id of ['gigaam-v3-e2e-rnnt-int8','gigaam-multilingual-ctc-int8','gigaam-multilingual-large-ctc-int8']) {
      const item={...model(id,'sherpa-onnx'),installed:false};
      expect(popularSpeechModel(item)).toBe(true);
      expect(speechModelPublisher(item)).toBe('Sber');
      for(const query of ['giga','gigachat','гигачат','гигаам','сбер'])expect(speechModelSearchAliases(item).toLowerCase()).toContain(query);
    }
    expect(speechModelSearchAliases(model('parakeet-tdt-0.6b-v3-int8','sherpa-onnx'))).toBe('');
  });
});
