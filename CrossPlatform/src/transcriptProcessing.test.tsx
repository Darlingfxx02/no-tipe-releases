import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranscriptRow } from './TranscriptRow';
import { TranscriptErrorDetails } from './TranscriptError';
import { canRetryProcessing, canRetryRecognition, deliveredText, savedProcessing, transcriptErrors } from './transcriptProcessing';
import type { ProcessTranscript } from './transcriptProcessing';
import type { ProcessingConfiguration, Transcript } from './types';
vi.mock('./api',()=>({call:vi.fn(),errorMessage:(error:unknown)=>error instanceof Error?error.message:String(error)}));
const config:ProcessingConfiguration={provider:'local',model:'test',endpoint:'',timeout:90,enhance:true,shorten:false,translation:'off',instructions:'',prompt:'Enhance'};
const item:Transcript={id:'one',text:'Original dictation',enhancedText:null,processingError:null,timestamp:1700000000,duration:3,audioFile:null,model:'Whisper',processingModel:null,mode:null,status:'completed',transcriptionDuration:.2,enhancementDuration:null};
const onProcess:ProcessTranscript=async()=>undefined;
const row=(patch:Partial<Transcript>,pending=false)=>renderToStaticMarkup(<TranscriptRow item={{...item,...patch}} pending={pending} onCopy={()=>{}} onDelete={()=>{}} onOpen={()=>{}} onProcess={onProcess} onRecognize={async()=>undefined}/>);
const details=(patch:Partial<Transcript>,pending=false)=>renderToStaticMarkup(<TranscriptErrorDetails item={{...item,...patch}} pending={pending} onProcess={onProcess}/>);
describe('transcription error recovery',()=>{
  it('preserves intentional whitespace in saved manual results',()=>{expect(deliveredText({...item,enhancedText:'  Corrected result\n'})).toBe('  Corrected result\n');});
  it('keeps successful, unprocessed and old entries free of Review and error actions',()=>{
    for(const patch of [{},{processingConfig:config},{processingState:'completed' as const,enhancedText:'Improved dictation',processingConfig:config}]){
      const html=row(patch);expect(html).not.toContain('Review');expect(html).not.toContain('>Enhance</button>');expect(html).not.toContain('Show transcription error');
    }
  });
  it('places a clickable error indicator before the saved text without exposing details in the row',()=>{
    const html=row({processingState:'failed',processingError:'Provider timed out',processingConfig:config});
    expect(html).toContain('Enhance transcription');expect(html).toContain('transcript-error-action');
    expect(html.indexOf('Enhance transcription')).toBeLessThan(html.indexOf('Original dictation'));
    expect(html).not.toContain('Provider timed out');expect(html).not.toContain('>Enhance</button>');
    const popup=details({processingState:'failed',processingError:'Provider timed out',processingConfig:config});
    expect(popup).toContain('Provider timed out');expect(popup).toContain('The original text is saved.');expect(popup).toContain('>Enhance</button>');
  });
  it('keeps recognition and delivery failures visible without offering enhancement',()=>{
    for(const patch of [{status:'failed',text:'',recognitionError:'Provider timed out'},{deliveryError:'Cannot paste'}]){
      expect(row(patch)).toContain('Show transcription error');expect(details(patch)).not.toContain('>Enhance</button>');
      expect(canRetryProcessing({...item,...patch})).toBe(false);
    }
    expect(canRetryProcessing({...item,text:' ',processingError:'Timeout'})).toBe(false);
  });
  it('omits empty no-speech failures from history, including legacy rows',()=>{
    for(const error of ['No speech detected','No speech text was returned',' No Speech Detected ']) {
      expect(row({status:'failed',text:'',recognitionError:error})).toBe('');
      expect(row({status:'failed',text:'',processingError:error})).toBe('');
    }
    expect(row({processingError:'No speech text was returned'})).toContain('Original dictation');
    expect(row({status:'failed',text:'Partial dictation',recognitionError:'No speech detected'})).toContain('Partial dictation');
  });
  it('offers recognition retry only for failed entries with saved audio',()=>{
    const failed={status:'failed',text:'',audioFile:'/audio/one.wav',recognitionError:'Provider timed out'};
    expect(row(failed)).toContain('Retry transcription');expect(row(failed)).toContain('M13 6');
    expect(canRetryRecognition({...item,...failed})).toBe(true);
    expect(canRetryRecognition({...item,...failed,audioFile:null})).toBe(false);
    expect(canRetryRecognition({...item,...failed,text:'Partial dictation'})).toBe(false);
    expect(canRetryRecognition({...item,...failed,enhancedText:'Recognized text'})).toBe(false);
    expect(canRetryRecognition({...item,audioFile:'/audio/one.wav'})).toBe(false);
    expect(row(failed,true)).toContain('Recognizing…');
    expect(row(failed,true)).toMatch(/Retry transcription[^>]*disabled=""/);
    expect(row({...failed,status:'pending'},true)).toMatch(/Delete transcription[^>]*disabled=""/);
  });
  it('shows independent errors together and only retries processing',()=>{
    const popup=details({processingError:'Timeout',deliveryError:'Cannot paste',processingConfig:config});
    expect(popup).toContain('Processing error');expect(popup).toContain('Timeout');expect(popup).toContain('Delivery error');expect(popup).toContain('Cannot paste');expect(popup).toContain('>Enhance</button>');
  });
  it('disables repeated enhancement and deletion while retaining the source',()=>{
    const html=row({processingState:'processing',processingConfig:config});
    expect(html).toContain('aria-busy="true"');expect(html).toContain('Enhancing…');expect(html).toContain('Original dictation');expect(html).toMatch(/Delete transcription[^>]*disabled=""/);
    const popup=details({processingError:'Timeout',processingConfig:config},true);
    expect(popup).toMatch(/disabled=""[^>]*>Enhancing…<\/button>/);
  });
  it('replaces visible text and removes the error indicator after success',()=>{
    const html=row({processingState:'completed',enhancedText:'Improved dictation',processingConfig:config});
    expect(html).toContain('Improved dictation');expect(html).not.toContain('>Original dictation<');expect(html).not.toContain('Show transcription error');
  });
  it('allows recovered interruptions and older failed entries to retry',()=>{
    expect(canRetryProcessing({...item,processingState:'interrupted',processingError:'Processing was interrupted'})).toBe(true);
    const popup=details({processingError:'Timeout'});
    expect(popup).toContain('Loading enhancement settings…');expect(popup).toMatch(/disabled=""[^>]*>Enhance<\/button>/);
  });
  it('does not reuse unsupported saved configurations',()=>{
    const future={...item,processingConfig:config,sessionConfig:{version:2} as Transcript['sessionConfig'],processingError:'Timeout'};
    expect(savedProcessing(future)).toBeUndefined();expect(details(future)).toContain('Loading enhancement settings…');
  });
  it('separates recognition, processing and delivery errors in legacy and new rows',()=>{
    expect(transcriptErrors({...item,status:'failed',text:'',processingError:'No speech'})).toEqual({recognition:'No speech',processing:null,delivery:null});
    expect(transcriptErrors({...item,processingError:'Text could not be delivered. It is saved in History.'}).delivery).toBeTruthy();
    const errors=transcriptErrors({...item,processingError:'Timeout',deliveryError:'Cannot paste'});expect(errors.processing).toBe('Timeout');expect(errors.delivery).toBe('Cannot paste');
  });
});
