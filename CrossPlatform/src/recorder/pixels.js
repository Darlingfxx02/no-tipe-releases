import {pixelContours,pixelPongContours,pixelVectorPlan,pixelVectorFrame,pixelCompletionContours,pixelEqualizerContours,pixelPoseContours} from './vectors.js';
import {pixelInkStyle,pixelMaskField,pixelInkCoverage} from './ink.js';
import {pixelFacePose,pixelAudioEnvelope,pixelEqualizer} from './motion.js';
import {pixelProcessingVariant,pixelProcessingOpacity,pixelArcadeContours} from './processing.js';
import {surfaceScissor} from './surface.js';
import {EmpowermentEffect,empowermentStars,empowermentUniforms,empowermentPixelShader} from './empowerment.js';
// One grid for faces, the voice meter and masked vector icons. Glass stays separate.
const columns=21, rows=11;
const eyes={
  neutral:['0110','1111','1111','1111','1111','1111','0110'],
  blink:['0000','0000','0000','1111','0000','0000','0000'],
  happy:['0110','1111','1001','1001','0000','0000','0000'],
  curious:['0110','1001','1001','1001','1001','1001','0110'],
  sleepy:['0000','0000','0000','0000','1001','1111','0110'],
  star:['0110','0110','1111','1111','0110','0110','0000'],
  worried:['1000','1100','0110','0011','1111','1111','0110'],
  focused:['0000','1111','1111','1111','1111','0110','0000'],
  surprised:['1111','1001','1001','1001','1001','1001','1111'],
  joy:['0000','0110','1111','1001','0000','0000','0000'],
  squint:['0000','0000','1111','1111','0000','0000','0000'],
  playful:['1000','0100','0010','0001','0010','0100','1000'],
};
const heart=['011000110','111101111','111111111','011111110','001111100','000111000','000010000'];
const completionGlyphs={
  result:['0000000000011','0000000000110','0000000001100','0000000011000','1100000110000','0110001100000','0011011000000','0001110000000','0000100000000'],
  copied:['011111000','110001000','100111110','100100011','100100001','110100001','010100001','000110011','000011110'],
  failed:['010','111','111','111','111','010','000','111','111'],
};
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const completionDuration=.15,completionKinds=new Set(['result','copied','failed']);
// A stroke needs travel and a change of direction; hovering or passing straight
// over the recorder does not count. The reaction uses wall time, even when the
// animation clock is stopped by Reduce Motion.
export class PixelPetting{
  constructor(){this.until=0;this.resetStroke();}
  resetStroke(){this.last=null;this.direction=null;this.distance=0;this.turn=0;this.started=0;}
  clear(){this.until=0;this.resetStroke();}
  active(now){return now<this.until;}
  move(x,y,now,near=true){
    if(!near){this.resetStroke();return false;}
    if(!this.last||now-this.last[2]>450){this.resetStroke();this.last=[x,y,now];this.started=now;return false;}
    const dx=x-this.last[0],dy=y-this.last[1],distance=Math.hypot(dx,dy);
    if(distance<2)return false;
    if(distance>80){this.resetStroke();this.last=[x,y,now];this.started=now;return false;}
    const direction=[dx/distance,dy/distance];
    if(this.direction)this.turn+=Math.acos(clamp(direction[0]*this.direction[0]+direction[1]*this.direction[1],-1,1));
    this.direction=direction;this.distance+=distance;this.last=[x,y,now];
    if(this.active(now)||(this.distance>=32&&this.turn>=Math.PI/2&&now-this.started>=100)){
      this.until=now+1800;return true;
    }
    return false;
  }
}
// Switch silhouettes only at zero opacity, so eyes and heart never pop into
// one another. Reversing the gesture simply reverses the same fade.
export class PixelAffection{
  constructor(){this.clear();}
  clear(){this.value=0;this.target=false;this.last=null;this.heart=false;this.heartStart=0;}
  update(active,now,reducedMotion=false){
    const elapsed=this.last===null?0:Math.max(0,(now-this.last)/1000);this.last=now;
    if(reducedMotion)this.value=active?1:0;
    else if(active===this.target)this.value=clamp(this.value+(active?1:-1)*elapsed/.54,0,1);
    this.target=active;
    const heart=this.value>=.45;
    if(heart&&!this.heart)this.heartStart=now;
    this.heart=heart;
    const t=heart?(this.value-.45)/.55:1-this.value/.45,opacity=t*t*(3-2*t);
    const phase=this.value===0||this.value===1?'steady':heart?(active?'heart-fade-in':'heart-fade-out'):(active?'face-fade-out':'face-fade-in');
    return {heart,opacity,time:heart?Math.max(0,(now-this.heartStart)/1000):0,phase};
  }
}
export function pixelHeartEchoes(time,opacity=1,reducedMotion=false){
  return Array.from({length:3},(_,i)=>{
    const age=time-i*.7;
    if(reducedMotion||age<=0)return {scale:1,opacity:0};
    const duration=2.1,local=age%duration,phase=local/duration;
    const emission=i+Math.floor(age/duration)*3;
    const arrival=clamp(local/.16,0,1),fadeIn=arrival*arrival*(3-2*arrival);
    // Filled copies keep the heart's red ink. Every newly emitted copy starts
    // dimmer than the previous one, then loses opacity as it travels outward.
    return {scale:1+phase*1.35,opacity:fadeIn*(1-phase)**1.35*.62*.76**emission*opacity};
  });
}
export function pixelIconMarkup(kind,source){
  return `<canvas class="pixel-control-icon" data-icon="${kind}" data-pixel-icon="${kind}" data-pixel-source="${encodeURIComponent(source)}" aria-hidden="true"></canvas>`;
}
export function pixelGeometry(width,height,dpr,requestedPitch,requestedCenter){
  const pitch=Math.max(2,Math.round(requestedPitch?requestedPitch*dpr:Math.min(width/columns,height/rows)));
  const center=requestedCenter?requestedCenter.map(value=>value*dpr):[width/2,height/2];
  const origin=center.map((value,i)=>Math.round(value-[columns,rows][i]*pitch/2));
  return {pitch,gap:Math.max(1,Math.round(pitch*.16)),origin,center:origin.map((value,i)=>value+[columns,rows][i]*pitch/2)};
}
export function pixelPong(time=0){
  const flight=1.1;
  const reflect=(value,span)=>{const phase=((value%(span*2))+span*2)%(span*2);return span-Math.abs(phase-span);};
  const ballY=at=>1.5+reflect(2+at*5.2,7);
  // Each paddle travels toward the next actual impact, arriving at the ball's
  // height on contact. The ball reflects independently off all four sides.
  const paddle=offset=>{
    const cycle=(time-offset)/(flight*2),turn=Math.floor(cycle),progress=cycle-turn;
    const ease=progress*progress*(3-2*progress),start=offset+turn*flight*2;
    return clamp(ballY(start)+(ballY(start+flight*2)-ballY(start))*ease,2,8);
  };
  return {ball:{x:4.5+reflect(time/flight,1)*11,y:ballY(time)},left:paddle(0),right:paddle(flight)};
}
export function pixelProcessingContours(options={}){
  const variant=pixelProcessingVariant(options),time=options.reducedMotion?.55:Math.max(0,options.time??0);
  return variant==='pong'?pixelPongContours(pixelPong(time)):pixelArcadeContours(variant,time);
}
export function pixelFrame({state='idle',paused=false,emotion='auto',processing='auto',processingVisit=0,time=0,level=0,hover=false,petting=false,reducedMotion=false}={}){
  const cells=new Uint8Array(columns*rows);
  const stamp=(glyph,x,y,mirror=false)=>glyph.forEach((line,j)=>[...line].forEach((dot,i)=>{if(dot==='1')cells[(y+j)*columns+x+(mirror?line.length-1-i:i)]=255;}));
  if(state==='recording'&&!paused){
    for(const [i,continuousHeight] of pixelEqualizer(time,level,reducedMotion).entries()){
      const height=1+2*Math.round((continuousHeight-1)/2);
      for(let y=(rows-height)/2;y<(rows+height)/2;y++)cells[y*columns+4+i*2]=255;
    }
    return {cells,mood:'listening'};
  }
  if(state==='preparing'||state==='busy'){
    const options={processing,processingVisit,time,reducedMotion};
    if(pixelProcessingVariant(options)!=='pong'){
      // The diagnostic grid and non-vector consumers sample the same scene.
      const shapes=pixelProcessingContours(options),inside=(points,x,y)=>{
        let hit=false;
        for(let i=0,j=points.length-1;i<points.length;j=i++){
          const a=points[i],b=points[j];
          if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
        }
        return hit;
      };
      for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)if(shapes.some(shape=>shape.contours.reduce((hit,points)=>hit!==inside(points,x+.5,y+.5),false)))cells[y*columns+x]=255;
      return {cells,mood:'thinking'};
    }
    const pong=pixelPong(reducedMotion?.55:time);
    for(const [x,center] of [[2,pong.left],[17,pong.right]]){
      const top=Math.round(center)-2;
      for(let y=top;y<top+5;y++)for(let i=0;i<2;i++)cells[y*columns+x+i]=255;
    }
    const ballX=Math.round(pong.ball.x-.5),ballY=Math.round(pong.ball.y-.5);
    for(let y=ballY;y<ballY+2;y++)for(let x=ballX;x<ballX+2;x++)cells[y*columns+x]=255;
    return {cells,mood:'thinking'};
  }
  if(completionGlyphs[state]){stamp(completionGlyphs[state],state==='result'?4:state==='copied'?6:9,1);return {cells,mood:state==='result'?'check':state==='copied'?'copy':'alert'};}
  const affection=petting&&state==='idle'&&!paused;
  const pose=pixelFacePose({emotion:affection?'love':emotion,time,paused,hover:affection?false:hover,reducedMotion}),mood=pose.mood;
  if(mood==='love')stamp(heart,6,2);
  else{
    const glyph=eyes[mood]||eyes.neutral;
    stamp(pose.leftBlink>.65?eyes.blink:glyph,3,2);
    stamp(mood==='wink'||pose.rightBlink>.65?eyes.blink:glyph,14,2,mood==='worried'||mood==='playful');
  }
  return {cells,mood};
}
const vertex=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;
${empowermentUniforms}
uniform float uEmpowermentCount;
${empowermentPixelShader}
uniform vec2 uResolution;uniform sampler2D uIconMask;uniform vec2 uIconOrigin;uniform vec2 uIconSize;uniform vec3 uTint;
uniform float uVoice;uniform float uAffection;uniform float uBrightness;uniform vec2 uCenter;
uniform float uPitch;uniform float uGap;uniform float uInkOpacity;uniform float uOpacity;uniform vec2 uEchoes[3];
out vec4 outColor;
float shapeDistance(vec2 p){
  vec2 uv=(p-uIconOrigin)/uIconSize;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return 8.;
  vec2 encoded=texture(uIconMask,uv).rg;
  return (dot(encoded,vec2(256./257.,1./257.))-.5)*16.;
}
float pixelMask(vec2 point,float scale){
  vec2 p=uCenter+(point-uCenter)/scale;
  vec2 grid=(p-uCenter)/uPitch+vec2(${columns}.,${rows}.)*.5;
  float d=shapeDistance(p),edge=exp(-abs(d)*2.),sampleStep=uPitch*.4;
  vec2 gradient=vec2(shapeDistance(p+vec2(sampleStep,0.))-shapeDistance(p-vec2(sampleStep,0.)),shapeDistance(p+vec2(0.,sampleStep))-shapeDistance(p-vec2(0.,sampleStep)))/.8;
  vec2 normal=gradient/(length(gradient)+.35);
  // Small contour-driven bends keep the underlying vector intact. Display rows
  // remain a final pass and do not alter the morph's control points.
  float warp=sin(grid.y*1.35+grid.x*.4)*${pixelInkStyle.warp}*uPitch*edge;
  float shape=shapeDistance(p+normal*warp)*uPitch*scale;
  vec2 displayGrid=(point-uCenter)/uPitch+vec2(${columns}.,${rows}.)*.5;
  float row=displayGrid.y+sin((displayGrid.x-${columns/2})*.55)*${pixelInkStyle.curve}+normal.x*edge*${pixelInkStyle.follow};
  float stripe=abs(fract(row+uGap/uPitch*.5)-.5)*uPitch-(uPitch-uGap)*.5;
  // Round only the intersections of the white contour and each row cut. The
  // interior of a row remains joined horizontally, with no square-cell seams.
  float radius=uPitch*${pixelInkStyle.rounding};
  float distance=max(shape,stripe)<-radius?max(shape,stripe):length(max(vec2(shape,stripe)+radius,vec2(0.)))+min(max(shape,stripe),-radius);
  return 1.-smoothstep(-.45,.45,distance);
}
void main(){
  vec2 p=vec2(gl_FragCoord.x,uResolution.y-gl_FragCoord.y);
  vec2 grid=(p-uCenter)/uPitch+vec2(${columns}.,${rows}.)*.5;
  float mask=pixelMask(p,1.);
  vec3 ink=mix(vec3(.94,.96,.92),mix(vec3(.84,.91,1.),uTint,grid.x/${columns}.),uVoice*.55);
  ink=mix(ink,vec3(1.,.18,.26),uAffection);
  float alpha=mask*uBrightness*uInkOpacity*uOpacity;
  vec4 echoes=vec4(0.);
  if(uAffection>.5)for(int i=0;i<3;i++){
    if(uEchoes[i].y<=0.)continue;
    float echoAlpha=pixelMask(p,uEchoes[i].x)*uEchoes[i].y*uBrightness*uInkOpacity;
    echoes+=vec4(ink*echoAlpha,echoAlpha)*(1.-echoes.a);
  }
  vec4 result=vec4(ink*alpha,alpha)+echoes*(1.-alpha);
  float shower=empowermentPixels(p-uCenter,uPitch,uEmpowermentCount)*uInkOpacity;
  outColor=result+vec4(uEmpowermentColor*shower,shower)*(1.-result.a);
}`;
export class PixelRecorder{
  constructor(canvas){
    this.canvas=canvas;this.values=new Float32Array(columns*rows);this.pixels=new Uint8Array(columns*rows);this.completionTargets=new Map();this.faceShapes=new Map();this.facePlans=new Map();this.voiceLevel=0;this.petGesture=new PixelPetting();this.affection=new PixelAffection();this.empowermentEffect=new EmpowermentEffect();
    this.gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false});
    this.lost=event=>{event.preventDefault();canvas.dataset.fallback='true';};this.restored=()=>this.initialize();
    canvas.addEventListener('webglcontextlost',this.lost);canvas.addEventListener('webglcontextrestored',this.restored);
    if(this.gl)this.initialize();else this.context=canvas.getContext('2d');
  }
  initialize(){
    this.needsDraw=true;
    const gl=this.gl;
    try{
      const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error);}return shader;};
      const v=compile(gl.VERTEX_SHADER,vertex),f=compile(gl.FRAGMENT_SHADER,fragment);this.program=gl.createProgram();
      gl.attachShader(this.program,v);gl.attachShader(this.program,f);gl.linkProgram(this.program);gl.deleteShader(v);gl.deleteShader(f);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
      this.locations=Object.fromEntries(['uEmpowermentColor','uEmpowerment','uEmpowermentTime','uEmpowermentCount','uResolution','uIconMask','uIconOrigin','uIconSize','uTint','uVoice','uAffection','uBrightness','uCenter','uPitch','uGap','uInkOpacity','uOpacity','uEchoes'].map(name=>[name,gl.getUniformLocation(this.program,name==='uEchoes'?'uEchoes[0]':name)]));
      this.vao=gl.createVertexArray();gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      this.iconTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.iconTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,0]));this.uploadedField=null;this.textureSize='1,1';
      delete this.canvas.dataset.fallback;
    }catch(error){console.error('Pixel recorder:',error);this.canvas.dataset.fallback='true';}
  }
  petPointer(pointer){this.hasNativePointer=true;this.handlePetPointer?.(pointer);}
  attachPetting(surface,onChange=()=>{},{nativePointer=false}={}){
    this.stopPetting?.();
    const document=surface.ownerDocument;let timer=0;this.hasNativePointer=false;
    this.handlePetPointer=pointer=>{
      if(pointer.buttons||document.hidden||!surface.isConnected||this.canvas.hidden||this.lastOptions?.state!=='idle'||this.lastOptions.paused||!this.interactionArea){this.petGesture.clear();return;}
      if(pointer.valid===false||!Number.isFinite(pointer.x)||!Number.isFinite(pointer.y)){this.petGesture.resetStroke();return;}
      const bounds=this.canvas.getBoundingClientRect(),area=this.interactionArea;
      const scaleX=bounds.width/this.canvas.clientWidth,scaleY=bounds.height/this.canvas.clientHeight;
      if(!(scaleX>0&&scaleY>0)){this.petGesture.resetStroke();return;}
      const x=(pointer.x-bounds.left)/scaleX-area.center[0],y=(pointer.y-bounds.top)/scaleY-area.center[1];
      const near=Math.abs(x)<=area.radius[0]&&Math.abs(y)<=area.radius[1];
      if(this.petGesture.move(x,y,performance.now(),near)){
        clearTimeout(timer);timer=setTimeout(onChange,1810);onChange();
      }
    };
    // A nonactivating, click-through desktop window does not receive DOM moves
    // around its surface. Its existing native cursor sampler feeds this path.
    const move=event=>{if(!nativePointer||!this.hasNativePointer)this.handlePetPointer?.({x:event.clientX,y:event.clientY,buttons:event.buttons,valid:event.pointerType==='mouse'});};
    const clear=()=>{const active=this.petGesture.active(performance.now())||this.affection.value>0;this.petGesture.clear();this.affection.clear();clearTimeout(timer);if(active)onChange();};
    document.addEventListener('pointermove',move);if(!nativePointer)document.defaultView?.addEventListener('blur',clear);
    document.addEventListener('visibilitychange',clear);
    this.stopPetting=()=>{clearTimeout(timer);this.petGesture.clear();this.handlePetPointer=null;document.removeEventListener('pointermove',move);document.removeEventListener('visibilitychange',clear);document.defaultView?.removeEventListener('blur',clear);};
    return this.stopPetting;
  }
  loadIcon(source){
    this.iconSource=source;this.iconReady=false;
    if(this.iconImage){this.iconImage.onload=null;this.iconImage.onerror=null;}
    this.iconImage=null;
    if(!source)return;
    const svg=source.replace(/<svg\b([^>]*)>/,(_,attributes)=>`<svg${attributes.replace(/\s(?:xmlns|width|height)="[^"]*"/g,'')} xmlns="http://www.w3.org/2000/svg" width="128" height="128">`).replaceAll('currentColor','#ffffff');
    const image=new Image();this.iconImage=image;
    image.onload=()=>{this.iconReady=true;this.iconMaskSize='';this.needsDraw=true;if(this.lastOptions&&(!this.canDraw||this.canDraw()))this.draw(this.lastOptions);};
    image.onerror=()=>{console.error('Pixel icon: could not load the vector mask');};
    image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }
  rasterizeIcon(width,height,pitch){
    if(!this.iconReady)return;
    if(!this.iconMask){this.iconMask=document.createElement('canvas');this.iconContext=this.iconMask.getContext('2d',{willReadFrequently:true});}
    const size=width+','+height+','+pitch;if(this.iconMaskSize===size)return;
    this.iconMask.width=width*2;this.iconMask.height=height*2;
    this.iconContext.drawImage(this.iconImage,0,0,this.iconMask.width,this.iconMask.height);
    this.iconContext.globalCompositeOperation='source-in';this.iconContext.fillStyle='#ffffff';this.iconContext.fillRect(0,0,this.iconMask.width,this.iconMask.height);this.iconContext.globalCompositeOperation='source-over';
    this.iconField=pixelMaskField(this.iconContext.getImageData(0,0,this.iconMask.width,this.iconMask.height).data,this.iconMask.width,this.iconMask.height,pitch*2);
    this.iconMaskSize=size;
  }
  rasterizeVectors(shapes,pitch){
    if(shapes===this.lastVectorShapes&&pitch===this.vectorPitch)return this.vectorField;
    if(!this.vectorMask){this.vectorMask=document.createElement('canvas');this.vectorContext=this.vectorMask.getContext('2d',{willReadFrequently:true});}
    const width=(columns+2)*pitch*2,height=(rows+2)*pitch*2;
    if(this.vectorMask.width!==width||this.vectorMask.height!==height){this.vectorMask.width=width;this.vectorMask.height=height;}
    const ctx=this.vectorContext;ctx.resetTransform();ctx.clearRect(0,0,width,height);ctx.setTransform(pitch*2,0,0,pitch*2,pitch*2,pitch*2);ctx.fillStyle='#ffffff';
    for(const shape of shapes){
      ctx.beginPath();
      for(const points of shape.contours){ctx.moveTo(...points[0]);for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);ctx.closePath();}
      ctx.fill('evenodd');
    }
    this.lastVectorShapes=shapes;this.vectorPitch=pitch;
    this.vectorField=pixelMaskField(ctx.getImageData(0,0,width,height).data,width,height,pitch*2);
    return this.vectorField;
  }
  rasterizeCells(pitch){
    const key=this.pixels.join(',')+':'+pitch;
    if(key!==this.cellMaskKey){this.cellField=this.rasterizeVectors(pixelContours(this.pixels),pitch);this.cellMaskKey=key;}
    return this.cellField;
  }
  faceContours(pose,reducedMotion){
    const shapes=mood=>{
      const kind=mood==='wink'&&!reducedMotion?'neutral':mood;
      if(!this.faceShapes.has(kind))this.faceShapes.set(kind,pixelContours(pixelFrame({state:'idle',emotion:kind,reducedMotion:true}).cells));
      return this.faceShapes.get(kind);
    };
    let face=shapes(pose.mood);
    if(pose.transition<1&&pose.from!==pose.mood){
      const key=pose.from+':'+pose.mood;
      if(!this.facePlans.has(key))this.facePlans.set(key,pixelVectorPlan(shapes(pose.from),face));
      face=pixelVectorFrame(this.facePlans.get(key),pose.transition);
    }
    return reducedMotion?face:pixelPoseContours(face,pose);
  }
  draw(options,delta=1/60){
    this.needsDraw=false;
    this.lastOptions=options;
    const canPet=(options.state??'idle')==='idle'&&!options.paused&&!options.iconSource&&options.visible!==false;
    if(!canPet){this.petGesture.clear();this.affection.clear();}
    const now=performance.now(),petting=!!(canPet&&(options.petting||this.petGesture.active(now)));
    const affection=this.affection.update(petting,now,options.reducedMotion);
    const faceOptions=affection.heart?{...options,emotion:'love',hover:false,petting:true}:{...options,petting:false};
    const complete=completionKinds.has(options.state),processing=options.state==='preparing'||options.state==='busy';
    const wasProcessing=this.state==='preparing'||this.state==='busy';
    if(processing&&(!wasProcessing||this.processingSelection!==options.processing)){
      if(!wasProcessing)this.processingVisit=(this.processingVisit??0)+1;
      this.processingStart=options.time??0;this.processingSelection=options.processing;
    }
    if(this.state!==options.state){
      const outgoing=this.vectorShapes?.length?this.vectorShapes:pixelContours(this.pixels);
      this.outgoingCells=new Uint8Array(this.pixels);this.state=options.state;this.phaseStart=options.time??0;
      this.completionProgress=this.ready?0:1;this.completionPlan=null;
      if(complete){
        if(!this.completionTargets.has(options.state))this.completionTargets.set(options.state,pixelCompletionContours(options.state));
        this.completionPlan=pixelVectorPlan(outgoing,this.completionTargets.get(options.state));
      }
    }
    if(options.iconSource!==this.iconSource)this.loadIcon(options.iconSource);
    let progress=this.completionProgress||0;
    if(!complete)progress=0;
    else if(options.reducedMotion||!this.completionPlan?.length)progress=1;
    else progress=Math.min(1,progress+Math.max(0,delta)/completionDuration);
    this.completionProgress=progress;
    const phaseTime=(options.time??0)-this.phaseStart,recording=options.state==='recording'&&!options.paused;
    const processingOptions={...options,time:(options.time??0)-(this.processingStart??0),processingVisit:this.processingVisit??0};
    this.voiceLevel=recording?pixelAudioEnvelope(this.voiceLevel,clamp(options.level??0,0,1),delta,options.reducedMotion):0;
    const pose=pixelFacePose({...faceOptions,time:affection.heart?affection.time:phaseTime}),heights=pixelEqualizer(phaseTime,this.voiceLevel,options.reducedMotion);
    if(options.gaze?.length===2&&options.gaze.every(Number.isFinite)&&!options.reducedMotion&&!affection.heart){
      const blend=1-Math.exp(-Math.max(0,delta)/.09);this.gaze??=[0,0];
      this.gaze=this.gaze.map((value,index)=>value+(clamp(options.gaze[index],-2,2)-value)*blend);
      pose.gaze=this.gaze;pose.action='cursor';
    }else this.gaze=null;
    this.canvas.dataset.gaze=this.gaze?this.gaze.map(value=>value.toFixed(3)).join(','):'';
    if(affection.heart&&!options.reducedMotion){pose.gaze=[0,0];pose.bob=0;pose.tilt=0;pose.scale=1+Math.max(0,Math.sin(affection.time*Math.PI*2/.9))**2*.045;pose.action='heart-beat';}
    const vectors=complete?(progress<1?pixelVectorFrame(this.completionPlan,progress):this.completionTargets.get(options.state)):processing?pixelProcessingContours(processingOptions):recording?pixelEqualizerContours(heights):options.iconSource?null:this.faceContours(pose,options.reducedMotion);
    this.vectorShapes=vectors;
    const frame=pixelFrame(processing?processingOptions:{...faceOptions,time:phaseTime,level:this.voiceLevel});
    const {mood}=frame,cells=complete&&progress<1?this.outgoingCells:frame.cells;
    const blend=options.reducedMotion||processing||complete||!this.ready?1:1-Math.exp(-Math.max(0,delta)/.055);
    for(let i=0;i<cells.length;i++){this.values[i]+=(cells[i]-this.values[i])*blend;this.pixels[i]=Math.round(this.values[i]);}
    this.ready=true;this.canvas.dataset.emotion=mood;this.canvas.dataset.completion=progress.toFixed(3);this.canvas.dataset.transition=complete&&progress<1?'morph':affection.phase;this.canvas.dataset.geometry=vectors?'vector':'cells';
    this.canvas.dataset.faceState=complete||processing||recording?'':pose.action;this.canvas.dataset.equalizer=recording?heights.map(value=>value.toFixed(2)).join(','):'';
    this.canvas.dataset.processing=processing?pixelProcessingVariant(processingOptions):'';
    const opacity=affection.opacity*(processing?pixelProcessingOpacity(processingOptions):1);
    const dpr=Math.min(devicePixelRatio||1,2),width=Math.max(1,Math.round(this.canvas.clientWidth*dpr)),height=Math.max(1,Math.round(this.canvas.clientHeight*dpr));
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;}
    const {pitch,origin,center,gap}=pixelGeometry(width,height,dpr,options.pitch,options.center);
    this.interactionArea={center:center.map(value=>value/dpr),radius:[Math.max(32,columns*pitch/dpr/2+24),Math.max(28,rows*pitch/dpr/2+24)]};
    this.canvas.dataset.petting=petting?'true':'false';
    this.canvas.dataset.faceOpacity=opacity.toFixed(3);
    const power=this.empowermentEffect.update(options.iconSource?null:options.empowerment,delta,options.reducedMotion);
    this.canvas.dataset.empowerment=power.amount>.01?this.empowermentEffect.key:'';
    this.canvas.dataset.empowermentColor=options.empowerment?.color||'';
    const echoes=pixelHeartEchoes(affection.time,affection.heart?affection.opacity:0,options.reducedMotion);
    this.canvas.dataset.heartEchoes=echoes.filter(echo=>echo.opacity>.005).length.toString();
    const iconSize=options.iconSource?[width,height]:[(columns+2)*pitch,(rows+2)*pitch];
    const iconOrigin=options.iconSource?[0,0]:origin.map(value=>value-pitch);
    if(options.iconSource)this.rasterizeIcon(width,height,pitch);
    const field=options.iconSource?this.iconField:vectors?this.rasterizeVectors(vectors,pitch):this.rasterizeCells(pitch);
    const tint=options.tint||[.65,.7,1],brightness=clamp(.52+(options.brightness??.35)*.5,.15,1),visible=options.visible===false||options.iconSource&&!this.iconReady?0:1;
    this.canvas.dataset.gridOrigin=origin.join(',');this.canvas.dataset.pixelPitch=String(pitch);this.canvas.dataset.faceCenter=center.map(value=>value/dpr).join(',');
    const gl=this.gl;
    if(gl&&this.program&&!gl.isContextLost()&&this.canvas.dataset.fallback!=='true'){
      gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.disable(gl.BLEND);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.iconTexture);
      if(field&&field!==this.uploadedField){
        const size=field.width+','+field.height;
        if(size!==this.textureSize){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,field.width,field.height,0,gl.RGBA,gl.UNSIGNED_BYTE,field.data);this.textureSize=size;}
        else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,field.width,field.height,gl.RGBA,gl.UNSIGNED_BYTE,field.data);
        this.uploadedField=field;
      }
      gl.uniform1i(this.locations.uIconMask,0);gl.uniform2fv(this.locations.uIconOrigin,iconOrigin);gl.uniform2fv(this.locations.uIconSize,iconSize);
      gl.uniform3fv(this.locations.uEmpowermentColor,power.color);gl.uniform1f(this.locations.uEmpowerment,power.amount);gl.uniform1f(this.locations.uEmpowermentTime,power.age);
      gl.uniform1f(this.locations.uEmpowermentCount,options.reducedMotion?3:8);
      gl.uniform2f(this.locations.uResolution,width,height);gl.uniform3fv(this.locations.uTint,tint);
      gl.uniform1f(this.locations.uVoice,mood==='listening'?1:0);gl.uniform1f(this.locations.uAffection,affection.heart?1:0);gl.uniform1f(this.locations.uBrightness,brightness);gl.uniform2fv(this.locations.uCenter,center);
      gl.uniform1f(this.locations.uOpacity,opacity);gl.uniform2fv(this.locations.uEchoes,echoes.flatMap(echo=>[echo.scale,echo.opacity]));
      gl.uniform1f(this.locations.uPitch,pitch);gl.uniform1f(this.locations.uGap,gap);gl.uniform1f(this.locations.uInkOpacity,visible);
      // Clear the previous pose, then shade only the mask and visible heart
      // echoes. The generous petting canvas otherwise runs the shader on empty pixels.
      gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      if(visible&&opacity>0){
        const scale=Math.max(1,...echoes.filter(echo=>echo.opacity>0).map(echo=>echo.scale));
        const rectangle={x:center[0]+(iconOrigin[0]-center[0])*scale,y:center[1]+(iconOrigin[1]-center[1])*scale,width:iconSize[0]*scale,height:iconSize[1]*scale};
        gl.enable(gl.SCISSOR_TEST);gl.scissor(...surfaceScissor(width,height,power.amount>.001?[rectangle,{x:center[0]-16*pitch,y:center[1]-12*pitch,width:32*pitch,height:24*pitch}]:[rectangle],pitch));
        gl.drawArrays(gl.TRIANGLES,0,3);gl.disable(gl.SCISSOR_TEST);
      }
    }else if(this.context){
      const ctx=this.context;ctx.clearRect(0,0,width,height);
      if(field&&visible){
        const image=ctx.createImageData(width,height),layout={maskOrigin:iconOrigin,maskSize:iconSize,center,pitch,gap};
        const margin=affection.heart?pitch*8:0;
        const top=Math.max(0,Math.floor(iconOrigin[1]-margin)),bottom=Math.min(height,Math.ceil(iconOrigin[1]+iconSize[1]+margin)),left=Math.max(0,Math.floor(iconOrigin[0]-margin)),right=Math.min(width,Math.ceil(iconOrigin[0]+iconSize[0]+margin));
        for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
          const point=[x+.5,y+.5],alpha=pixelInkCoverage(field,point,layout)*brightness*opacity,i=(y*width+x)*4;
          let echoAlpha=0;
          if(affection.heart)for(const echo of echoes)if(echo.opacity>0)echoAlpha+=pixelInkCoverage(field,point,{...layout,scale:echo.scale})*echo.opacity*brightness*(1-echoAlpha);
          const total=alpha+echoAlpha*(1-alpha),ink=affection.heart?[255,46,66]:[239,245,235];
          for(let channel=0;channel<3;channel++)image.data[i+channel]=total?ink[channel]:0;
          image.data[i+3]=Math.round(total*255);
        }
        ctx.putImageData(image,0,0);
        if(power.amount>.001){
          ctx.globalCompositeOperation='destination-over';
          ctx.fillStyle='rgb('+power.color.map(value=>Math.round(value*255)).join(',')+')';
          for(const star of empowermentStars(power.age,options.reducedMotion)){
            ctx.globalAlpha=star.opacity*power.amount*.9;
            const unit=pitch*star.size,x=center[0]+star.x*pitch,y=center[1]+star.y*pitch;
            for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(Math.min(Math.abs(dx),Math.abs(dy))===0&&Math.abs(dx)+Math.abs(dy)<=2)ctx.fillRect(Math.round(x+dx*unit),Math.round(y+dy*unit),Math.ceil(unit),Math.ceil(unit));
          }
          ctx.globalAlpha=1;
          ctx.globalCompositeOperation='source-over';
        }
      }
    }
  }
  dispose(){
    this.stopPetting?.();
    this.lastOptions=null;if(this.iconImage){this.iconImage.onload=null;this.iconImage.onerror=null;}
    this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);
    if(this.gl){const gl=this.gl,node=this.canvas;gl.deleteProgram(this.program);gl.deleteTexture(this.iconTexture);gl.deleteVertexArray(this.vao);queueMicrotask(()=>{if(!node.isConnected)gl.getExtension('WEBGL_lose_context')?.loseContext();});}
  }
}
