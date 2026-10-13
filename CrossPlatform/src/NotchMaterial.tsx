import { themePalette } from './theme';
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { native } from './api';
import type { Snapshot } from './types';
import cloud from './generated/cloudWave.json';
import {EmpowermentEffect,empoweredWaveFragment,empowermentPixelShader,empowermentLayout} from './recorder/empowerment.js';
import {recorderThemeMaterial} from './recorder/themeMaterial.js';
import {notchAnimatedLayout} from './notchGeometry';

// Keep the recorder's spectral equations. The material below owns the shape,
// stroke and exterior light too, so the wave is no longer cropped by a CSS disc.
const source=empoweredWaveFragment(cloud.fragment,false);
const waveFunction=source.slice(source.indexOf('void main()'))
  .replace('void main() {\n  vec2 gid = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);','vec4 recorderWave(vec2 gid, vec2 resolution) {')
  .replaceAll('uResolution','resolution').replace('outColor = vec4(col, alpha);','return vec4(col, alpha);');
const fragment=source.slice(0,source.indexOf('void main()'))+`
uniform float uPixelRatio;
uniform vec2 uDock;
uniform float uHardwareCutout;
uniform vec2 uPanel;
uniform float uControlSide;
uniform float uReveal;
uniform float uMenu;
uniform float uOutcome;
uniform float uWaveVisible;
uniform float uLightIntensity;
uniform vec3 uMaterialTint;
uniform vec4 uLanguage0;
uniform vec4 uLanguage1;
uniform vec4 uLanguage2;
uniform vec4 uLanguage3;
uniform vec4 uLanguageProgress;
uniform float uTranslationActive;
uniform float uEmpowermentCount;
${empowermentPixelShader}
${waveFunction}
${cloud.materialLight}
${recorderThemeMaterial}
vec2 materialUv(vec2 p);
float roundBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q=abs(p)-halfSize+radius;
  return min(max(q.x,q.y),0.)+length(max(q,0.))-radius;
}
float joinShapes(float a,float b,float k) {
  float h=clamp(.5+.5*(b-a)/k,0.,1.);
  return mix(b,a,h)-k*h*(1.-h);
}
vec2 voiceCenter() {
  return vec2(mix(0.,uControlSide,uHardwareCutout),uDock.y*.5);
}
vec3 materialTheme(vec3 color) {
  vec2 pixel=vec2(gl_FragCoord.x,uResolution.y-gl_FragCoord.y)/uPixelRatio;
  vec2 p=pixel-vec2(uResolution.x/uPixelRatio*.5,0.);
  return recorderMaterialTheme(color,materialUv(p),uMaterialTint,uChromatic);
}
vec3 semanticHue(vec3 color,float success,float error) {
  const vec3 luma=vec3(.2126,.7152,.0722);
  vec3 tint=mix(vec3(.36,.58,.43),vec3(.66,.30,.32),error);
  tint*=dot(color,luma)/dot(tint,luma);
  return mix(color,tint,success*(1.-uChromatic)*(1.-uMonochromeMaterial));
}
// Local coordinates keep the rise attached to the current surface, including
// the side controls and language lobes when they separate from the dock.
vec2 materialUv(vec2 p) {
  vec2 extent=uPanel;
  vec2 uv=vec2(p.x/extent.x+.5,p.y/max(extent.y,1.));
  if(abs(p.x)>extent.x*.5)uv=(p-vec2(sign(p.x)*uControlSide,uDock.y*.5))/32.+.5;
  for(int i=0;i<4;i++) {
    vec4 lobe=i==0?uLanguage0:i==1?uLanguage1:i==2?uLanguage2:uLanguage3;
    float progress=i==0?uLanguageProgress.x:i==1?uLanguageProgress.y:i==2?uLanguageProgress.z:uLanguageProgress.w;
    if(progress>.001&&p.y>extent.y&&roundBox(p-lobe.xy,lobe.zw,min(lobe.z,lobe.w))<4.)
      uv=(p-lobe.xy)/max(lobe.zw*2.,vec2(1.))+.5;
  }
  return uv;
}
float materialDistance(vec2 p) {
  float circles=min(length(p-vec2(-uControlSide,uDock.y*.5))-16.,length(p-vec2(uControlSide,uDock.y*.5))-16.);
  // Grow from the hardware shape itself. Contact curvature changes continuously
  // as the panel touches the two circles and absorbs them into one surface.
  vec2 extent=uPanel;
  float radius=mix(8.,18.,uMenu);
  float panel=roundBox(p-vec2(0.,extent.y*.5-16.),vec2(extent.x*.5,extent.y*.5+16.),radius);
  // Concave shoulders continue the screen edge into the dock instead of
  // letting its vertical sides meet the menu bar at a hard right angle.
  float shoulderRadius=mix(6.,8.,uMenu);
  float sideSign=p.x<0.?-1.:1.;
  vec2 shoulderCenter=vec2(sideSign*(extent.x*.5+shoulderRadius*.5),shoulderRadius*.5);
  float shoulderBox=roundBox(p-shoulderCenter,vec2(shoulderRadius*.5),0.);
  float shoulderCut=shoulderRadius-length(p-vec2(sideSign*(extent.x*.5+shoulderRadius),shoulderRadius));
  panel=min(panel,max(shoulderBox,shoulderCut));
  float field=joinShapes(panel,circles,mix(2.5,5.,uMenu));
  for(int i=0;i<4;i++){
    vec4 lobe=i==0?uLanguage0:i==1?uLanguage1:i==2?uLanguage2:uLanguage3;
    float progress=i==0?uLanguageProgress.x:i==1?uLanguageProgress.y:i==2?uLanguageProgress.z:uLanguageProgress.w;
    if(progress>.001)field=joinShapes(field,roundBox(p-lobe.xy,lobe.zw,min(lobe.z,lobe.w)),3.);
  }
  return field;
}
void main() {
  vec2 pixel=vec2(gl_FragCoord.x,uResolution.y-gl_FragCoord.y)/uPixelRatio;
  vec2 p=pixel-vec2(uResolution.x/uPixelRatio*.5,0.);
  float d=materialDistance(p);
  float aa=max(fwidth(d),.6);
  float face=1.-smoothstep(-aa,aa,d);
  vec2 normal=normalize(vec2(materialDistance(p+vec2(.4,0.))-materialDistance(p-vec2(.4,0.)),materialDistance(p+vec2(0.,.4))-materialDistance(p-vec2(0.,.4)))+vec2(.0001));
  float angle=atan(normal.y,normal.x);
  vec2 voice=voiceCenter();
  float proximity=exp(-length(p-voice)/44.);
  float travel=pow(.5+.5*sin(angle*2.2-uTime*1.9+p.x*.016),5.);
  float pulse=pow(.5+.5*sin(angle*3.1+uTime*1.3-p.y*.022),6.);
  float light=.085+.24*travel+.1*pulse+proximity*uLow*(.18+.35*travel);
  float translator=exp(-pow(length(p-uLanguage0.xy)/23.,4.))*uTranslationActive*uLanguageProgress.x;
  float success=max(step(.5,uOutcome),translator),error=step(1.5,uOutcome);
  vec3 hue=semanticHue(materialTheme(vec3(.64,.70,.86)),success,error);
  vec2 uv=materialUv(p);
  vec2 irradiance=materialLightField(uv);
  float glossGain=materialGlossGain(materialLightEnergy(irradiance));
  // Preserve Type's face and add light from fixed curved sources separately.
  vec2 backgroundUv=(uv-.5)*vec2(90./130.,63./103.)+.5;
  float vignette=1.-smoothstep(.12,.95,distance(backgroundUv,vec2(.5)));
  vec3 base=materialTheme(vec3(.015,.018,.022)*(1.-backgroundUv.y)+vec3(.02,.035,.055)*vignette);
  base=semanticHue(base,success,error);
  vec2 effectUv=(uv-.5)/1.18+.5;
  float vertical=exp(-8.*pow(max(effectUv.y-.25,0.),2.));
  float sides=smoothstep(0.,.14,min(effectUv.x,1.-effectUv.x));
  vec3 directTint=semanticHue(materialTheme(vec3(.02,.035,.055)),success,error);
  vec3 diffuseTint=semanticHue(materialTheme(vec3(.016,.023,.030)),success,error);
  base=(base+.65*(directTint*irradiance.x+diffuseTint*irradiance.y))*(1.-.9*vertical*sides);
  float ring=exp(-pow(d/.85,2.));
  float softGlow=exp(-abs(d)/3.2)*(.025+.07*travel+proximity*uLow*.045)*mix(1.,.08,uPixelMaterial);
  float empowermentOrb=exp(-pow(length(p-uLanguage3.xy)/23.,4.))*uEmpowerment*uLanguageProgress.w;
  base=mix(base,uEmpowermentColor*.045,empowermentOrb);
  vec3 color=base*face+mix(hue,uEmpowermentColor,empowermentOrb)*(ring*light+softGlow)*glossGain;
  float alpha=max(face,clamp((ring*light+softGlow)*glossGain,0.,1.));
  float pixelHalo=recorderPixelHalo(d,1.,uLightIntensity);
  color+=hue*pixelHalo;
  alpha=max(alpha,pixelHalo);
  vec2 waveSize=vec2(32.);
  vec2 local=p-voice+waveSize*.5;
  vec4 wave=recorderWave(local,waveSize);
  // Fade the spectral field into the same material. It lights the rim rather
  // than ending against an unrelated circular clip or static CSS border.
  float field=exp(-pow(length((p-voice)/waveSize)/.75,4.))*face*uWaveVisible;
  color+=wave.rgb*field*.9;
  float waveLight=max(max(wave.r,wave.g),wave.b)*exp(-length(p-voice)/26.);
  color+=hue*ring*waveLight*.36*uWaveVisible;
  vec2 powerCenter=mix(voice,vec2(0.,uDock.y*.5),uMenu);
  vec2 powerExtent=vec2(mix(32.,uPanel.x,uMenu)*.5,uDock.y*.5);
  vec2 powerPoint=p-powerCenter;
  float shower=empowermentPixels(powerPoint,32./21.,uEmpowermentCount,powerExtent);
  color=mix(color,uEmpowermentColor*face,shower*face);
  color+=empowermentWave(powerPoint,powerExtent*.76).rgb*empowermentBand(powerPoint,powerExtent)*face*uWaveVisible;
  // Retain a neutral black camera area on every frame, including the merge.
  float camera=uHardwareCutout>.5?1.-smoothstep(-.7,.7,roundBox(p,vec2(uDock.x*.5,uDock.y),8.)):0.;
  color*=1.-camera;
  float containPixelLight=uPixelMaterial*(1.-uPixelHalo);
  color*=mix(1.,face,containPixelLight);
  alpha=mix(alpha,face,containPixelLight);
  outColor=vec4(min(color,vec3(.84)),alpha);
}`;

type Props={snapshot:Snapshot;open:boolean;menu:boolean;translationVisible:boolean;empowermentVisible:boolean;dockWidth:number;dockHeight:number;hardwareCutout:boolean;panelWidth:number;panelHeight:number;demo:boolean};
export function NotchMaterial(props:Props){
  const canvas=useRef<HTMLCanvasElement>(null),current=useRef(props),wake=useRef<(()=>void)|null>(null);
  current.current=props;
  useEffect(()=>{wake.current?.();},[props]);
  useEffect(()=>{
    const node=canvas.current!,gl=node.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false});
    if(!gl){node.dataset.fallback='true';return;}
    let program:WebGLProgram|null=null,vao:WebGLVertexArrayObject|null=null,frame=0,disposed=false,last=0,time=0,level=0,lastAudio=0;
    let audio={level:0,peak:0},stopAudio:(()=>void)|undefined;
    let reveal=current.current.open?1:0,expandedHeight=current.current.panelHeight;
    const languages=[0,0,0,0];let translationActive=0;const powerAnimation=new EmpowermentEffect();
    const reduced=matchMedia('(prefers-reduced-motion:reduce)'),locations=new Map<string,WebGLUniformLocation|null>();
    const set=(name:string,value:number|number[])=>{if(!locations.has(name))locations.set(name,gl.getUniformLocation(program!,name));const at=locations.get(name)!;if(typeof value==='number')gl.uniform1f(at,value);else if(value.length===2)gl.uniform2fv(at,value);else if(value.length===3)gl.uniform3fv(at,value);else gl.uniform4fv(at,value);};
    const compile=(kind:number,text:string)=>{const shader=gl.createShader(kind)!;gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Notch shader');return shader;};
    const initialize=()=>{const v=compile(gl.VERTEX_SHADER,cloud.vertex),f=compile(gl.FRAGMENT_SHADER,fragment);program=gl.createProgram()!;gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Notch shader link');vao=gl.createVertexArray();locations.clear();node.dataset.fallback='false';};
    const draw=(now:number)=>{
      frame=0;if(disposed||document.hidden||gl.isContextLost()||!program)return;
      const dt=last?Math.min((now-last)/1000,.05):1/60;last=now;
      const p=current.current,s=p.snapshot,recording=s.state==='recording'&&!s.paused;
      const input=recording?(p.demo?Math.max(0,Math.sin(now*.003)*.45+Math.sin(now*.009)*.2+.25):now-lastAudio<220?Math.max(audio.level,audio.peak*.72):0):0;
      const drive=Math.pow(Math.max(0,(Math.min(1,input)-.035)/.965),.68);
      level+=(drive-level)*(1-Math.exp(-dt/(drive>level?.025:.12)));
      const ease=1-Math.exp(-dt/.055);
      reveal=reduced.matches?Number(p.open):reveal+(Number(p.open)-reveal)*ease;
      if(p.menu)expandedHeight=p.panelHeight;
      const surface=node.parentElement!,bounds=surface.getBoundingClientRect();
      const layout=notchAnimatedLayout(p.dockWidth,p.dockHeight,bounds.width,bounds.height,expandedHeight,reveal);
      const {menu,controlSide}=layout,panel=[layout.materialWidth,layout.materialHeight];
      // Read the CSS transition once: every layer follows these same bounds.
      const style=surface.style;
      style?.setProperty('--notch-reveal',String(reveal));
      style.setProperty('--notch-control-side',`${controlSide}px`);
      translationActive+=(Number(p.snapshot.translation!=='off')-translationActive)*(reduced.matches?1:1-Math.exp(-dt/.07));
      const short=panel[0]<272,widths=short?[36,64,64,36]:[36,120,100,36];
      let left=-bounds.width/2;
      const lobes=widths.map((width,i)=>{
        const target=Number(p.dockWidth>0&&((i===0&&p.translationVisible)||(i===3&&p.empowermentVisible)));
        languages[i]+=(target-languages[i])*(reduced.matches?1:1-Math.exp(-dt/(i===0?.06:.042)));
        const progress=languages[i],scaleX=.78+.22*progress,scaleY=.62+.38*progress;
        const x=i===3?bounds.width/2-width/2:left+width/2,y=bounds.height-18+44*progress;
        left+=width+8;
        const label=Math.max(0,Math.min(1,(progress-.25)/.55));
        style?.setProperty(`--language${i}-x`,`${x}px`);style?.setProperty(`--language${i}-y`,`${y}px`);
        style?.setProperty(`--language${i}-width`,`${width}px`);
        style?.setProperty(`--language${i}-scale`,`${scaleX},${scaleY}`);
        style?.setProperty(`--language${i}-opacity`,String(label*label*(3-2*label)));
        return [x,y,width*scaleX/2,18*scaleY];
      });
      if(!reduced.matches)time+=dt*(.7+level*.85);
      const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(node.clientWidth*dpr),h=Math.round(node.clientHeight*dpr);
      if(node.width!==w||node.height!==h){node.width=w;node.height=h;}
      gl.viewport(0,0,w,h);gl.useProgram(program);gl.bindVertexArray(vao);gl.disable(gl.BLEND);
      const palette=themePalette(s.palette);
      for(const [name,value] of Object.entries(cloud.defaults))if(name.startsWith('u'))set(name,value);
      set('uResolution',[w,h]);set('uPixelRatio',dpr);set('uTime',time);set('uWavePhase',time);set('uDock',[p.dockWidth,p.dockHeight]);set('uHardwareCutout',Number(p.hardwareCutout));set('uPanel',panel);set('uControlSide',controlSide);set('uReveal',reveal);set('uMenu',menu);set('uLanguageProgress',languages);set('uTranslationActive',translationActive);lobes.forEach((lobe,i)=>set(`uLanguage${i}`,lobe));
      set('uResolved',1);set('uLayerOpacity',.85);set('uEffectScale',1);set('uAnchor',[.5,.5]);set('uMouse',[0,0,0,0]);set('uWaveCount',3);set('uLow',level);set('uMid',level*.82);set('uHigh',level*.58);set('uBrightnessLow',level);set('uAudioBrightnessResponse',1);set('uChromatic',s.chromatic&&!palette.neutral?1:0);
      set('uLightIntensity',s.lightIntensity??.28);set('uWaveBrightness',s.waveBrightness??.35);
      set('uOutcome',s.state==='failed'?2:['result','copied'].includes(s.state)?1:0);set('uWaveVisible',s.recorderStyle==='pixel'||s.showDictationWaves===false||['preparing','busy','result','copied','failed'].includes(s.state)?0:1);
      const power=powerAnimation.update(s.empowerment?{id:s.empowerment,color:s.empowermentColor||'#F5C84C'}:null,dt,reduced.matches);
      set('uEmpowermentColor',power.color);set('uEmpowerment',power.amount);set('uEmpowermentTime',power.age);
      const powerBounds=empowermentLayout(32+(panel[0]-32)*menu,p.dockHeight,reduced.matches);
      set('uEmpowermentCount',s.recorderStyle==='pixel'&&(s.state!=='recording'||s.showDictationWaves)?powerBounds.count:0);
      set('uMonochromeMaterial',Number(palette.neutral===true));
      set('uPixelMaterial',s.recorderStyle==='pixel'?1:0);
      set('uPixelHalo',Number(s.recorderStyle==='pixel'&&((s.state==='recording'&&!s.paused)||s.state==='preparing'||s.state==='busy')));
      palette.colors.forEach((color,i)=>set(`uThemeColor${i}`,color));
      set('uMaterialTint',palette.accent.slice(1).match(/../g)!.map(hex=>parseInt(hex,16)/255));
      palette.colors.forEach((color,i)=>{set(`uWaveColor${i}`,color);set(`uWaveHighlightColor${i}`,palette.highlights?.[i]||color.map(v=>.76+.24*v));});
      gl.drawArrays(gl.TRIANGLES,0,3);
      if(!reduced.matches)frame=requestAnimationFrame(draw);
    };
    const schedule=()=>{if(!frame&&!disposed&&!document.hidden)frame=requestAnimationFrame(draw);};wake.current=schedule;
    const lost=(event:Event)=>{event.preventDefault();cancelAnimationFrame(frame);frame=0;node.dataset.fallback='true';};
    const restored=()=>{try{initialize();schedule();}catch(error){console.error(error);node.dataset.fallback='true';}};
    try{initialize();schedule();}catch(error){console.error(error);node.dataset.fallback='true';}
    if(native)void listen<typeof audio>('cloud-audio',e=>{audio=e.payload;lastAudio=performance.now();schedule();}).then(stop=>{if(disposed)stop();else stopAudio=stop;});
    const observer=new ResizeObserver(schedule);observer.observe(node);document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);node.addEventListener('webglcontextlost',lost);node.addEventListener('webglcontextrestored',restored);
    return()=>{disposed=true;wake.current=null;cancelAnimationFrame(frame);stopAudio?.();observer.disconnect();document.removeEventListener('visibilitychange',schedule);reduced.removeEventListener('change',schedule);node.removeEventListener('webglcontextlost',lost);node.removeEventListener('webglcontextrestored',restored);gl.deleteProgram(program);gl.deleteVertexArray(vao);queueMicrotask(()=>{if(!node.isConnected)gl.getExtension('WEBGL_lose_context')?.loseContext();});};
  },[]);
  return <canvas ref={canvas} className="notch-material" aria-hidden="true"/>;
}
