import {readFileSync} from 'node:fs';
import {recorderThemeMaterial} from '../src/recorder/themeMaterial.js';

// Add the alternative pass without changing the shared liquid/glass source.
export function integratePixelRecorder(input){
  let html=input.replace(/\r\n?/g,'\n');
  const replace=(before,after)=>{if(!html.includes(before))throw new Error('Missing pixel integration: '+before.slice(0,60));html=html.replace(before,after);};
  const readRecorder=name=>readFileSync(new URL(`../src/recorder/${name}.js`,import.meta.url),'utf8').replace(/\r\n?/g,'\n');
  html=html.replaceAll('uniform vec3 uThemeTint;', `uniform vec3 uThemeTint;\n${recorderThemeMaterial}\nvec2 materialCoordinates(vec2 pixel);`);
  const tintFunction=/vec3 materialTheme\(vec3 color\) \{\n[\s\S]*?\n\}/g;
  if([...html.matchAll(tintFunction)].length!==2)throw new Error('Missing recorder material theme functions');
  html=html.replace(tintFunction, `vec3 materialTheme(vec3 color) {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  return recorderMaterialTheme(color, materialCoordinates(pixel), uThemeTint, uNeutralBackground);
}`);
  replace("uniforms.push({name:'uNeutralBackground'", `uniforms.push({name:'uPixelMaterial',value:recorderStyle==='pixel'?1:0},{name:'uPixelHalo',value:recorderStyle==='pixel'&&((state==='recording'&&!recordingPaused)||state==='preparing'||state==='busy')?1:0},...themePalettes[palette].colors.map((color,index)=>({name:'uThemeColor'+index,value:color})),{name:'uNeutralBackground'`);
  replace("{name:'uNeutralBackground',value:chromatic?1:0}","{name:'uMonochromeMaterial',value:themePalettes[palette].neutral?1:0},{name:'uNeutralBackground',value:chromatic||themePalettes[palette].neutral?1:0}");
  replace("{name:'uChromatic',value:chromatic?1:0}","{name:'uChromatic',value:chromatic&&!themePalettes[palette].neutral?1:0}");
  replace('if (alpha <= 0.001) return vec4(0.0);', `if (alpha <= 0.001) {
    if (uPixelHalo < .5) return vec4(0.0);
    float halo = recorderPixelHalo(d, uPixelScale, uLightIntensity);
    return vec4(materialTheme(vec3(.64, .70, .86)), halo);
  }`);
  const vectors=readRecorder('vectors').replaceAll('export ','');
  const ink=readRecorder('ink').replaceAll('export ','');
  const motion=readRecorder('motion').replaceAll('export ','');
  const processing=readRecorder('processing').replaceAll('export ','');
  const surface=readRecorder('surface').replaceAll('export ','');
  const power=readRecorder('empowerment').replaceAll('export ','');
  replace('  recordingPaused=snapshot.paused===true;',`  recordingPaused=snapshot.paused===true;
  if(new URLSearchParams(location.search).get('preview')==='customization'){
    const view=['expanded','settings'].includes(snapshot.previewView)?snapshot.previewView:'compact';
    settingsOpen=view==='settings';
    document.documentElement.dataset.previewView=view;
  }`);
  const pixels=power+'\n'+ink+'\n'+vectors+'\n'+motion+'\n'+processing+'\n'+surface+'\n'+readRecorder('pixels').replace(/^import .*from '\.\/(?:vectors|ink|motion|processing|surface|empowerment)\.js';\n/gm,'').replaceAll('export ','');
  replace('let recorderScale=1;',"let recorderScale=1,recorderStyle='pixel',pixelEmotion='auto',pixelProcessing='auto',previewAudio=false,pixelHover=false,pixelGaze=null;\nconst onboardingPreview=new URLSearchParams(location.search).has('preview')&&new URLSearchParams(location.search).has('onboarding');\nif(onboardingPreview)document.documentElement.dataset.onboardingPreview='true';");
  replace('// One glass and edge treatment',`${pixels}
const pixelCanvas=document.createElement('canvas');pixelCanvas.className='pixel-face';pixelCanvas.setAttribute('aria-hidden','true');
const pixelRenderer=new PixelRecorder(pixelCanvas),pixelIcons=new Map();
pixelRenderer.attachPetting(root,()=>{draw(0);schedule();},{nativePointer:!!window.__TAURI__&&!new URLSearchParams(location.search).has('preview')});
root.addEventListener('pointerenter',()=>{pixelHover=true;if(paused)draw(0);});
root.addEventListener('pointerleave',()=>{pixelHover=false;if(paused)draw(0);});
// One glass and edge treatment`);
  replace('window.noTipe={',`window.noTipe={
 pointer(pointer){
  if(onboardingPreview){
   const bounds=root.querySelector('.shell')?.getBoundingClientRect();
   pixelGaze=bounds&&pointer.valid!==false&&Number.isFinite(pointer.x)&&Number.isFinite(pointer.y)?[Math.tanh((pointer.x-bounds.left-bounds.width/2)/120)*1.6,Math.tanh((pointer.y-bounds.top-bounds.height/2)/120)*.9]:null;
   if(paused)draw(0);schedule();return;
  }
  if(nativeActive&&recorderStyle==='pixel')pixelRenderer.petPointer(pointer);
 },`);
  // The pixel style has its own effect canvas. Its liquid texture stays empty
  // and must not be reallocated for each intermediate panel width.
  replace('  draw(program,uniforms=[],textures=[]){',`  ensureTargets(bounds){
    super.ensureTargets(recorderStyle==='pixel'?{...bounds,effectWidth:1,effectHeight:1}:bounds);
  }
  resize(){
    const scale=String(recorderRenderScale(navigator.platform+' '+navigator.userAgent,window.devicePixelRatio));
    if(this.canvas.dataset.renderScale!==scale)this.canvas.dataset.renderScale=scale;
    super.resize();
  }
  surfaceScissor(padding){
    const d=this.dpr,[x,y]=this.shellOrigin.map(value=>value*d),[width,height]=this.faceSize;
    const rectangles=[{x,y,width,height}];
    for(const control of this.controlGeometry)rectangles.push({x:x+(control.x-control.radius)*d,y:y+(control.y-control.radius)*d,width:control.radius*2*d,height:control.radius*2*d});
    for(const lobe of this.languageGeometry)rectangles.push({x:x+(lobe.x-lobe.halfWidth)*d,y:y+(lobe.y-lobe.halfHeight)*d,width:lobe.halfWidth*2*d,height:lobe.halfHeight*2*d});
    return surfaceScissor(this.width,this.height,rectangles,padding*d);
  }
  draw(program,uniforms=[],textures=[]){`);
  replace("if(program.label==='wave'){","if(recorderStyle==='pixel'&&['wave','dots','effect composite'].includes(program.label))return;\n    if(program.label==='wave'){");
  replace('    super.draw(program,uniforms,textures);',`    const bounded=layout==='cloud'&&['background','effect composite','glass composite'].includes(program.label);
    // Include the detached controls and translation lobes throughout the merge.
    // Scene padding also covers the glass refraction and blur sampling footprint.
    if(bounded){this.gl.enable(this.gl.SCISSOR_TEST);this.gl.scissor(...this.surfaceScissor(program.label==='glass composite'&&recorderStyle!=='pixel'?16:64));}
    try{super.draw(program,uniforms,textures);}finally{if(bounded)this.gl.disable(this.gl.SCISSOR_TEST);}`);
  const iconDefinition=html.match(/const icon=name=>iconsax\[name\]\|\|[^\n]+;/)?.[0];
  if(!iconDefinition)throw new Error('Missing shared vector icons');
  replace(iconDefinition,iconDefinition.replace('const icon=name=>','const vectorIcon=name=>')+"\nconst icon=name=>recorderStyle==='pixel'?pixelIconMarkup(name,vectorIcon(name)):vectorIcon(name);");
  const translationDefinition=html.match(/const translateGlyph='[^\n]+;/)?.[0];
  if(!translationDefinition)throw new Error('Missing translation vector icon');
  replace(translationDefinition,'const translateGlyph=translationIcon();');
  replace('function languageMarkup(){',translationDefinition.replace('const translateGlyph=','const translationVector=')+"\nconst translationIcon=()=>recorderStyle==='pixel'?pixelIconMarkup('translation',translationVector):translationVector;\nfunction languageMarkup(){");
  // The language surface survives theme changes, so refresh just its glyph.
  replace('const pickerTrigger=languages.querySelector(\'[data-action="translation-picker"]\');',`const pickerTrigger=languages.querySelector('[data-action="translation-picker"]');
  const translationGlyph=pickerTrigger.querySelector('.language-toggle-glyph');
  if(!!translationGlyph.querySelector('canvas')!==(recorderStyle==='pixel'))translationGlyph.innerHTML=translationIcon();`);
  replace("if(record.querySelector('svg')?.dataset.icon!==mark)record.innerHTML=icon(mark);",`const recordIcon=record.querySelector('canvas');
 if(recorderStyle==='pixel'&&recordIcon){
  if(recordIcon.dataset.icon!==mark){recordIcon.dataset.icon=mark;recordIcon.dataset.pixelIcon=mark;recordIcon.dataset.pixelSource=encodeURIComponent(vectorIcon(mark));}
 }else if(record.querySelector('[data-icon]')?.dataset.icon!==mark||!!recordIcon!==(recorderStyle==='pixel'))record.innerHTML=icon(mark);
 const settingsControl=controls.querySelector('.settings-trigger');if(!!settingsControl.querySelector('canvas')!==(recorderStyle==='pixel'))settingsControl.innerHTML=icon('mode');`);
  replace('root.dataset.palette=palette;','root.dataset.recorderStyle=recorderStyle;root.dataset.palette=palette;');
  replace('if(canvas.parentElement!==visual)visual.append(canvas);',"if(canvas.parentElement!==visual)visual.append(canvas);\n if(pixelCanvas.parentElement!==shell)shell.append(pixelCanvas);pixelCanvas.hidden=recorderStyle!=='pixel';");
  replace("const target=state==='recording'&&!recordingPaused?voiceDrive(nativeLevel,nativePeak):0;",`const sample=previewAudio?Math.max(0,Math.sin(time*3)*.35+Math.sin(time*9)*.18+.3):nativeLevel;
 const target=state==='recording'&&!recordingPaused?voiceDrive(sample,previewAudio?sample:nativePeak):0;`);
  replace('renderer.render({surface:model.surface,sizes:model.sizes,progress:model.progress},audio,delta,undefined,originalAppearance);',`renderer.render({surface:model.surface,sizes:model.sizes,progress:model.progress},audio,delta,undefined,originalAppearance);
 if(recorderStyle==='pixel'){
  const shell=root.querySelector('.shell'),bounds=shell.getBoundingClientRect(),surface=pixelSurfaceLayout(bounds,onboardingPreview),scale=surface.scale;
  root.style.setProperty('--toolbar-height',Math.min(63,bounds.height)+'px');
  pixelCanvas.style.left=surface.left+'px';pixelCanvas.style.top=surface.top+'px';pixelCanvas.style.width=surface.width+'px';pixelCanvas.style.height=surface.height+'px';
  const center=surface.center;
  pixelRenderer.draw({state,paused:recordingPaused,emotion:pixelEmotion,processing:pixelProcessing,time,level:pixelVoiceDrive(sample,previewAudio?sample:nativePeak),hover:pixelHover,reducedMotion:reduce.matches,tint:chromatic?[1,1,1]:materialTint,brightness:waveBrightness,center,pitch:3*scale,visible:state!=='recording'||showDictationWaves,gaze:pixelGaze},delta);
 }
`);
  replace('let audioLevel=0;',`let audioLevel=0;
function drawPixelControls(delta){
 for(const [node,iconRenderer] of pixelIcons)if(!node.isConnected){iconRenderer.dispose();pixelIcons.delete(node);}
 if(recorderStyle!=='pixel')return;
 for(const node of root.querySelectorAll('[data-pixel-icon]')){
  let iconRenderer=pixelIcons.get(node);if(!iconRenderer){iconRenderer=new PixelRecorder(node);iconRenderer.canDraw=()=>nativeActive&&!document.hidden;pixelIcons.set(node,iconRenderer);}
  const options={iconSource:decodeURIComponent(node.dataset.pixelSource),pitch:node.clientWidth/8,brightness:waveBrightness,reducedMotion:true};
  const previous=iconRenderer.lastOptions;
  if(iconRenderer.needsDraw||!previous||previous.iconSource!==options.iconSource||previous.pitch!==options.pitch||previous.brightness!==options.brightness||node.width!==Math.max(1,Math.round(node.clientWidth*Math.min(devicePixelRatio||1,2)))||node.height!==Math.max(1,Math.round(node.clientHeight*Math.min(devicePixelRatio||1,2))))iconRenderer.draw(options,delta);
 }
}`);
  replace('updateTranscriptViewport(delta);','updateTranscriptViewport(delta);drawPixelControls(delta);');
  replace('showDictationWaves=snapshot.showDictationWaves!==false;applyTheme();',"showDictationWaves=snapshot.showDictationWaves!==false;recorderStyle=snapshot.recorderStyle==='liquid'?'liquid':'pixel';pixelEmotion=snapshot.pixelEmotion||'auto';pixelProcessing=snapshot.pixelProcessing||'auto';previewAudio=previewHost&&snapshot.previewAudio===true;applyTheme();");
  // The welcome illustration can be larger than the desktop recorder.
  replace('appearanceValue(snapshot.recorderScale,1)', 'appearanceValue(snapshot.recorderScale,1,onboardingPreview?2:1)');
  replace('this.pillScale=Math.min(1,shell.height/63);','this.pillScale=onboardingPreview?shell.height/63:Math.min(1,shell.height/63);');
  replace('waveBrightness,showDictationWaves,recorderScale});','waveBrightness,showDictationWaves,recorderScale,recorderStyle,pixelEmotion,pixelProcessing,previewAudio});');
  replace('renderer.dispose();','renderer.dispose();pixelRenderer.dispose();for(const iconRenderer of pixelIcons.values())iconRenderer.dispose();pixelIcons.clear();');
  // The glass radius animates in the shader. Keep the icon's layout box fixed:
  // separate raster rounding of a growing button and its centered canvas makes
  // one-pixel rows jump even when their combined geometric center stays still.
  return html.replace('</head>',`<style>.pixel-face{position:absolute;pointer-events:none;z-index:1}.pixel-face[hidden]{display:none}.pixel-control-icon{display:block;width:24px;height:24px;pointer-events:none}.design[data-recorder-style="pixel"][data-control-style="split"] .toolbar :is(.record,.settings-trigger){width:44px;height:44px}.language-toggle-glyph .pixel-control-icon{width:20px;height:20px;grid-area:1/1}[data-recorder-style="pixel"] .visual.failed .fallback{display:none}html[data-onboarding-preview] body{align-items:center;padding:0}html[data-onboarding-preview] :is(.toolbar,.cloud-trigger,.language-chips){display:none!important}</style></head>`);
}
