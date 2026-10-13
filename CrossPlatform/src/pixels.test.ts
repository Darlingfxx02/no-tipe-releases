import { expect,test,vi } from 'vitest';
import { PixelRecorder,PixelPetting,PixelAffection,pixelHeartEchoes,pixelFrame,pixelGeometry,pixelPong,pixelProcessingContours } from './recorder/pixels.js';
import { pixelProcessingVariants,pixelProcessingVariant,pixelProcessingOpacity } from './recorder/processing.js';
import {pixelContours,pixelPongContours,pixelVectorPlan,pixelVectorFrame,pixelEqualizerContours,pixelPoseContours} from './recorder/vectors.js';
import {pixelMaskField,pixelRoundedIntersection,pixelInkCoverage} from './recorder/ink.js';
import {pixelFacePose,pixelVoiceDrive,pixelAudioEnvelope,pixelEqualizer} from './recorder/motion.js';
const lit=(cells:Uint8Array)=>Array.from(cells).filter(value=>value===255).length;
test('an icon mask finishing while hidden waits for reveal without drawing or reloading',()=>{
  const images:Array<{onload:(()=>void)|null;src:string}>=[];
  vi.stubGlobal('Image',class {onload=null;onerror=null;src='';constructor(){images.push(this);}});
  try{
    let visible=false;
    const draw=vi.fn();
    const renderer=Object.assign(Object.create(PixelRecorder.prototype),{lastOptions:{iconSource:'<svg/>'},canDraw:()=>visible,draw});
    renderer.loadIcon('<svg/>');expect(images).toHaveLength(1);
    images[0].onload?.();
    expect(draw).not.toHaveBeenCalled();expect(renderer.iconReady).toBe(true);expect(renderer.needsDraw).toBe(true);
    visible=true;renderer.draw(renderer.lastOptions);
    expect(draw).toHaveBeenCalledOnce();expect(images).toHaveLength(1);
  }finally{vi.unstubAllGlobals();}
});
test('the face fades completely before the heart appears, and the return is equally soft',()=>{
  const fade=new PixelAffection();expect(fade.update(false,0).opacity).toBe(1);
  fade.update(true,0);
  const eyes=fade.update(true,120),dark=fade.update(true,243),heart=fade.update(true,390),shown=fade.update(true,540);
  expect(eyes.heart).toBe(false);expect(eyes.opacity).toBeGreaterThan(.1);expect(eyes.opacity).toBeLessThan(.9);
  expect(dark.opacity).toBeCloseTo(0,8);expect(heart.heart).toBe(true);expect(heart.opacity).toBeGreaterThan(.1);expect(heart.opacity).toBeLessThan(.9);expect(shown.opacity).toBe(1);
  expect(fade.update(false,540).opacity).toBe(1);
  const leaving=fade.update(false,660);expect(leaving.heart).toBe(true);expect(leaving.opacity).toBeLessThan(1);
  expect(fade.update(false,837).opacity).toBeCloseTo(0,8);
  const returning=fade.update(false,960);expect(returning.heart).toBe(false);expect(returning.opacity).toBeGreaterThan(0);expect(returning.opacity).toBeLessThan(1);
  expect(fade.update(false,1080)).toMatchObject({heart:false,opacity:1,phase:'steady'});
});
test('renewing petting reverses a fade without jumping; reduced motion and working states can reset it',()=>{
  const fade=new PixelAffection();fade.update(true,0);fade.update(true,540);fade.update(false,540);
  const outgoing=fade.update(false,660),reversed=fade.update(true,660);
  expect(reversed.heart).toBe(outgoing.heart);expect(reversed.opacity).toBe(outgoing.opacity);expect(reversed.time).toBe(outgoing.time);
  expect(fade.update(true,700).opacity).toBeGreaterThan(reversed.opacity);
  expect(fade.update(true,750,true)).toMatchObject({heart:true,opacity:1});
  expect(fade.update(false,800,true)).toMatchObject({heart:false,opacity:1});
  fade.update(true,900,true);fade.clear();expect(fade.update(false,910)).toMatchObject({heart:false,opacity:1,time:0});
});
test('filled heart echoes expand, each new emission is dimmer, and they dissolve with the reaction',()=>{
  const early=pixelHeartEchoes(.3),later=pixelHeartEchoes(1.3);
  expect(later[0].scale).toBeGreaterThan(early[0].scale);
  const emissions=[pixelHeartEchoes(.3)[0],pixelHeartEchoes(1)[1],pixelHeartEchoes(1.7)[2],pixelHeartEchoes(2.4)[0]];
  for(let i=1;i<emissions.length;i++){expect(emissions[i].opacity).toBeLessThan(emissions[i-1].opacity);expect(emissions[i].scale).toBeCloseTo(emissions[0].scale);}
  expect(pixelHeartEchoes(2.099)[0].opacity).toBeLessThan(.001);
  for(const time of [0,.3,1.3,3,10])for(const echo of pixelHeartEchoes(time)){expect(echo.scale).toBeGreaterThanOrEqual(1);expect(echo.scale).toBeLessThanOrEqual(2.35);expect(echo.opacity).toBeGreaterThanOrEqual(0);expect(echo.opacity).toBeLessThan(1);}
  expect(pixelHeartEchoes(2,0).every(echo=>echo.opacity===0)).toBe(true);
  expect(pixelHeartEchoes(2,1,true).every(echo=>echo.opacity===0)).toBe(true);
});
test('petting reacts to strokes and circles, holds briefly and renews while stroked',()=>{
  for(const points of [[[0,0],[20,0],[-12,0],[18,0]],[[18,0],[0,18],[-18,0],[0,-18]]]){
    const pet=new PixelPetting();points.forEach(([x,y],i)=>pet.move(x,y,i*60));
    expect(pet.active(180)).toBe(true);expect(pet.active(1979)).toBe(true);expect(pet.active(1980)).toBe(false);
    pet.move(10,0,350);expect(pet.active(2149)).toBe(true);expect(pet.active(2150)).toBe(false);
  }
});
test('hovering, jitter, a straight pass and movement away from the face do not count as petting',()=>{
  for(const points of [Array.from({length:8},()=>[0,0]),[[0,0],[.5,0],[0,.5],[.5,.5]],[[0,0],[15,0],[30,0],[45,0]],[[0,0],[100,0],[0,0],[100,0]]]){
    const pet=new PixelPetting();points.forEach(([x,y],i)=>pet.move(x,y,i*60));expect(pet.active(480)).toBe(false);
  }
  const pet=new PixelPetting();pet.move(0,0,0);pet.move(20,0,60);pet.move(0,0,120,false);pet.move(-20,0,180);
  expect(pet.active(180)).toBe(false);
  pet.move(0,0,900);expect(pet.active(900)).toBe(false);
});
test('slow circular strokes count regardless of the cursor sampling rate',()=>{
  for(const samples of [24,64,120]){
    const pet=new PixelPetting();
    for(let i=0;i<=samples;i++){const angle=i/samples*Math.PI*2;pet.move(Math.cos(angle)*25,Math.sin(angle)*25,i/samples*2400);}
    expect(pet.active(2400)).toBe(true);
  }
});
test('native cursor samples pet a click-through unfocused robot and stop on held buttons or disposal',()=>{
  vi.useFakeTimers({toFake:['performance','setTimeout','clearTimeout']});
  try{
    const window=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false,defaultView:window});
    const canvas={hidden:false,clientWidth:282,clientHeight:255,getBoundingClientRect:()=>({left:100,top:200,width:282,height:255})};
    const renderer=Object.assign(Object.create(PixelRecorder.prototype),{canvas,petGesture:new PixelPetting(),affection:new PixelAffection(),lastOptions:{state:'idle'},interactionArea:{center:[141,127.5],radius:[55.5,40.5]}});
    const changed=vi.fn(),stop=renderer.attachPetting({ownerDocument:document,isConnected:true},changed,{nativePointer:true});
    // Around the body, outside its native clickable rectangle. No DOM move,
    // focus event or mouse click is delivered to this fixture.
    const stroke=()=>{for(let i=0;i<=32;i++){const angle=i/32*Math.PI*2;vi.advanceTimersByTime(32);renderer.petPointer({x:241+53*Math.cos(angle),y:327.5+38*Math.sin(angle),buttons:0,valid:true});}};
    stroke();expect(renderer.petGesture.active(performance.now())).toBe(true);expect(changed).toHaveBeenCalled();
    window.dispatchEvent(new Event('blur'));expect(renderer.petGesture.active(performance.now())).toBe(true);
    renderer.petPointer({x:241,y:327.5,buttons:1,valid:true});expect(renderer.petGesture.active(performance.now())).toBe(false);
    renderer.lastOptions.state='recording';stroke();expect(renderer.petGesture.active(performance.now())).toBe(false);
    renderer.lastOptions.state='idle';stroke();expect(renderer.petGesture.active(performance.now())).toBe(true);
    stop();changed.mockClear();stroke();vi.advanceTimersByTime(2000);expect(changed).not.toHaveBeenCalled();expect(renderer.petGesture.active(performance.now())).toBe(false);
  }finally{vi.useRealTimers();}
});
test('petting overrides the idle expression but preserves every working indicator and reduced motion',()=>{
  expect(pixelFrame({emotion:'neutral',hover:true,petting:true}).mood).toBe('love');
  expect(pixelFrame({emotion:'neutral',petting:true,reducedMotion:true}).cells).toEqual(pixelFrame({emotion:'love',reducedMotion:true}).cells);
  for(const state of ['recording','preparing','busy','result','copied','failed'])for(const paused of [false,true]){
    expect(pixelFrame({state,paused,emotion:'neutral',petting:true})).toEqual(pixelFrame({state,paused,emotion:'neutral'}));
  }
});
test('a quiet microphone stays flat while speech increases the meter',()=>{
  const quiet=pixelFrame({state:'recording',level:0,time:2}),speech=pixelFrame({state:'recording',level:.9,time:2});
  expect(lit(quiet.cells)).toBe(7);expect(lit(speech.cells)).toBeGreaterThan(30);
});
test('pause and outcomes override the idle expression',()=>{
  expect(pixelFrame({state:'recording',paused:true,level:1}).mood).toBe('sleepy');
  for(const [state,mood] of [['result','check'],['copied','copy'],['failed','alert'],['preparing','thinking'],['busy','thinking']])expect(pixelFrame({state,emotion:'love'}).mood).toBe(mood);
});
test('all expressions fit the shared grid and remain visible',()=>{
  for(const emotion of ['auto','neutral','happy','wink','curious','love','focused','surprised','joy','squint','playful','star']){const {cells}=pixelFrame({emotion,time:2});expect(cells).toHaveLength(231);expect(lit(cells)).toBeGreaterThan(10);}
});
test('completion symbols remain readable regardless of idle mood, hover or time',()=>{
  for(const state of ['result','copied','failed'])expect(pixelFrame({state,time:2,emotion:'neutral'})).toEqual(pixelFrame({state,time:25,emotion:'love',hover:true,paused:true}));
  expect(pixelFrame({state:'result'}).cells).not.toEqual(pixelFrame({state:'copied'}).cells);
});
test('reduced motion freezes blinking, moods and processing movement',()=>{
  for(const state of ['idle','preparing','busy'])expect(pixelFrame({state,time:2,reducedMotion:true})).toEqual(pixelFrame({state,time:25,reducedMotion:true}));
});
test('voice bars stay centered at every volume',()=>{
  for(const level of [0,.15,.5,1])for(const time of [0,1,3,7]){const {cells}=pixelFrame({state:'recording',level,time});for(let y=0;y<11;y++)for(let x=0;x<21;x++)expect(cells[y*21+x]).toBe(cells[y*21+20-x]);}
});
test('the grid uses whole device pixels without shifting its center',()=>{
  for(const dpr of [1,1.5,2])for(const scale of [.6,.8,1]){const requested=[141,127.5],grid=pixelGeometry(282*dpr,255*dpr,dpr,3*scale,requested);expect(Number.isInteger(grid.pitch)).toBe(true);expect(grid.gap).toBeGreaterThan(0);expect(grid.origin.every(Number.isInteger)).toBe(true);grid.center.forEach((value,i)=>expect(Math.abs(value-requested[i]*dpr)).toBeLessThanOrEqual(.5));}
});
test('Pong stays inside the grid and every paddle return meets the ball',()=>{
  for(let frame=0;frame<1800;frame++){
    const {ball,left,right}=pixelPong(frame/60);
    expect(ball.x).toBeGreaterThanOrEqual(4.5);expect(ball.x).toBeLessThanOrEqual(15.5);
    expect(ball.y).toBeGreaterThanOrEqual(1.5);expect(ball.y).toBeLessThanOrEqual(8.5);
    for(const paddle of [left,right]){expect(paddle).toBeGreaterThanOrEqual(2);expect(paddle).toBeLessThanOrEqual(8);}
  }
  for(let impact=0;impact<30;impact++){
    const time=impact*1.1,{ball,left,right}=pixelPong(time),paddle=impact%2?right:left;
    expect(ball.x).toBeCloseTo(impact%2?15.5:4.5);
    expect(Math.abs(ball.y-paddle)).toBeLessThanOrEqual(1);
    const before=pixelPong(time-.01).ball.x,after=pixelPong(time+.01).ball.x;
    if(impact%2){expect(before).toBeLessThan(ball.x);expect(after).toBeLessThan(ball.x);}
    else{expect(before).toBeGreaterThan(ball.x);expect(after).toBeGreaterThan(ball.x);}
  }
});
test('connected silhouettes preserve holes and separate disconnected parts',()=>{
  const ring=pixelContours(new Uint8Array([255,255,255,255,0,255,255,255,255]),3,3);
  expect(ring).toHaveLength(1);expect(ring[0].contours).toHaveLength(2);
  expect(pixelContours(new Uint8Array([255,0,0,255]),2,2)).toHaveLength(2);
  const eyes=pixelContours(pixelFrame({emotion:'neutral',time:2,reducedMotion:true}).cells);
  expect(eyes).toHaveLength(2);expect(eyes.every(shape=>shape.contours.length===1)).toBe(true);
});
test('Pong geometry moves continuously between display cells',()=>{
  const a=pixelPongContours(pixelPong(.234)),b=pixelPongContours(pixelPong(.235));
  const motion=b[1].contours[0][0][0]-a[1].contours[0][0][0];
  expect(motion).toBeGreaterThan(0);expect(motion).toBeLessThan(.02);
  expect(motion).toBeCloseTo(pixelPong(.235).ball.x-pixelPong(.234).ball.x,8);
});
test('processing games fit both recorder layouts, animate and freeze with reduced motion',()=>{
  for(const processing of pixelProcessingVariants){
    const frames=new Set<string>();
    for(let i=0;i<240;i++){
      const time=i/10,shapes=pixelProcessingContours({processing,time});
      expect(shapes.length).toBeGreaterThan(0);
      for(const shape of shapes)for(const contour of shape.contours)for(const [x,y] of contour){
        expect(Number.isFinite(x)&&Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);expect(x).toBeLessThanOrEqual(21);
        expect(y).toBeGreaterThanOrEqual(0);expect(y).toBeLessThanOrEqual(11);
      }
      frames.add(JSON.stringify(pixelFrame({state:'preparing',processing,time}).cells));
    }
    expect(frames.size).toBeGreaterThan(10);
    for(const state of ['preparing','busy']){
      expect(pixelFrame({state,processing,time:2,reducedMotion:true})).toEqual(pixelFrame({state,processing,time:25,reducedMotion:true}));
      expect(pixelProcessingContours({processing,time:2,reducedMotion:true})).toEqual(pixelProcessingContours({processing,time:25,reducedMotion:true}));
    }
    expect(pixelFrame({state:'recording',processing,time:2})).toEqual(pixelFrame({state:'recording',processing:'pong',time:2}));
  }
},20_000); // Exhaustive frame sampling can exceed 5 seconds on shared Windows CI.
test('auto rotates games by visit and every eight seconds with a fade through zero',()=>{
  for(let visit=0;visit<8;visit++){
    expect(pixelProcessingVariant({processingVisit:visit,time:0})).toBe(pixelProcessingVariants[visit%4]);
    expect(pixelProcessingVariant({processingVisit:visit,time:8})).toBe(pixelProcessingVariants[(visit+1)%4]);
    expect(pixelProcessingVariant({processingVisit:visit,time:80,reducedMotion:true})).toBe(pixelProcessingVariants[visit%4]);
  }
  expect(pixelProcessingVariant({processing:'unknown'})).toBe('pong');
  expect(pixelProcessingOpacity({time:7.99})).toBeLessThan(.01);
  expect(pixelProcessingOpacity({time:8})).toBe(0);
  expect(pixelProcessingOpacity({time:8.01})).toBeLessThan(.01);
  expect(pixelProcessingOpacity({time:8.2})).toBe(1);
  for(const processing of pixelProcessingVariants){expect(pixelProcessingVariant({processing,time:80})).toBe(processing);expect(pixelProcessingOpacity({processing,time:8})).toBe(1);}
  expect(pixelProcessingOpacity({time:8,reducedMotion:true})).toBe(1);
});
test('whole contours morph continuously with exact endpoints and interruption positions',()=>{
  const source=pixelContours(pixelFrame({emotion:'curious',time:2,reducedMotion:true}).cells);
  const destination=pixelContours(pixelFrame({state:'copied'}).cells);
  const plan=pixelVectorPlan(source,destination),start=pixelVectorFrame(plan,0),end=pixelVectorFrame(plan,1);
  expect(new Set(start.map(shape=>JSON.stringify(shape)))).toEqual(new Set(source.map(shape=>JSON.stringify(shape))));
  expect(new Set(end.map(shape=>JSON.stringify(shape)))).toEqual(new Set(destination.map(shape=>JSON.stringify(shape))));
  const previous=pixelVectorFrame(plan,.499),next=pixelVectorFrame(plan,.5);
  let moving=0;
  next.forEach((shape,i)=>shape.contours.forEach((contour,j)=>contour.forEach((point,k)=>{
    const distance=Math.hypot(point[0]-previous[i].contours[j][k][0],point[1]-previous[i].contours[j][k][1]);
    expect(distance).toBeLessThan(.04);if(distance>0)moving++;
  })));
  expect(moving).toBeGreaterThan(100);
  const interrupted=pixelVectorPlan(next,source);
  expect(new Set(pixelVectorFrame(interrupted,0).map(shape=>JSON.stringify(shape)))).toEqual(new Set(next.map(shape=>JSON.stringify(shape))));
});
test('a complete contour follows a curved path instead of translating linearly',()=>{
  const source={contours:[[[0,0],[2,0],[2,2],[0,2]]]},target={contours:[[[8,0],[10,0],[10,2],[8,2]]]};
  const plan=pixelVectorPlan([source],[target]),middle=pixelVectorFrame(plan,.5)[0].contours[0];
  const center=middle.reduce((sum,p)=>[sum[0]+p[0]/middle.length,sum[1]+p[1]/middle.length],[0,0]);
  expect(center[0]).toBeCloseTo(5);expect(center[1]).toBeGreaterThan(1.5);
  const quarter=pixelVectorFrame(plan,.25)[0].contours[0];
  expect(quarter.reduce((sum,p)=>sum+p[0]/quarter.length,0)).toBeLessThan(2);
});
test('the error symbol is centered with a separate dot',()=>{
  const {cells}=pixelFrame({state:'failed'}),shapes=pixelContours(cells);
  expect(shapes).toHaveLength(2);
  for(let y=0;y<11;y++)for(let x=0;x<21;x++)expect(cells[y*21+x]).toBe(cells[y*21+20-x]);
  expect(cells.slice(7*21,8*21).every(value=>value===0)).toBe(true);
});
test('the field follows the original silhouette and round cuts keep the row interiors full',()=>{
  const rgba=new Uint8Array(9*9*4);
  for(let y=2;y<7;y++)for(let x=2;x<7;x++)rgba[(y*9+x)*4+3]=255;
  const field=pixelMaskField(rgba,9,9,2);
  expect(field.values[4*9+4]).toBeLessThan(-1);
  expect(field.values[0]).toBeGreaterThan(0);
  const index=4*9+2,decoded=((field.data[index*4]*256+field.data[index*4+1])/65535-.5)*16;
  expect(decoded).toBeCloseTo(field.values[index],3);
  expect(pixelRoundedIntersection(0,0,.16)).toBeGreaterThan(0);
  expect(pixelRoundedIntersection(0,-1,.16)).toBeCloseTo(0);
  expect(pixelRoundedIntersection(-1,-1,.16)).toBeLessThan(0);
  expect(pixelRoundedIntersection(-2,-1,.32)).toBe(-1);
  const layout={maskOrigin:[0,0],maskSize:[9,9],center:[4.5,4.5],pitch:3,gap:1};
  expect(pixelInkCoverage(field,[-1,-1],layout)).toBe(0);
});
test('idle holds each emotion while several gestures and pauses play inside it',()=>{
  const poses=Array.from({length:5401},(_,i)=>pixelFacePose({time:i/60}));
  expect(new Set(poses.map(pose=>pose.mood)).size).toBeGreaterThanOrEqual(5);
  let lastChange=0,changes=0,actions=new Set<string>();
  for(let i=1;i<poses.length;i++){
    const previous=poses[i-1],pose=poses[i];
    if(pose.mood!==previous.mood){
      const duration=(i-lastChange)/60;
      expect(duration).toBeGreaterThanOrEqual(6.75);expect(duration).toBeLessThanOrEqual(9.05);
      expect(actions.has('rest')).toBe(true);expect([...actions].filter(action=>action!=='rest').length).toBeGreaterThanOrEqual(3);
      lastChange=i;changes++;actions=new Set();
    }
    actions.add(pose.action);
    expect(Math.hypot(pose.gaze[0]-previous.gaze[0],pose.gaze[1]-previous.gaze[1])).toBeLessThan(.14);
    for(const blink of [pose.leftBlink,pose.rightBlink]){expect(blink).toBeGreaterThanOrEqual(0);expect(blink).toBeLessThanOrEqual(1);}
  }
  expect(changes).toBeGreaterThanOrEqual(9);
  expect(poses.some(pose=>pose.leftBlink>.1&&pose.leftBlink<.9)).toBe(true);
  expect(poses.some(pose=>pose.rightBlink-pose.leftBlink>.6)).toBe(true);
  expect(poses.some(pose=>pose.leftTilt*pose.rightTilt<0)).toBe(true);
  expect(poses.some(pose=>pose.leftOpen<.9)).toBe(true);
});
test('fixed expressions have several behaviors and vary them on later visits',()=>{
  for(const emotion of ['neutral','happy','wink','curious','love','focused','surprised','joy','squint','playful','star']){
    const actions=new Set<string>(),visits:string[][]=[[]];let previous='';
    for(let i=0;i<1800;i++){
      const pose=pixelFacePose({emotion,time:i/60});
      expect(pose.mood).toBe(emotion);actions.add(pose.action);
      if(pose.action!==previous){visits[Math.floor(i/480)]??=[];visits[Math.floor(i/480)].push(pose.action);previous=pose.action;}
    }
    expect(actions.has('rest')).toBe(true);
    expect([...actions].filter(action=>action!=='rest').length).toBeGreaterThanOrEqual(3);
    expect(new Set(visits.map(actions=>actions.join(','))).size).toBeGreaterThan(1);
    const signature=({wink:'wink',focused:'scan',surprised:'stretch',joy:'giggle',star:'sparkle',love:'heart-beat'} as Record<string,string>)[emotion];
    if(signature)expect(actions.has(signature)).toBe(true);
  }
  // Seeking backward after a long run must reproduce the same behavior.
  const before=pixelFacePose({time:12.345});pixelFacePose({time:200});
  expect(pixelFacePose({time:12.345})).toEqual(before);
});
test('pose transforms stay inside the face grid and reduced motion remains still',()=>{
  for(const emotion of ['neutral','happy','wink','curious','love','focused','surprised','joy','squint','playful','star']){
    const source=pixelContours(pixelFrame({emotion,reducedMotion:true}).cells);
    const still=pixelFacePose({emotion,time:2,reducedMotion:true});
    expect(still).toEqual(pixelFacePose({emotion,time:25,reducedMotion:true}));
    expect(pixelPoseContours(source,still)).toEqual(source);
    for(let i=0;i<180;i++){
      const shapes=pixelPoseContours(source,pixelFacePose({emotion,time:i/60}));
      for(const shape of shapes)for(const contour of shape.contours)for(const [x,y] of contour){expect(x).toBeGreaterThan(0);expect(x).toBeLessThan(21);expect(y).toBeGreaterThan(0);expect(y).toBeLessThan(11);}
    }
  }
  expect(pixelFacePose({time:2,reducedMotion:true})).toEqual(pixelFacePose({time:25,reducedMotion:true}));
});
test('recording reacts quickly to voice peaks and releases smoothly to silence',()=>{
  expect(pixelVoiceDrive(.02,.03)).toBe(0);
  expect(pixelVoiceDrive(.12,.6)).toBeGreaterThan(pixelVoiceDrive(.12));
  expect(pixelVoiceDrive(1,1)).toBe(1);
  const attack=pixelAudioEnvelope(0,1,.03),release=pixelAudioEnvelope(1,0,.03);
  expect(attack).toBeGreaterThan(.9);expect(release).toBeGreaterThan(.65);expect(release).toBeLessThan(.75);
  expect(pixelAudioEnvelope(1,0,.4)).toBeLessThan(.01);
  expect(pixelAudioEnvelope(.2,.9,0)).toBe(.2);
  expect(pixelAudioEnvelope(.2,.9,.01,true)).toBe(.9);
});
test('the equalizer moves between cells while staying symmetric, centered and quiet without voice',()=>{
  for(let frame=0;frame<120;frame++){
    const time=frame/60,heights=pixelEqualizer(time,.8),next=pixelEqualizer(time+.001,.8);
    expect(pixelEqualizer(time,0)).toEqual(Array(7).fill(1));
    expect(heights).toEqual([...heights].reverse());
    expect(heights.every(value=>value>=1&&value<=9)).toBe(true);
    expect(heights.some(value=>!Number.isInteger(value))).toBe(true);
    heights.forEach((value,i)=>expect(Math.abs(value-next[i])).toBeLessThan(.03));
    for(const shape of pixelEqualizerContours(heights)){
      const points=shape.contours[0],ys=points.map(p=>p[1]);
      expect((Math.min(...ys)+Math.max(...ys))/2).toBeCloseTo(5.5);
    }
  }
  expect(pixelEqualizer(0,.8)).not.toEqual(pixelEqualizer(.1,.8));
  expect(pixelEqualizer(2,.8,true)).toEqual(pixelEqualizer(25,.8,true));
});
