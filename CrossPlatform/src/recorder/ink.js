export const pixelInkStyle={warp:.055,curve:.08,follow:.1,rounding:.16};
export function pixelMaskField(rgba,width,height,pixelsPerCell){
  const count=width*height,distance=new Float32Array(count),inside=new Uint8Array(count),values=new Float32Array(count);
  const data=new Uint8Array(rgba.buffer,rgba.byteOffset,rgba.byteLength);
  for(let i=0;i<count;i++)inside[i]=rgba[i*4+3]>=128?1:0;
  for(let i=0;i<count;i++){
    const alpha=rgba[i*4+3]/255,x=i%width,y=Math.floor(i/width);
    const boundary=x>0&&inside[i-1]!==inside[i]||x+1<width&&inside[i+1]!==inside[i]||y>0&&inside[i-width]!==inside[i]||y+1<height&&inside[i+width]!==inside[i];
    distance[i]=alpha>0&&alpha<1?Math.abs(.5-alpha):boundary?.5:1e6;
  }
  // Distance to the actual contour, including holes. The two chamfer passes
  // retain subpixel antialiasing at the boundary and work for animated masks.
  const diagonal=Math.SQRT2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;let d=distance[i];
    if(x>0)d=Math.min(d,distance[i-1]+1);
    if(y>0){d=Math.min(d,distance[i-width]+1);if(x>0)d=Math.min(d,distance[i-width-1]+diagonal);if(x+1<width)d=Math.min(d,distance[i-width+1]+diagonal);}
    distance[i]=d;
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--){
    const i=y*width+x;let d=distance[i];
    if(x+1<width)d=Math.min(d,distance[i+1]+1);
    if(y+1<height){d=Math.min(d,distance[i+width]+1);if(x>0)d=Math.min(d,distance[i+width-1]+diagonal);if(x+1<width)d=Math.min(d,distance[i+width+1]+diagonal);}
    distance[i]=d;values[i]=Math.max(-8,Math.min(8,(inside[i]?-d:d)/pixelsPerCell));
    const encoded=Math.round((values[i]/16+.5)*65535);data[i*4]=encoded>>8;data[i*4+1]=encoded&255;data[i*4+2]=255;
  }
  return {width,height,values,data};
}
export function pixelRoundedIntersection(shape,stripe,radius){
  if(Math.max(shape,stripe)<-radius)return Math.max(shape,stripe);
  return Math.hypot(Math.max(shape+radius,0),Math.max(stripe+radius,0))+Math.min(Math.max(shape,stripe),-radius);
}
export function pixelInkCoverage(field,point,{maskOrigin,maskSize,center,pitch,gap,scale=1}){
  const sample=(x,y)=>{
    const u=(x-maskOrigin[0])/maskSize[0],v=(y-maskOrigin[1])/maskSize[1];
    if(u<0||u>1||v<0||v>1)return 8;
    const px=Math.max(0,Math.min(field.width-1,u*field.width-.5)),py=Math.max(0,Math.min(field.height-1,v*field.height-.5));
    const left=Math.floor(px),top=Math.floor(py),right=Math.min(left+1,field.width-1),bottom=Math.min(top+1,field.height-1),dx=px-left,dy=py-top;
    return (field.values[top*field.width+left]*(1-dx)+field.values[top*field.width+right]*dx)*(1-dy)+(field.values[bottom*field.width+left]*(1-dx)+field.values[bottom*field.width+right]*dx)*dy;
  };
  const x=center[0]+(point[0]-center[0])/scale,y=center[1]+(point[1]-center[1])/scale;
  const gx=(x-center[0])/pitch+10.5,gy=(y-center[1])/pitch+5.5,step=pitch*.4,d=sample(x,y);
  const gradient=[(sample(x+step,y)-sample(x-step,y))/.8,(sample(x,y+step)-sample(x,y-step))/.8],length=Math.hypot(...gradient)+.35,normal=gradient.map(value=>value/length),edge=Math.exp(-Math.abs(d)*2);
  const warp=Math.sin(gy*1.35+gx*.4)*pixelInkStyle.warp*pitch*edge;
  const shape=sample(x+normal[0]*warp,y+normal[1]*warp)*pitch*scale;
  const displayX=(point[0]-center[0])/pitch+10.5,displayY=(point[1]-center[1])/pitch+5.5;
  const row=displayY+Math.sin((displayX-10.5)*.55)*pixelInkStyle.curve+normal[0]*edge*pixelInkStyle.follow+gap/pitch*.5;
  const stripe=Math.abs(row-Math.floor(row)-.5)*pitch-(pitch-gap)*.5;
  const distance=pixelRoundedIntersection(shape,stripe,pitch*pixelInkStyle.rounding),t=Math.max(0,Math.min(1,(distance+.45)/.9));
  return 1-t*t*(3-2*t);
}
