import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {EnhancementModels, type EnhancementLayout} from './EnhancementModels';
import {NoTypeButton,NoTypeTabs} from './DesignControls';
import {ModelHubBrowser} from './ModelHubBrowser';
import {Modal, Icon} from './ui';
import {useTheme} from './theme';
import type {Model} from './types';
import './styles.css';
import './models.css';
import './select.css';
import './models-preview.css';

const fixtures:Model[]=[
  ['0.8b','0.8B',532517120,'Compact · basic cleanup · Apache 2.0'],
  ['2b','2B',1280835840,'Fast · everyday editing · Apache 2.0'],
  ['4b','4B',2740937888,'Recommended · quality and speed · Apache 2.0'],
  ['9b','9B',5680522464,'Higher quality · more memory · Apache 2.0'],
].map(([id,size,bytes,description])=>({id:`qwen3.5-${id}`,name:`Qwen3.5 · ${size}`,provider:'local',model:`qwen3.5-${id}`,endpoint:'',local:true,path:null,downloadUrl:'https://huggingface.co',size:Number(bytes),installed:id==='9b'||id==='2b',hasKey:true,languages:'Multilingual',description:String(description)}));
const layouts=[{value:'list',label:'A · Компактный список'},{value:'table',label:'B · Таблица'},{value:'cards',label:'C · Карточки'}] as const;
function Preview(){
  useTheme('prism');
  const [layout,setLayout]=useState<EnhancementLayout>('list');
  const [models,setModels]=useState(fixtures);
  const [progress,setProgress]=useState<Record<string,number>>({});
  const [importing,setImporting]=useState(false);
  const [browsing,setBrowsing]=useState(false);
  return <div className="model-preview">
    <div className="model-preview-bar"><NoTypeTabs id="layout" label="Вариант компоновки" items={layouts} value={layout} onChange={setLayout}/><span>Превью · действия меняют только демо</span></div>
    <div className="app">
      <aside className="sidebar model-preview-sidebar"><div className="window-toolbar"/><div className="brand"><img src="/assets/notype-logo.svg" alt="No Type"/></div><nav>{['Dashboard','Insights','Modes','Transcribe','History','Dictionary','Snippets','AI Models','Audio','Settings'].map((name,i)=><div className={`nav-item ${name==='AI Models'?'selected':''}`} key={name}><Icon name={['dashboard','insights','modes','transcribe','history','dictionary','snippets','models','audio','settings'][i]}/>{name}</div>)}</nav><span className="model-preview-sidebar-footer">No Type · Local preview</span></aside>
      <main className="main-shell"><div className="main-panel"><div className="page-content models-page">
        <header className="page-header"><h1>AI Models</h1></header>
        <div className="model-catalog-toolbar"><NoTypeTabs id="models" label="Model source" items={[{value:'local',label:'Dictation'},{value:'processing',label:'Text enhancement'}]} value="processing" onChange={()=>{}}/><div className="model-toolbar-actions"><NoTypeButton onClick={()=>setBrowsing(true)}>Browse models</NoTypeButton><NoTypeButton onClick={()=>setImporting(true)}>Import model</NoTypeButton></div></div>
        <div role="tabpanel" id="models-panel-processing" aria-labelledby="models-tab-processing">
          <EnhancementModels layout={layout} models={models} progress={progress}
            onDownload={model=>{setProgress({[model.id]:.42});window.setTimeout(()=>{setModels(ms=>ms.map(m=>m.id===model.id?{...m,installed:true}:m));setProgress({});},2400);}}
            onRemove={model=>setModels(ms=>ms.map(m=>m.id===model.id?{...m,installed:false}:m))}/>
        </div>
      </div></div></main>
    </div>
    {browsing&&<ModelHubBrowser kind="text" onClose={()=>setBrowsing(false)} progress={progress}
      search={async request=>({cached:false,warning:null,models:models.filter(model=>request.kind==='text'&&(!request.maxBytes||model.size<=request.maxBytes)&&model.name.toLowerCase().includes(request.query.toLowerCase())).map(model=>({model,asset:{kind:'text',repository:`unsloth/Qwen3.5-${model.name.split(' · ')[1]}-GGUF`,revision:'a'.repeat(40),file:`${model.name.replace(' · ','-')}-Q4_K_M.gguf`,size:model.size,sha256:'b'.repeat(64),name:model.name,languages:model.languages,description:model.description,license:'apache-2.0',architecture:'qwen35',quantization:'Q4_K_M'}}))})}
      onDownload={async entry=>{setModels(ms=>ms.map(m=>m.id===entry.model.id?{...m,installed:true}:m));}}
      onRemove={async model=>{setModels(ms=>ms.map(m=>m.id===model.id?{...m,installed:false}:m));}}
      />}
    {importing&&<Modal title="Add text model" className="models-dialog" onClose={()=>setImporting(false)}><p className="muted">Import a compatible GGUF file or add a direct download link. Available in the desktop app.</p><footer><NoTypeButton onClick={()=>setImporting(false)}>Done</NoTypeButton></footer></Modal>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
