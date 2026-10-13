// One shared clock for the pixel shower and the liquid power pulse.
export const empowermentDefaultColor='#F5C84C';
export function empowermentColor(value){
  const hex=/^#[0-9a-f]{6}$/i.test(value||'')?value:empowermentDefaultColor;
  return hex.slice(1).match(/../g).map(part=>parseInt(part,16)/255);
}
export class EmpowermentEffect{
  constructor(){this.key='';this.age=0;this.amount=0;this.color=empowermentColor();}
  update(selection,delta=0,reduced=false){
    const key=selection?.id?selection.id+':'+selection.color:'';
    if(key&&key!==this.key){this.age=0;this.color=empowermentColor(selection.color);}
    else if(!reduced)this.age+=Math.max(0,Math.min(delta,.05));
    this.key=key;
    this.amount=reduced?Number(!!key):this.amount+(Number(!!key)-this.amount)*(1-Math.exp(-Math.max(0,delta)/(key?.12:.2)));
    return {age:reduced?.85:this.age,amount:this.amount,color:this.color};
  }
}
export function empowermentLayout(width,height,reduced=false){
  const density=Math.max(1,width/90);
  return {size:[Math.max(1,width/2),Math.max(1,height/2)],count:Math.min(reduced?8:32,Math.ceil((reduced?3:8)*density))};
}
export function empowermentStars(time,reduced=false,extent=[10.8,9],count=reduced?3:8){
  return Array.from({length:count},(_,i)=>{
    const seed=i*1.618,phase=((time/(1.9+(i%3)*.25)+i*.137)%1+1)%1;
    return {x:(Math.sin(seed*4.7)*10+Math.sin(time*1.4+seed)*.8)/10.8*extent[0],y:(phase*2-1)*extent[1],size:.48+(i%3)*.09,opacity:Math.sin(phase*Math.PI)**.7};
  });
}
export const empowermentUniforms=`uniform vec3 uEmpowermentColor;
uniform float uEmpowerment;
uniform float uEmpowermentTime;`;
// Background vectors are composed by the material, then clipped by its SDF.
export const empowermentPixelShader=`
float empowermentBand(vec2 point,vec2 extent) {
  vec2 mask=1.-smoothstep(max(extent-vec2(1.),vec2(0.)),extent,abs(point));
  return mask.x*mask.y;
}
float empowermentPixels(vec2 point,float pitch,float count,vec2 extent) {
  float shower=0.;
  for(int i=0;i<32;i++) {
    if(float(i)>=count)break;
    float seed=float(i)*1.618;
    float phase=fract(uEmpowermentTime/(1.9+mod(float(i),3.)*.25)+float(i)*.137);
    float size=.48+mod(float(i),3.)*.09;
    vec2 travel=max(extent-vec2(pitch*2.),vec2(pitch));
    vec2 at=vec2((sin(seed*4.7)*10.+sin(uEmpowermentTime*1.4+seed)*.8)/10.8*travel.x,(phase*2.-1.)*travel.y);
    vec2 q=abs(point-at);
    float unit=pitch*size;
    float crossDistance=min(max(q.x-unit*.45,q.y-unit*2.5),max(q.x-unit*2.5,q.y-unit*.45));
    float star=1.-smoothstep(-.35,.35,crossDistance);
    shower=max(shower,star*pow(sin(phase*3.14159),.7)*uEmpowerment*.9);
  }
  return shower*empowermentBand(point,extent);
}
float empowermentPixels(vec2 point,float pitch,float count) {
  return empowermentPixels(point,pitch,count,vec2(10.8,9.)*pitch);
}`;
export const empowermentWaveShader=`
vec4 empowermentWave(vec2 point, vec2 scale) {
  vec2 p=point/max(scale,vec2(1.));
  float radius=length(p);
  float pulse=exp(-pow((radius-mod(uEmpowermentTime*.7,1.8))/.12,2.));
  float arc=.5+.5*sin(atan(p.y,p.x)*2.-uEmpowermentTime*1.8);
  float veil=exp(-radius*radius*2.2)*(.12+.15*arc);
  float gain=uEmpowerment*(veil+pulse*.26*exp(-radius));
  return vec4(uEmpowermentColor*gain,gain*.65);
}
vec4 empowermentWave(vec2 point,float scale) {
  return empowermentWave(point,vec2(scale));
}`;
export function empoweredWaveFragment(source,pulse=true){
  return source.replace('uniform float uWaveBrightness;', 'uniform float uWaveBrightness;\n'+empowermentUniforms+'\n'+empowermentWaveShader)
    .replace('outColor = vec4(col, alpha);', `${pulse?'vec4 power=empowermentWave(gid-uResolution*.5,min(uResolution.x,uResolution.y)*.38);':''}
  float energy=max(max(col.r,col.g),col.b);
  col=mix(col,uEmpowermentColor*energy*1.2,uEmpowerment*.52)${pulse?'+power.rgb':''};
  ${pulse?'alpha=max(alpha,power.a);':''}
  outColor = vec4(col, alpha);`);
}
