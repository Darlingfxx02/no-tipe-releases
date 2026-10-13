import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Models} from './Models';
import type {Bootstrap,Model} from './types';
vi.mock('./api',()=>({native:false,call:vi.fn(),errorMessage:String,errorSource:String}));
const model=(id:string,provider:string,name:string,installed=false):Model=>({id,provider,name,model:id.startsWith('whisper-')?id.slice(8):id,local:true,installed,hasKey:true,endpoint:'',path:null,downloadUrl:null,size:500000000,languages:provider==='coreml'?'Russian':'Multilingual',description:''});
describe('model discovery on the main page',()=>{
  it('shows recognizable families by default while retaining an installed smaller model',()=>{
    const models=[model('whisper-small-q5_1','whisper','Whisper Small Q5'),model('whisper-tiny','whisper','Whisper Tiny',true),model('whisper-large-v3','whisper','Whisper Large v3'),model('parakeet-tdt-0.6b-v3-int8','sherpa-onnx','Parakeet v3'),model('gigaam-v3-e2e-rnnt-coreml','coreml','GigaAM v3'),model('whisper-large-v3-turbo','whisper','Whisper Large v3 Turbo')];
    const data={models,textModels:[],modes:[],preferences:{transcriptionModel:'whisper-tiny',processingProvider:'local',processingModel:''}} as unknown as Bootstrap;
    const html=renderToStaticMarkup(<Models data={data} run={vi.fn()} refresh={vi.fn()} notify={vi.fn()} save={vi.fn()} copyWithFeedback={vi.fn()} onApiKeys={vi.fn()}/>);
    expect(html).toContain('NVIDIA');expect(html).toContain('Sber');expect(html).toContain('OpenAI');
    expect(html).toContain('Parakeet v3');expect(html).toContain('GigaAM v3');expect(html).toContain('Whisper Large v3');
    expect(html).toContain('Whisper Tiny');expect(html).not.toContain('Whisper Small Q5');
    expect(html.indexOf('Parakeet v3')).toBeLessThan(html.indexOf('GigaAM v3'));
  });
  it('shows downloadable GigaAM on a Windows catalog without CoreML or downloaded weights',()=>{
    const models=[model('parakeet-tdt-0.6b-v3-int8','sherpa-onnx','Parakeet v3'),model('gigaam-v3-e2e-rnnt-int8','sherpa-onnx','GigaAM v3 · ONNX'),model('gigaam-multilingual-ctc-int8','sherpa-onnx','GigaAM Multilingual · 220M'),model('gigaam-multilingual-large-ctc-int8','sherpa-onnx','GigaAM Multilingual · 600M')];
    const data={models,textModels:[],modes:[],preferences:{transcriptionModel:'parakeet-tdt-0.6b-v3-int8',processingProvider:'local',processingModel:''}} as unknown as Bootstrap;
    const html=renderToStaticMarkup(<Models data={data} run={vi.fn()} refresh={vi.fn()} notify={vi.fn()} save={vi.fn()} copyWithFeedback={vi.fn()} onApiKeys={vi.fn()}/>);
    expect(html).toContain('GigaAM v3 · ONNX');expect(html).toContain('GigaAM Multilingual · 220M');expect(html).toContain('GigaAM Multilingual · 600M');expect(html).toContain('Sber');
  });
});
