import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ModelInstalledLabel,SpeechModelActivation} from './ModelActions';
import {activateSpeechModel,speechModelSelection} from './speechModelSelection';
import {availableFileModel} from './fileTranscription';
import type {Bootstrap,Mode,Model,Preferences} from './types';

const model=(id:string,installed=true):Model=>({id,name:id==='whisper-tiny'?'Whisper Tiny':'Whisper Base',model:id.replace('whisper-',''),provider:'whisper',local:true,installed,hasKey:true,path:'weights.bin',downloadUrl:null,size:100,languages:'Multilingual',description:'',endpoint:''});
const tiny=model('whisper-tiny'),base=model('whisper-base');
const data=(patch:Partial<Preferences>={},modes:Mode[]=[])=>({models:[tiny,base],modes,preferences:{transcriptionModel:base.id,...patch}} as Bootstrap);

describe('installed speech model activation',()=>{
  it('shows the actual mode override and resolves old model aliases',()=>{
    const mode={id:'notes',enabled:true,model:'tiny'} as Mode;
    expect(speechModelSelection(data({activeMode:'notes'},[mode]))).toMatchObject({model:tiny,ready:true,mode});
    expect(speechModelSelection(data({activeMode:'notes'},[{...mode,enabled:false}])).model).toBe(base);
    expect(speechModelSelection(data({transcriptionModel:'tiny'})).model).toBe(tiny);
    expect(speechModelSelection(data({activeMode:'notes'},[{...mode,model:'macos-only'}]))).toMatchObject({model:base,ready:true,fallback:true,requested:'macos-only'});
  });
  it('keeps the Use action on alternatives and distinguishes installed and current icons accessibly',()=>{
    const html=renderToStaticMarkup(<SpeechModelActivation model={tiny} current={false} onSelect={()=>{}}/>);
    expect(html).toContain('Use Whisper Tiny for dictation');expect(html).toContain('>Use</button>');
    const current=renderToStaticMarkup(<SpeechModelActivation model={base} current onSelect={()=>{}}/>);
    expect(current).toContain('role="status"');expect(current).toContain('aria-label="Current"');expect(current).not.toContain('<button');
    expect(current).not.toContain('>Current<');expect(current.match(/<path /g)).toHaveLength(2);
    const installed=renderToStaticMarkup(<ModelInstalledLabel/>);
    expect(installed).toContain('aria-label="Installed"');expect(installed).not.toContain('>Installed<');expect(installed.match(/<path /g)).toHaveLength(1);
  });
  it('commits activation through the native command before refreshing; failed choices never look successful',async()=>{
    const events:string[]=[];
    const select=vi.fn(async(id:string)=>{events.push(id);});
    const refresh=vi.fn(async()=>{events.push('refresh');});
    expect(await activateSpeechModel(tiny,select,refresh)).toBe(true);
    expect(events).toEqual(['whisper-tiny','refresh']);
    await expect(activateSpeechModel(base,async()=>{throw new Error('Cannot save');},refresh)).rejects.toThrow('Cannot save');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await activateSpeechModel(model('whisper-small',false),select,refresh)).toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });
  it('picks the first installed model after download, preserving a ready explicit file selection',()=>{
    expect(availableFileModel([tiny,model(base.id,false)],base.id,tiny.id)).toBe(tiny.id);
    expect(availableFileModel([tiny,base],'tiny',base.id)).toBe(tiny.id);
    expect(availableFileModel([tiny,base],base.id,tiny.id)).toBe(base.id);
    expect(availableFileModel([model(tiny.id,false)],'tiny',base.id)).toBe(tiny.id);
  });
});
