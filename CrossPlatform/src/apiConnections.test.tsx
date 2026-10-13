import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Model} from './types';
import {connectedApiModels,connectApiProvider,providerSpeechModels} from './apiConnections';
import {ApiConnectionDialog} from './ApiConnectionDialog';
vi.mock('./api',()=>({call:vi.fn(),errorMessage:(error:unknown)=>error instanceof Error?error.message:String(error)}));

const model=(id:string,provider:string,hasKey=false,local=false):Model=>({id,name:id,provider,model:id,endpoint:'',local,installed:true,path:null,downloadUrl:null,size:0,hasKey,languages:'Multilingual',description:''});

describe('API connection flow',()=>{
  it('keeps unconnected and local models out of the API catalog',()=>{
    const models=[model('speech','openai',true),model('mini','openai',true),model('other','groq'),model('local','whisper',true,true)];
    const before=structuredClone(models);
    expect(connectedApiModels(models).map(model=>model.id)).toEqual(['speech','mini']);
    expect(models).toEqual(before);
    expect(connectedApiModels(models.map(model=>({...model,hasKey:false})))).toEqual([]);
  });
  it('identifies all supported speech models for one provider without adding local or other providers',()=>{
    const models=[model('speech','openai'),model('mini','openai'),model('other','groq'),model('local','openai',true,true)];
    expect(providerSpeechModels(models,'openai').map(model=>model.id)).toEqual(['speech','mini']);
  });
  it('rejects unsupported destinations and empty keys before invoking native connection',async()=>{
    const connect=vi.fn();
    await expect(connectApiProvider('https://other.example','fixture-key',connect)).rejects.toThrow('supported provider');
    await expect(connectApiProvider('openai','   ',connect)).rejects.toThrow('API key');
    expect(connect).not.toHaveBeenCalled();
  });
  it('uses the single verified connection command and preserves an error for retry',async()=>{
    const connect=vi.fn().mockRejectedValueOnce(new Error('API key rejected')).mockResolvedValueOnce(undefined);
    await expect(connectApiProvider('openai',' fixture-key ',connect)).rejects.toThrow('rejected');
    await connectApiProvider('groq',' other-fixture ',connect);
    expect(connect.mock.calls).toEqual([['openai','fixture-key'],['groq','other-fixture']]);
  });
  it('shows the provider model preview and starts with a blank password field',()=>{
    const html=renderToStaticMarkup(<ApiConnectionDialog models={[model('GPT-4o Transcribe','openai'),model('GPT-4o Mini Transcribe','openai'),model('Groq model','groq')]} initialProvider="openai" onClose={()=>{}} onConnected={async()=>{}}/>);
    expect(html).toContain('Models supported in No Type');
    expect(html).toContain('GPT-4o Transcribe');expect(html).toContain('GPT-4o Mini Transcribe');
    expect(html).not.toContain('Groq model');expect(html).toContain('type="password"');
    expect(html).toContain('value=""');expect(html).toMatch(/disabled=""[^>]*>Connect<\/button>/);
    expect(html).not.toContain('Speech model');expect(html).not.toContain('Use mode');
  });
});
