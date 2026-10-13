const faceBehaviors={
  neutral:['look-around','eye-sway','double-blink','tilt','peek','stretch'],
  curious:['look-around','peek','tilt','double-blink','squint','glance-up'],
  happy:['eye-sway','nod','double-blink','tilt','giggle','look-around'],
  wink:['wink','eye-sway','peek','nod','double-blink'],
  focused:['scan','squint','look-down','double-blink','tilt'],
  surprised:['glance-up','peek','eye-sway','stretch','double-blink'],
  joy:['giggle','eye-sway','nod','double-blink','look-around'],
  playful:['eye-sway','peek','wink','tilt','double-blink'],
  star:['sparkle','eye-sway','nod','glance-up'],
  love:['heart-beat','sway','nod','tilt'],
  squint:['scan','nod','peek','eye-sway','double-blink'],
  sleepy:['sway','slow-blink','look-down'],
};
const faceMoods=['neutral','neutral','neutral','curious','happy','happy','wink','focused','surprised','joy','playful','star','love','squint'];
const faceSignatures={wink:'wink',focused:'scan',surprised:'stretch',joy:'giggle',star:'sparkle',love:'heart-beat'};
const faceEpisodes=[],faceActionPlans=new Map();
// Repeatable choices let native/preview renderers seek the same animation.
// Each visit selects new actions and pauses rather than replaying one loop.
const faceRandom=(index,salt)=>{
  let value=Math.imul(index+1,0x9e3779b1)^Math.imul(salt+1,0x85ebca6b);
  value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);
  return ((value^(value>>>16))>>>0)/4294967296;
};
function faceEpisodeAt(time){
  while(!faceEpisodes.length||faceEpisodes[faceEpisodes.length-1].end<=time){
    const index=faceEpisodes.length,previous=faceEpisodes[index-1],from=previous?.mood||'neutral';
    const choices=faceMoods.filter(mood=>mood!==from);
    const mood=index?choices[Math.floor(faceRandom(index,0)*choices.length)]:'neutral';
    const duration=index?6.8+faceRandom(index,1)*2.2:7.8,start=previous?.end||0;
    faceEpisodes.push({index,mood,from,start,end:start+duration,duration});
  }
  let low=0,high=faceEpisodes.length-1;
  while(low<high){const middle=(low+high)>>1;if(time<faceEpisodes[middle].end)high=middle;else low=middle+1;}
  return faceEpisodes[low];
}
function faceActionPlan(mood,episode){
  const key=mood+':'+episode.index;
  if(faceActionPlans.has(key))return faceActionPlans.get(key);
  const available=[...(faceBehaviors[mood]||faceBehaviors.neutral)],actions=[];
  const count=Math.min(available.length,3+Math.floor(faceRandom(episode.index,2)*2));
  const signature=faceSignatures[mood],signatureSlot=Math.floor(faceRandom(episode.index,3)*count);
  // Keep the expression's characteristic gesture, with a different place in
  // each visit. The remaining gestures are sampled without repetition.
  if(signature)available.splice(available.indexOf(signature),1);
  let at=0;
  for(let i=0;i<count;i++){
    const chosen=Math.floor(faceRandom(episode.index,10+i)*available.length),kind=signature&&i===signatureSlot?signature:available.splice(chosen,1)[0];
    const duration=1.05+faceRandom(episode.index,20+i)*.6,gap=.3+faceRandom(episode.index,30+i)*.5;
    actions.push({kind,start:at,duration,direction:faceRandom(episode.index,40+i)>.5?1:-1});at+=duration+gap;
  }
  // Reserve quiet arrival/exit time so expression changes begin at rest.
  const scale=(episode.duration-1.1)/at;
  const plan=actions.map(action=>({...action,start:.55+action.start*scale,duration:action.duration*scale}));
  faceActionPlans.set(key,plan);return plan;
}
const faceEase=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
const facePulse=(time,start=0,end=1)=>Math.sin(Math.PI*faceEase((time-start)/(end-start)))**2;
const eyelid=(time,start,duration=.22)=>{
  const t=(time-start)/duration;
  return t<0||t>1?0:t<.38?faceEase(t/.38):1-faceEase((t-.38)/.62);
};
function faceLook(time,stops){
  const index=stops.findIndex(stop=>stop[0]>=time);
  if(index<=0)return stops[0].slice(1);
  const a=stops[index-1],b=stops[index],t=faceEase((time-a[0])/(b[0]-a[0]));
  return [a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
}
export function pixelFacePose({time=0,emotion='auto',hover=false,paused=false,reducedMotion=false}={}){
  const auto=emotion==='auto'&&!paused&&!hover,restMood=paused?'sleepy':hover?'happy':auto?'neutral':emotion;
  const pose={mood:restMood,from:restMood,transition:1,action:'rest',gaze:[0,0],bob:0,tilt:0,scale:1,leftBlink:0,rightBlink:0,leftTilt:0,rightTilt:0,leftOpen:1,rightOpen:1};
  if(reducedMotion)return pose;
  time=Math.max(0,time);
  const episode=faceEpisodeAt(time),local=time-episode.start,resting=paused?.25:1;
  if(auto){pose.mood=episode.mood;pose.from=episode.from;pose.transition=faceEase(local/.32);}
  pose.gaze=[(Math.sin(time*1.7)*.04+Math.sin(time*2.9)*.025)*resting,Math.sin(time*2.1)*.03*resting];
  pose.bob=Math.sin(time*2.4)*.025*resting;pose.tilt=Math.sin(time*1.9)*.009*resting;pose.scale+=Math.sin(time*2.8)*.006*resting;
  const blinkCycle=Math.floor(time/4.6),blinkTime=time-blinkCycle*4.6,blinkStart=.8+faceRandom(blinkCycle,50)*2.8;
  pose.leftBlink=eyelid(blinkTime,blinkStart);pose.rightBlink=eyelid(blinkTime,blinkStart+.018);
  const action=faceActionPlan(pose.mood,episode).find(action=>local>=action.start&&local<action.start+action.duration);
  if(!action)return pose;
  pose.action=action.kind;
  const p=(local-action.start)/action.duration,pulse=facePulse(p)*resting,wave=Math.sin(p*Math.PI*4)*pulse,dir=action.direction;
  const look=(x,y)=>{pose.gaze[0]+=x*resting;pose.gaze[1]+=y*resting;};
  switch(action.kind){
    case 'look-around':
      look(...faceLook(p,[[0,0,0],[.2,dir*.7,-.12],[.43,dir*.7,-.12],[.65,-dir*.45,.1],[.82,-dir*.45,.1],[1,0,0]]));break;
    case 'peek':
      look(...faceLook(p,[[0,0,0],[.28,dir*.85,.12],[.62,dir*.85,.12],[1,0,0]]));pose.tilt+=dir*.04*pulse;break;
    case 'scan':
      look(...faceLook(p,[[0,0,0],[.2,-dir*.6,.08],[.72,dir*.6,.08],[1,0,0]]));break;
    case 'glance-up':case 'look-down':
      look(dir*.18*pulse,(action.kind==='glance-up'?-.45:.35)*pulse);break;
    case 'eye-sway':
      look(wave*.4,0);pose.leftTilt+=wave*.075;pose.rightTilt-=wave*.075;pose.bob+=wave*.1;break;
    case 'sway':
      look(Math.sin(p*Math.PI*2)*pulse*.45,0);pose.tilt+=Math.sin(p*Math.PI*2)*pulse*.08;break;
    case 'tilt':
      pose.tilt+=dir*.075*pulse;pose.leftTilt+=dir*.025*pulse;pose.rightTilt-=dir*.025*pulse;look(dir*.2*pulse,0);break;
    case 'nod':
      pose.bob+=wave*.3;pose.scale+=pulse*.02;break;
    case 'stretch':
      pose.leftOpen+=pulse*.13;pose.rightOpen+=pulse*.13;pose.scale+=pulse*.025;break;
    case 'squint':
      pose.leftOpen-=pulse*.32;pose.rightOpen-=pulse*.32;pose.tilt+=dir*.025*pulse;break;
    case 'double-blink':case 'slow-blink':{
      const left=action.kind==='slow-blink'?eyelid(p,.21,.52):Math.max(eyelid(p,.18,.16),eyelid(p,.47,.18));
      const right=action.kind==='slow-blink'?eyelid(p,.23,.52):Math.max(eyelid(p,.2,.16),eyelid(p,.49,.18));
      pose.leftBlink=Math.max(pose.leftBlink,left);pose.rightBlink=Math.max(pose.rightBlink,right);break;
    }
    case 'wink':
      pose.rightBlink=Math.max(pose.rightBlink,eyelid(p,.18,.6));pose.leftOpen-=pulse*.1;pose.tilt+=dir*.05*pulse;break;
    case 'giggle':
      pose.bob+=wave*.24;pose.leftOpen-=pulse*.2;pose.rightOpen-=pulse*.2;pose.tilt+=wave*.025;break;
    case 'sparkle':
      pose.scale+=pulse*.075;pose.leftOpen+=wave*.1;pose.rightOpen-=wave*.1;break;
    case 'heart-beat':{
      const beat=(facePulse(p,.12,.38)+facePulse(p,.47,.68)*.7)*resting;
      pose.scale+=beat*.11;pose.bob-=beat*.06;pose.tilt+=Math.sin(p*Math.PI*2)*pulse*.025;break;
    }
  }
  return pose;
}
export function pixelVoiceDrive(average,peak=average){
  const value=Math.max(0,Math.min(1,Math.max(average,peak*.84)));
  return Math.pow(Math.max(0,(value-.03)/.97),.58);
}
export function pixelAudioEnvelope(previous,target,delta,reducedMotion=false){
  if(reducedMotion)return target;
  const response=target>previous?.012:.08;
  return previous+(target-previous)*(1-Math.exp(-Math.max(0,delta)/response));
}
export function pixelEqualizer(time=0,level=0,reducedMotion=false){
  const drive=Math.max(0,Math.min(1,level)),t=reducedMotion?0:time;
  return Array.from({length:7},(_,i)=>{
    const distance=Math.abs(i-3),envelope=1-distance*.13;
    const swing=.5+.5*Math.sin(t*(12.5+distance*1.3)-distance*1.05+.28*Math.sin(t*5.2));
    const height=1+8*drive*envelope*(.55+.45*swing);
    return Math.max(1,Math.min(9,height));
  });
}
