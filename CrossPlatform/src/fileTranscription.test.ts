import {expect,test} from 'vitest';
import {processingReady,acceptProgress,initialFileSettings,modelReady,processingForFile,supportedLanguage,textConfiguration} from './fileTranscription';
import type {Bootstrap,FileProcessing,FileProgress,Mode,Model,Preferences} from './types';
const p = {transcriptionModel:'base',language:'auto',processingProvider:'openai',processingModel:'saved',processingEndpoint:'https://api.openai.com/v1'} as Preferences;
const config = {name:'Rules',provider:'openai',model:'saved',endpoint:p.processingEndpoint,prompt:'Use headings',enhance:false,shorten:false,translation:'off'} as FileProcessing;
test('file settings resolve model aliases and inherit only enabled formatting modes',() => {
  const mode = {id:'notes',enabled:true,model:'base',language:'en',enhance:true,name:'Notes',translation:'off'} as Mode;
  const data = {preferences:{...p,activeMode:'notes'},models:[{id:'whisper-base',model:'base'}],modes:[mode]} as Bootstrap;
  expect(initialFileSettings(data)).toMatchObject({model:'whisper-base',language:'en',format:'mode:notes'});
  mode.enabled=false;
  expect(initialFileSettings(data)).toMatchObject({language:'auto',format:'original'});
});
test('rules run without enabling wording edits; original output can still be translated',() => {
  expect(processingForFile('custom',config)).toMatchObject({prompt:'Use headings',enhance:false});
  expect(processingForFile('original',config)).toBeNull();
  expect(processingForFile('original',{...config,translation:'russian'})).toMatchObject({prompt:'',enhance:false,translation:'russian'});
});
test('saved text service and legacy configurations resolve to the correct endpoint',() => {
  expect(textConfiguration(p,{processingProvider:'ollama',processingModel:'local'} as Mode)).toMatchObject({provider:'ollama',model:'local',endpoint:'http://127.0.0.1:11434/v1'});
  expect(textConfiguration(p,{processingProvider:'default',processingModel:'ignored',legacy:{selectedAIProvider:'Anthropic'}} as Mode)).toMatchObject({provider:'openai',model:'saved',endpoint:p.processingEndpoint});
});
test('an explicit mode model stays empty until selected and ignores old provider metadata',()=>{
  const mode={processingProvider:'openrouter',processingModel:'',processingEndpoint:'',legacy:{selectedAIProvider:'Ollama',selectedAIModel:'old-model'}} as Mode;
  expect(textConfiguration(p,mode)).toMatchObject({provider:'openrouter',model:'',endpoint:''});
  expect(textConfiguration(p,{...mode,processingModel:'new-model',processingEndpoint:undefined})).toMatchObject({provider:'openrouter',model:'new-model',endpoint:'https://openrouter.ai/api/v1'});
  expect(textConfiguration(p,{...mode,processingProvider:'default'})).toMatchObject({provider:'openai',model:'saved',endpoint:p.processingEndpoint});
});
test('unavailable speech models and unsupported languages cannot be selected',() => {
  expect(modelReady({local:true,installed:false} as Model)).toBe(false);
  expect(modelReady({local:false,hasKey:true} as Model)).toBe(true);
  expect(supportedLanguage({languages:'Russian'} as Model,'en')).toBe(false);
  expect(supportedLanguage({languages:'Russian'} as Model,'auto')).toBe(true);
  expect(supportedLanguage({languages:'English'} as Model,'ru')).toBe(false);
  expect(supportedLanguage({languages:'English'} as Model,'en')).toBe(true);
  expect(supportedLanguage({languages:'English'} as Model,'auto')).toBe(true);
});
test('progress is scoped to a request, never regresses and ignores late events after completion',() => {
  const current = {requestId:'a',stage:'transcribing',completedSeconds:24,text:'First segment'} as FileProgress;
  expect(acceptProgress(current,{...current,requestId:'b'},'a')).toBe(current);
  expect(acceptProgress(current,{...current,completedSeconds:22},'a')?.completedSeconds).toBe(24);
  const done = {...current,stage:'completed'};
  expect(acceptProgress(done,{...current,text:'Late callback'},'a')).toBe(done);
  expect(acceptProgress(null,current,null)).toBeNull();
});
test('translation stays independent of processing level and cleanup never applies advanced rules', async () => {
  const {processingForLevel}=await import('./fileTranscription');
  expect(processingForLevel('none',config)).toBeNull();
  expect(processingForLevel('none',{...config,translation:'de',shorten:true})).toMatchObject({translation:'de',prompt:'',shorten:false,enhance:false});
  expect(processingForLevel('light',{...config,translation:'russian',shorten:true})).toMatchObject({translation:'russian',shorten:false,enhance:false});
  expect(processingForLevel('light',config)?.prompt).not.toContain('Use headings');
  expect(processingForLevel('full',{...config,translation:'russian'})).toMatchObject({prompt:'Use headings',translation:'russian'});
});

test('stored file settings validate independently of the dictation preferences',async()=>{
  const {parseFileSettings}=await import('./fileTranscription');
  const settings={model:'whisper-base',language:'en',level:'full',live:true,format:'custom',processing:config};
  expect(parseFileSettings(JSON.stringify(settings))).toEqual(settings);
  expect(parseFileSettings(JSON.stringify({...settings,level:'invalid'}))).toBeNull();
  expect(parseFileSettings(JSON.stringify({...settings,processing:{prompt:'incomplete'}}))).toBeNull();
  expect(parseFileSettings(JSON.stringify({...settings,processing:{...config,translation:'fr'}}))?.processing.translation).toBe('fr');
  expect(parseFileSettings(JSON.stringify({...settings,processing:{...config,translation:'unknown'}}))).toBeNull();
  expect(parseFileSettings('invalid')).toBeNull();
});


test('built-in text processing needs an installed model without an endpoint',()=>{
  const config={...textConfiguration(p),provider:'local',model:'qwen3.5-9b',endpoint:''};
  expect(processingReady(config,true)).toBe(true);
  expect(processingReady(config,false)).toBe(false);
  expect(processingReady({...config,model:''},true)).toBe(false);
  expect(processingReady({...config,provider:'openai'},true)).toBe(false);
  expect(textConfiguration({...p,processingProvider:'local',processingModel:'qwen3.5-9b',processingEndpoint:''})).toMatchObject({provider:'local',endpoint:''});
});
