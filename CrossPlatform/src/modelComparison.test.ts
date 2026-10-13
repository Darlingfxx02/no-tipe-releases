import { describe, expect, it } from 'vitest';
import { modelComparison, modelDownloadSize, modelProviderName } from './modelComparison';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ModelIndicators} from './ModelIndicators';

describe('model comparison provenance', () => {
  const tiny = {id:'whisper-tiny', model:'tiny', provider:'whisper', local:true};
  it('keeps local Whisper benchmarks off hosted and custom models', () => {
    expect(modelComparison(tiny)).not.toBeNull();
    expect(modelComparison({...tiny, local:false})).toBeNull();
    expect(modelComparison({...tiny, provider:'custom-tiny'})).toBeNull();
    expect(modelComparison({...tiny, id:'user-model'})).toBeNull();
  });
  it('does not guess a rating for unknown models', () => {
    expect(modelComparison({...tiny, id:'whisper-new', model:'new'})).toBeNull();
    expect(modelComparison({...tiny, id:'whisper-constructor', model:'constructor'})).toBeNull();
  });
  it('identifies GigaAM and restores its own profile instead of an A100 ratio', () => {
    const id = 'gigaam-v3-e2e-rnnt-coreml';
    expect(modelComparison({id, model:id, provider:'coreml', local:true})?.speed?.value).toBe('9.8/10');
    expect(modelComparison({id, model:'gigaam-v3-ctc', provider:'coreml', local:true})).toBeNull();
  });
  it('covers English and quantized files added by the catalog',()=>{
    for(const model of ['tiny.en-q5_1','base-q8_0','small.en','medium.en-q5_0','large-v1','large-v3-turbo-q5_0']) {
      const profile=modelComparison({...tiny,id:`whisper-${model}`,model});
      expect(profile?.accuracy).toBeDefined();
      expect(profile?.speed).toBeDefined();
    }
    expect(modelComparison({...tiny,id:'whisper-base.en-q5_1',model:'base.en-q5_1'})?.accuracy?.value).toBe('7.5/10');
  });
  it('does not infer profiles from arbitrary names or unrecognised variants',()=>{
    for(const model of ['tiny-custom','large-v3.en','tiny-q2_0','constructor'])
      expect(modelComparison({...tiny,id:`whisper-${model}`,model})).toBeNull();
  });
  it('keeps hosted and local speeds separate and does not borrow another model version',()=>{
    const groq={id:'groq:whisper-large-v3-turbo',model:'whisper-large-v3-turbo',provider:'groq',local:false};
    expect(modelComparison(groq)?.speed?.value).toBe('6.5/10');
    expect(modelComparison({...groq,id:'custom-groq'})).toBeNull();
    expect(modelComparison({id:'gemini:gemini-2.5-flash',model:'gemini-2.5-flash',provider:'gemini',local:false})).toBeNull();
  });
  it('labels checkpoint benchmarks without inventing a local runtime speed',()=>{
    const qwen={id:'qwen3.5-9b',model:'qwen3.5-9b',provider:'local',local:true,downloadUrl:'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/pinned/model.gguf'};
    expect(modelComparison(qwen)?.accuracy?.value).toBe('IFEval 91.5');
    expect(modelComparison(qwen)?.accuracy?.detail).toContain('Q4_K_M');
    expect(modelComparison(qwen)?.speed).toBeUndefined();
    expect(modelComparison({...qwen,downloadUrl:'https://example.com/renamed.gguf'})).toBeNull();
  });
  it('keeps an explicit unrated comparison row for unknown assets',()=>{
    const markup=renderToStaticMarkup(createElement(ModelIndicators,{name:'Custom GGUF',comparison:null,quality:true}));
    expect(markup).toContain('Quality');
    expect(markup).toContain('Speed');
    expect(markup).toContain('Not rated');
    expect(markup).not.toContain('width:100%');
  });
  it('shows two accessible icon values in compact cards and preserves benchmark units',()=>{
    const markup=renderToStaticMarkup(createElement(ModelIndicators,{name:'Whisper Tiny',comparison:modelComparison(tiny),compact:true}));
    expect(markup.match(/class="model-metric-icon"/g)).toHaveLength(2);
    expect(markup).not.toContain('model-metric-segments');
    expect(markup).toContain('aria-label="Speed');
    expect(markup).toContain('aria-label="Accuracy');
    expect(markup).toContain('~10×');
    const unknown=renderToStaticMarkup(createElement(ModelIndicators,{name:'Custom',comparison:null,compact:true}));
    expect(unknown.match(/class="model-metric-value">—/g)).toHaveLength(2);
  });
});

describe('model card metadata', () => {
  it('formats catalog sizes and omits absent or invalid sizes', () => {
    expect(modelDownloadSize(77691713)).toBe('78 MB');
    expect(modelDownloadSize(1624555275)).toBe('1.62 GB');
    for (const size of [0,-1,NaN,Infinity]) expect(modelDownloadSize(size)).toBeNull();
  });
  it('keeps internal provider identifiers out of the card', () => {
    expect(modelProviderName('custom-1234-5678')).toBe('Custom');
    expect(modelProviderName('gemini')).toBe('Google');
  });
});
