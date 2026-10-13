import {describe,expect,it} from 'vitest';
import {downloadActive,downloadFraction,downloadLabel,speechModelStatus} from './modelDownloads';
import type {Model} from './types';
describe('model download presentation',()=>{
  it('shows verification and unknown totals without pretending installation is complete',()=>{
    const state={id:'fixture',phase:'downloading' as const,done:10e6,total:0,resumable:true};
    expect(downloadFraction(state)).toBeUndefined();expect(downloadLabel(state)).toContain('Total size unknown');
    expect(downloadLabel({...state,phase:'verifying'})).toContain('Checking model');
    expect(downloadActive({...state,phase:'paused'})).toBe(false);
    expect(downloadLabel({...state,phase:'paused'})).toContain('saved');
    expect(downloadFraction({...state,total:5e6})).toBe(1);
    expect(downloadLabel({...state,done:4096,total:8192})).toContain('4.1 KB of 8.2 KB');
  });
  it('distinguishes installed weights and a saved API key from a verified connection',()=>{
    const model={local:true,installed:false,hasKey:true} as Model;
    expect(speechModelStatus(model)).toContain('Download');
    expect(speechModelStatus({...model,installed:true})).toContain('Ready');
    expect(speechModelStatus({...model,local:false})).toContain('Test dictation');
    expect(speechModelStatus({...model,local:false,hasKey:false})).toContain('API key');
  });
});
