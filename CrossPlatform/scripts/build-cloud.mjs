import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {integratePixelRecorder} from './pixel-cloud.mjs';
import {localizeCloud} from './localize-cloud.mjs';
import {integrateEmpowerments} from './empower-cloud.mjs';
import {connectRecorderBridge} from '../src/recorder/nativeBridge.js';
import {connectRecorderDrag} from '../src/recorder/drag.js';
let source=readFileSync(new URL('../../NoTipe/Resources/CloudRecorder/CloudRecorder.html',import.meta.url),'utf8').replace(/\r\n?/g,'\n');
// Keep saved theme identifiers compatible while the Tauri palette evolves.
const themeOverrides=JSON.parse(readFileSync(new URL('../src/recorder/themeOverrides.json',import.meta.url),'utf8'));
for(const [name,palette] of Object.entries(themeOverrides)){
 const boundary=new RegExp(`^ ${name}:\\{[^\\n]+\\},$`,'m');
 if(!boundary.test(source))throw new Error(`Missing recorder theme: ${name}`);
 source=source.replace(boundary,` ${name}:${JSON.stringify(palette)},`);
}
const bridge=`const previewHost=new URLSearchParams(location.search).has('preview');
const previewParentOrigin=location.protocol==='tauri:'?'*':location.origin;
const post=(action,detail={})=>{if(!previewHost&&window.__TAURI__){window.__TAURI__.core.invoke('cloud_action',{action,detail}).catch(()=>{});}else if(previewHost){parent.postMessage(action==='ready'?{type:'no-tipe-ready'}:{type:'no-tipe-action',action,detail},previewParentOrigin);}};`;
let html=source.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'').replace("const post=(action,detail={})=>window.webkit?.messageHandlers?.cloudRecorder?.postMessage({action,...detail});",bridge);
html=integrateEmpowerments(localizeCloud(integratePixelRecorder(html)));
// A second dictation starts from the default surface, even when the previous
// completion was hidden before its animation could finish.
const phaseChange="const changed=state!==next;";
if(!html.includes(phaseChange))throw new Error('Missing recorder phase transition');
html=html.replace(phaseChange,`${phaseChange}\n  const freshRecording=changed&&next==='recording';\n  if(freshRecording)resetHiddenSession();`);
const scheduleUpdate="  schedule();\n },\n audio(";
if(!html.includes(scheduleUpdate))throw new Error('Missing recorder update boundary');
html=html.replace(scheduleUpdate,"  if(freshRecording)draw(0);\n"+scheduleUpdate);
// Native visibility suspends drawing only. The backend owns the current phase,
// including a paused recording or a completion received while Dashboard is open.
const deactivate="if(!nativeActive){cancelAnimationFrame(raf);raf=0;resetHiddenSession();}";
if(!html.includes(deactivate))throw new Error('Missing recorder visibility boundary');
html=html.replace(deactivate,"if(!nativeActive){cancelAnimationFrame(raf);raf=0;}");
// Keep the compiled renderer resident while the native window is hidden.
// State/layout callbacks can still arrive after RAF is cancelled; gate the
// actual draw and any already queued frame, including the startup handshake.
const drawBoundary='if(!canvas.isConnected)return;';
if(!html.includes(drawBoundary))throw new Error('Missing recorder draw boundary');
html=html.replace(drawBoundary,'if(!nativeActive||document.hidden||!canvas.isConnected)return;');
html=html.replace('nativeActive=true,',"nativeActive=new URLSearchParams(location.search).has('preview'),");
html=html.replace('raf=0;const delta=', 'raf=0;if(!nativeActive||paused||document.hidden)return;const delta=');
html=html.replace('else schedule();});', 'else if(nativeActive){draw(0);schedule();}});');
// Never synchronously wait for the GPU on the recording hot path. Retained
// programs are ready already; frame submission does not need gl.finish().
html=html.replaceAll('renderer.gl?.finish();','');
// Recorder settings share the desktop's compositional accent materials.
// The spectral wave palettes and shader stay in their existing source.
const accentMaterials=JSON.parse(readFileSync(new URL('../src/accentMaterials.json',import.meta.url),'utf8'));
const ellipse=(position,colors,stops)=>`radial-gradient(ellipse ${position[0]}% ${position[1]}% at ${position[2]}% ${position[3]}%, ${colors.map((color,index)=>`${color} ${stops[index]}%`).join(', ')})`;
const materialCss=Object.entries(accentMaterials).map(([name,material])=>{
 const fill=[...material.reflections.map(reflection=>ellipse(reflection.position,reflection.colors,[0,32,72])),ellipse(material.position,material.face,[0,42,100])].join(', ');
 return `[data-palette="${name}"]{--accent-fill:${fill}}`;
}).join('\n');
// Keep the scene buffer stable while CSS animates the shell. The shader gets
// its actual panel bounds each frame; the transparent viewport never resizes.
html=html.replace('</head>',`<style>${materialCss}
html:not([data-onboarding-preview]) .cloud .visual{position:fixed;inset:0;width:100%;height:100%}
html[data-movable-recorder] .shell,html[data-movable-recorder] .cloud-trigger,html[data-movable-recorder] .status-area{cursor:grab;touch-action:none}
html[data-movable-recorder] .reading{cursor:default}
html[data-movable-recorder] [data-dragging="true"],html[data-movable-recorder] [data-dragging="true"] *{cursor:grabbing!important}
html[data-customization-preview] body{align-items:center;padding:0 24px}
html[data-customization-preview][data-preview-view="settings"] body{padding-top:44px}
.setting-option[aria-checked="true"] .setting-switch{background:var(--accent-fill);box-shadow:inset 0 0 0 1px rgb(255 255 255 / .08)}</style></head>`);
html=html.replace('<script>', `<script>
window.addEventListener('error',e=>{window.__TAURI__?.core.invoke('cloud_action',{action:'renderer-status',detail:{error:e.message,stage:'script',hidden:document.hidden}}).catch(()=>{});});
</script><script>`);
html=html.replace("reportHitRegions();\n  const wave=", "reportHitRegions();\n  post('renderer-status',{error:renderer.error?.message||null,palette,chromatic,hidden:document.hidden,width:canvas.width,height:canvas.height,stage:'update'});\n  const wave=");
html=html.replace("window.noTipe={", "window.noTipe={\n debug(){return {state,palette,chromatic,nativeActive,paused,hidden:document.hidden,completion:renderer.success,copy:renderer.copyState.value,errorState:renderer.errorState.value,rendererError:renderer.error?.message,glError:renderer.gl?.getError(),time,rect:root.getBoundingClientRect().toJSON(),shell:root.querySelector('.shell')?.getBoundingClientRect().toJSON(),canvas:canvas.getBoundingClientRect().toJSON(),fallback:canvas.dataset.fallback};},");
html=html.replace('</body>'  ,`<script>
if(new URLSearchParams(location.search).has('preview')){
 if(new URLSearchParams(location.search).get('preview')==='customization')document.documentElement.dataset.customizationPreview='true';
 window.addEventListener('message',e=>{const localOrigin=e.origin===location.origin||(location.protocol==='tauri:'&&['null','tauri://localhost'].includes(e.origin));if(e.source!==parent||!localOrigin)return;if(e.data?.type==='no-tipe-snapshot')window.noTipe?.update(e.data.snapshot);else if(document.documentElement.dataset.onboardingPreview==='true'&&e.data?.type==='no-tipe-pointer')window.noTipe?.pointer(e.data.pointer);});
 parent.postMessage({type:'no-tipe-ready'},location.protocol==='tauri:'?'*':location.origin);
}else if(window.__TAURI__){
 const api=window.__TAURI__;
 document.documentElement.dataset.movableRecorder='true';
 const connectRecorderDrag=${connectRecorderDrag.toString().replace(/\r\n?/g,'\n')};
 const disposeDrag=connectRecorderDrag(document.querySelector('.design'),detail=>api.core.invoke('cloud_action',{action:'drag',detail}),error=>api.core.invoke('cloud_action',{action:'renderer-status',detail:{error:String(error),stage:'drag'}}).catch(()=>{}));
 const connectRecorderBridge=${connectRecorderBridge.toString().replace(/\r\n?/g,'\n')};
 const connection=connectRecorderBridge(api,{
  update:snapshot=>window.noTipe?.update(snapshot),
  active:active=>window.noTipe?.active(active),
  audio:audio=>window.noTipe?.audio(audio.level,audio.peak),
  pointer:pointer=>window.noTipe?.pointer(pointer),
  error:error=>api.core.invoke('cloud_action',{action:'renderer-status',detail:{error:String(error),stage:'bridge'}}).catch(()=>{})
 });
 window.addEventListener('pagehide',()=>{disposeDrag();connection.dispose();},{once:true});
}
</script></body>`);
writeFileSync(new URL('../public/cloud.html',import.meta.url),html);

// The dashboard uses the recorder's actual spectral pass, tuning and themes.
// Keep one source of truth when the cloud shader changes.
const extract=(pattern,label)=>{
 const match=source.match(pattern);
 if(!match)throw new Error(`Missing cloud ${label}; update the shared shader extractor.`);
 return match[1];
};
const vertex=extract(/var at=`([\s\S]*?)`,ot=/,'vertex shader');
const fragment=extract(/,ot=`([\s\S]*?)`,st=/,'wave shader');
const materialLight=extract(/const recorderLight=`([\s\S]*?)`;/,'material light field');
const defaults=runInNewContext('('+extract(/,ft=(\{[^}]+\});function pt/,'wave defaults')+')');
const response=runInNewContext('('+extract(/const response=(\{uLowAmplitude:[^}]+\});/,'voice response')+')');
const palettes=runInNewContext('('+extract(/const themePalettes=(\{[\s\S]*?\n\});/,'palettes')+')');
mkdirSync(new URL('../src/generated/',import.meta.url),{recursive:true});
writeFileSync(new URL('../src/generated/cloudWave.json',import.meta.url),JSON.stringify({vertex,fragment,materialLight,defaults:{...defaults,...response},palettes},null,2)+'\n');
// Empty-state plates freeze the recorder's real glass, including its light field.
const background=extract(/,ct=`([\s\S]*?)`,lt=/,'material background').replaceAll('${recorderLight}',materialLight);
const glass=extract(/,ut=`([\s\S]*?)`,dt=/,'glass shader').replaceAll('${recorderLight}',materialLight);
const optics=runInNewContext('('+extract(/const cloudGlass=(\{[^}]+\});/,'glass tuning')+')');
const rim=runInNewContext('('+extract(/const cloudRim=(\{[^}]+\});/,'rim tuning')+')');
writeFileSync(new URL('../src/generated/cloudGlass.json',import.meta.url),JSON.stringify({vertex,background,glass,optics,rim},null,2)+'\n');
