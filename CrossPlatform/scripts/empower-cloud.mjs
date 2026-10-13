import {empowermentUniforms,empowermentWaveShader,empowermentPixelShader} from '../src/recorder/empowerment.js';
// Extend the current Tauri recorder without changing the historical Swift UI.
export function integrateEmpowerments(html) {
  const replace = (before, after) => {
    if (!html.includes(before)) throw new Error(`Missing empowerment integration boundary: ${before.slice(0, 80)}`);
    html = html.replaceAll(before, after);
  };
  replace('</head>', `<style>
.language-chip.empowerment-trigger{left:auto;right:0}
.language-chip.empowerment-trigger[data-enabled="true"]{color:#fff}
.empowerment-option[aria-checked=true] .empowerment-check{opacity:1}
.empowerment-check{opacity:0;font-size:14px}
.settings-content [role=radiogroup]{max-height:144px;overflow-y:auto;scrollbar-width:thin}
.empowerment-dot{width:8px;height:8px;border-radius:50%;flex:none;margin-right:8px}
.empowerment-option>span:first-child{display:flex;align-items:center;min-width:0;overflow:hidden;text-overflow:ellipsis}
</style></head>`);
  replace("let settingsOpen=false,translationPickerOpen=false", "let empowerment=null,empowerments=[],empowermentSelectedColor='#F5C84C',empowermentPickerOpen=false;\nlet settingsOpen=false,translationPickerOpen=false");
  replace('function settingsMarkup(){', `function settingsMarkup(){
 if(translationPickerOpen)return \`<div class="settings-content"><section role="radiogroup" aria-label="\${recorderT('Modes.translation')}">\${Object.entries(translations).map(([id,entry])=>\`<button class="setting-option selector-option" role="radio" aria-checked="\${translation===id}" data-setting="translation" data-value="\${id}"><span class="language-full">\${entry.chip}</span><span class="selector-check" aria-hidden="true">\${translation===id?'✓':''}</span></button>\`).join('')}</section></div>\`;
 if(empowermentPickerOpen)return \`<div class="settings-content"><section role="radiogroup" aria-label="\${recorderT('Empowerments.title')}">\${[{id:'',name:recorderT('Empowerments.none'),color:null},...(empowerments.length?empowerments:[{id:'brief',name:recorderT('Empowerments.brief'),color:'#F5C84C'}])].map(({id,name,color})=>\`<button class="setting-option empowerment-option" role="radio" aria-checked="\${(empowerment||'')===id}" data-setting="empowerment" data-value="\${escapeEmpowerment(id)}"><span>\${color?\`<i class="empowerment-dot" style="background:rgb(\${empowermentColor(color).map(value=>Math.round(value*255)).join(',')})" aria-hidden="true"></i>\`: ''}\${escapeEmpowerment(name)}</span><span class="empowerment-check" aria-hidden="true">✓</span></button>\`).join('')}</section></div>\`;
`);
  const vector = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-icon="empowerment"><path d="m12 2 2.7 6.9L22 12l-7.3 3.1L12 22l-2.7-6.9L2 12l7.3-3.1L12 2Z"/></svg>';
  replace('function languageMarkup(){', `function escapeEmpowerment(value){return String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));}
const empowermentVector='${vector}';
const empowermentIcon=()=>recorderStyle==='pixel'?pixelIconMarkup('empowerment',empowermentVector):empowermentVector;
function languageMarkup(){`);
  replace('role="group" aria-label="${recorderT(\'Modes.translation\')}" data-i18n-aria-label="Modes.translation"', 'role="group" aria-label="${recorderT(\'Notch.dictation_settings\')}" data-i18n-aria-label="Notch.dictation_settings"');
  replace(".join('')}</div></div>`;\n}\nfunction fitLanguageChips", ".join('')}</div><button class=\"language-chip language-chip--icon empowerment-trigger\" data-action=\"empowerment-picker\" aria-label=\"${recorderT('Empowerments.title')}\" title=\"${recorderT('Empowerments.title')}\" aria-controls=\"settingsPanel\" aria-expanded=\"false\">${empowermentIcon()}</button></div>`;\n}\nfunction fitLanguageChips");
  replace('const visible=settingsOpen&&(i===0||translationPickerOpen);', 'const visible=settingsOpen&&((i===0&&!translationPickerOpen)||(i===3&&!empowermentPickerOpen));');
  replace('languageSprings=Array.from({length:3}', 'languageSprings=Array.from({length:4}');
  replace('[false,false,false]', '[false,false,false,false]');
  replace('languageElapsed=[0,0,0]', 'languageElapsed=[0,0,0,0]');
  replace('uniform vec4 uLobe2;\nuniform vec3 uLobeProgress;', 'uniform vec4 uLobe2;\nuniform vec4 uLobe3;\nuniform vec4 uLobeProgress;\nuniform float uEmpowermentActive;');
  replace('vec4 lobes[3] = vec4[3](uLobe0, uLobe1, uLobe2);', 'vec4 lobes[4] = vec4[4](uLobe0, uLobe1, uLobe2, uLobe3);');
  replace('for (int i = 0; i < 3; i++) {\n    if (uLobeProgress', 'for (int i = 0; i < 4; i++) {\n    if (uLobeProgress');
  replace('float radius = i == 0 ?', 'float radius = (i == 0 || i == 3) ?');
  replace("{name:'uLobeProgress',value:layout==='cloud'?this.languageGeometry.map(lobe=>lobe.progress):[0,0,0]}", "{name:'uEmpowermentActive',value:Number(!!empowerment)},\n        {name:'uLobeProgress',value:layout==='cloud'?this.languageGeometry.map(lobe=>lobe.progress):[0,0,0,0]}");
  replace('...[0,1,2].map(i=>({name:`uLobe', '...[0,1,2,3].map(i=>({name:`uLobe');
  replace('col = mix(col, compactOrbMaterial(orbPoint, 1.0), orbMask);', `col = mix(col, compactOrbMaterial(orbPoint, 1.0), orbMask);
  float empowermentDistance = lobeField(pixel, uLobe3, min(uLobe3.z, uLobe3.w)).x;
  float empowermentMask = (1.0 - smoothstep(0.0, 3.0 * uPixelScale, empowermentDistance)) * smoothstep(0.6, 0.95, uLobeProgress.w) * uEmpowermentActive;
  vec2 empowermentPoint = (rUv * uCanvasSize - uLobe3.xy) / max(uLobe3.zw * 2.0, vec2(1.0));
  col = mix(col, compactOrbMaterial(empowermentPoint, 1.0), empowermentMask);`);
  replace('if(panel)panel.hidden=!settingsOpen;', `if(panel){
  panel.hidden=!settingsOpen;
  const view=String(empowermentPickerOpen)+String(translationPickerOpen)+recorderI18n.language+JSON.stringify(empowerments.map(item=>[item.id,item.name,item.color]));
  if(panel.dataset.empowermentView!==view){panel.innerHTML=settingsMarkup();panel.dataset.empowermentView=view;}
 }
 const modifierTrigger=root.querySelector('[data-action="empowerment-picker"]');
 if(modifierTrigger){modifierTrigger.dataset.enabled=String(!!empowerment);modifierTrigger.setAttribute('aria-expanded',String(settingsOpen&&empowermentPickerOpen));modifierTrigger.setAttribute('aria-label',recorderT('Empowerments.title'));modifierTrigger.title=recorderT('Empowerments.title');if(modifierTrigger.dataset.glyphStyle!==recorderStyle){modifierTrigger.innerHTML=empowermentIcon();modifierTrigger.dataset.glyphStyle=recorderStyle;}}`);
  replace("button.dataset.setting==='processing'?processing.has(button.dataset.value):translation===button.dataset.value", "button.dataset.setting==='empowerment'?(empowerment||'')===button.dataset.value:button.dataset.setting==='processing'?processing.has(button.dataset.value):translation===button.dataset.value");
  replace("settingsOpen=!settingsOpen;translationPickerOpen=settingsOpen&&translation!=='off';", 'empowermentPickerOpen=false;settingsOpen=!settingsOpen;translationPickerOpen=false;');
  replace("function toggleTranslationPicker(){\n if(translation==='off'){translation=lastTranslation;translationPickerOpen=true;}\n else{lastTranslation=translation;translation='off';translationPickerOpen=false;}\n post('translation',{value:translation});syncSettings();\n}", `function toggleTranslationPicker(){\n empowermentPickerOpen=false;translationPickerOpen=!translationPickerOpen;render();\n if(translationPickerOpen)root.querySelector('#settingsPanel [data-setting="translation"][aria-checked="true"]')?.focus({preventScroll:true});\n}`);
  replace("if(option.dataset.setting==='translation'){", `if(option.dataset.setting==='empowerment'){
   empowerment=value||null;empowermentPickerOpen=false;post('empowerment',{value});render();requestAnimationFrame(()=>root.querySelector('[data-action="empowerment-picker"]')?.focus({preventScroll:true}));return;
  }
  if(option.dataset.setting==='translation'){`);
  replace("if(option.dataset.setting==='translation'){translation=lastTranslation=value;post('translation',{value:translation});}", `if(option.dataset.setting==='translation'){translation=value;if(value!=='off')lastTranslation=value;translationPickerOpen=false;post('translation',{value:translation});render();requestAnimationFrame(()=>root.querySelector('[data-action="translation-picker"]')?.focus({preventScroll:true}));return;}`);
  replace("if(action==='translation-picker')return toggleTranslationPicker();", `if(action==='empowerment-picker'){
   empowermentPickerOpen=!empowermentPickerOpen;translationPickerOpen=false;render();
   if(empowermentPickerOpen)root.querySelector('[data-setting="empowerment"][aria-checked="true"]')?.focus({preventScroll:true});return;
  }
  if(action==='translation-picker')return toggleTranslationPicker();`);
  replace("if(e.key==='Escape'){e.preventDefault();if(settingsOpen)", "if(e.key==='Escape'){e.preventDefault();if(empowermentPickerOpen||translationPickerOpen){const selector=empowermentPickerOpen?'empowerment-picker':'translation-picker';empowermentPickerOpen=false;translationPickerOpen=false;render();requestAnimationFrame(()=>root.querySelector('[data-action=\"'+selector+'\"]')?.focus({preventScroll:true}));return;}if(settingsOpen)");
  replace("if(changed){settingsOpen=false;translationPickerOpen=false;", "if(changed){empowermentPickerOpen=false;settingsOpen=false;translationPickerOpen=false;");
  replace("translation=['off','english','russian'].includes(snapshot.translation)?snapshot.translation:'off';", "empowerments=Array.isArray(snapshot.empowerments)?snapshot.empowerments.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'):empowerments;\n  empowerment=typeof snapshot.empowerment==='string'?snapshot.empowerment:null;\n  empowermentSelectedColor=/^#[0-9a-f]{6}$/i.test(snapshot.empowermentColor||'')?snapshot.empowermentColor:(empowerments.find(item=>item.id===empowerment)?.color||'#F5C84C');\n  translation=['off','english','russian'].includes(snapshot.translation)?snapshot.translation:'off';");
  replace("translationPickerOpen=settingsOpen&&translation!=='off';\n  processing.clear();", "if(!settingsOpen)translationPickerOpen=false;\n  processing.clear();");
  replace("translation,enhance:processing.has('enhance')", "translation,empowerment,enhance:processing.has('enhance')");
  replace(`root.addEventListener('keydown',e=>{
 const option=e.target.closest('[data-setting="translation"]');if(!option)return;
 const items=[...root.querySelectorAll('[data-setting="translation"]')],index=items.indexOf(option);
 const next=e.key==='ArrowRight'?(index+1)%items.length:e.key==='ArrowLeft'?(index-1+items.length)%items.length:-1;
 if(next>=0){e.preventDefault();items[next].focus({preventScroll:true});}
});`, `root.addEventListener('keydown',e=>{
 const option=e.target.closest('#settingsPanel [role="radio"]');if(!option)return;
 const items=[...root.querySelectorAll('#settingsPanel [role="radio"]')],index=items.indexOf(option);
 const next=e.key==='Home'?0:e.key==='End'?items.length-1:['ArrowDown','ArrowRight'].includes(e.key)?(index+1)%items.length:['ArrowUp','ArrowLeft'].includes(e.key)?(index-1+items.length)%items.length:-1;
 if(next>=0){e.preventDefault();items[next].focus({preventScroll:true});}
});`);
  replace('const pickerVisible=settingsOpen&&translationPickerOpen;', 'const pickerVisible=false;');
  replace("const pickerLabel=translation!=='off'?recorderT('Notch.turn_off_translation'):recorderT('Notch.turn_on_translation');", "const pickerLabel=recorderT('Modes.translation');");
  const waveOutput='outColor = vec4(col, alpha);';
  if(!html.includes(waveOutput))throw new Error('Missing empowerment wave output');
  html=html.replace('uniform float uWaveBrightness;', 'uniform float uWaveBrightness;\n'+empowermentUniforms+'\n'+empowermentWaveShader);
  html=html.replace(waveOutput, `float energy=max(max(col.r,col.g),col.b);
  col=mix(col,uEmpowermentColor*energy*1.2,uEmpowerment*.52);
  ${waveOutput}`);
  replace('uniform float uEmpowermentActive;', 'uniform float uEmpowermentActive;\nuniform float uEmpowermentCount;\nuniform vec4 uEmpowermentArea;\nuniform float uEmpowermentWaveVisible;\n'+empowermentUniforms+'\n'+empowermentPixelShader+'\n'+empowermentWaveShader);
  replace('vec3 col = sampleScene(rUv);', `vec3 col = sampleScene(rUv);
  vec2 powerPoint=rUv*uCanvasSize-uEmpowermentArea.xy;
  float powerBand=empowermentBand(pixel-uEmpowermentArea.xy,uEmpowermentArea.zw);
  float shower=empowermentPixels(powerPoint,3.*uPixelScale,uEmpowermentCount,uEmpowermentArea.zw);
  col=mix(col,uEmpowermentColor,shower*powerBand);
  vec4 power=empowermentWave(powerPoint,uEmpowermentArea.zw*.76);
  col+=power.rgb*powerBand*uEmpowermentWaveVisible;`);
  replace('compactOrbMaterial(empowermentPoint, 1.0)', 'mix(compactOrbMaterial(empowermentPoint, 0.0), uEmpowermentColor * 0.22, 0.65)');
  replace('const renderer=new AdaptiveRenderer(canvas);', `const renderer=new AdaptiveRenderer(canvas);
const empowermentAnimation=new EmpowermentEffect();let empowermentFrame={amount:0,age:0,color:[1,.78,.3]};`);
  replace('if(!canvas.isConnected)return;', `if(!canvas.isConnected)return;
 empowermentFrame=empowermentAnimation.update(empowerment?{id:empowerment,color:empowermentSelectedColor}:null,delta,reduce.matches);`);
  replace("if(program.label==='wave'){\n", `if(['wave','glass composite'].includes(program.label))uniforms.push({name:'uEmpowermentColor',value:empowermentFrame.color},{name:'uEmpowerment',value:empowermentFrame.amount},{name:'uEmpowermentTime',value:empowermentFrame.age});
    if(program.label==='glass composite'){
      const powerBounds=empowermentLayout(this.faceSize[0]/this.dpr,Math.min(63,this.faceSize[1]/this.dpr),reduce.matches);
      uniforms.push({name:'uEmpowermentArea',value:[this.faceOrigin[0]+this.faceSize[0]/2,this.faceOrigin[1]+this.faceSize[1]-powerBounds.size[1]*this.dpr,...powerBounds.size.map(value=>value*this.dpr)]},
        {name:'uEmpowermentCount',value:recorderStyle==='pixel'&&(state!=='recording'||showDictationWaves)?powerBounds.count:0},
        {name:'uEmpowermentWaveVisible',value:recorderStyle==='liquid'?this.waveGain*Number(showDictationWaves):0});
    }
    if(program.label==='wave'){\n`);
  return html;
}
