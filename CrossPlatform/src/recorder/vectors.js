// Continuous contours in face coordinates. The display grid is applied later.
const contourSamples=192;
const area=points=>points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p[0]*next[1]-next[0]*p[1];},0)/2;
const center=shape=>{
  const points=shape.contours[0];
  return [0,1].map(axis=>(Math.min(...points.map(p=>p[axis]))+Math.max(...points.map(p=>p[axis])))/2);
};
export function pixelContours(mask,width=21,height=11,scale=1){
  const visited=new Uint8Array(mask.length),shapes=[];
  const occupied=(x,y)=>x>=0&&x<width&&y>=0&&y<height&&mask[y*width+x]>127;
  for(let index=0;index<mask.length;index++){
    if(visited[index]||mask[index]<=127)continue;
    const queue=[index],edges=new Map();visited[index]=1;
    const edge=(x,y,endX,endY,direction)=>{const key=y*(width+1)+x;if(!edges.has(key))edges.set(key,[]);edges.get(key).push({end:endY*(width+1)+endX,direction});};
    for(let head=0;head<queue.length;head++){
      const cell=queue[head],x=cell%width,y=Math.floor(cell/width);
      for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){const nx=x+dx,ny=y+dy,next=ny*width+nx;if(occupied(nx,ny)&&!visited[next]){visited[next]=1;queue.push(next);}}
      if(!occupied(x,y-1))edge(x,y,x+1,y,0);
      if(!occupied(x+1,y))edge(x+1,y,x+1,y+1,1);
      if(!occupied(x,y+1))edge(x+1,y+1,x,y+1,2);
      if(!occupied(x-1,y))edge(x,y+1,x,y,3);
    }
    const contours=[];
    while(edges.size){
      const start=edges.keys().next().value,points=[];let at=start,direction;
      do{
        points.push([at%(width+1)/scale,Math.floor(at/(width+1))/scale]);
        const choices=edges.get(at);
        // At a diagonal contact, follow the right turn around this boundary.
        choices.sort((a,b)=>direction===undefined?0:((b.direction-direction+3)%4)-((a.direction-direction+3)%4));
        const next=choices.shift();if(!choices.length)edges.delete(at);at=next.end;direction=next.direction;
      }while(at!==start);
      const corners=points.filter((p,i)=>{const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];return (p[0]-a[0])*(b[1]-p[1])!==(p[1]-a[1])*(b[0]-p[0]);});
      if(corners.length>=3)contours.push(corners);
    }
    contours.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));shapes.push({contours});
  }
  return shapes;
}
function roundedRect(x,y,width,height,radius){
  const points=[];
  for(const [cx,cy,start] of [[x+width-radius,y+radius,-Math.PI/2],[x+width-radius,y+height-radius,0],[x+radius,y+height-radius,Math.PI/2],[x+radius,y+radius,Math.PI]]){
    for(let i=0;i<=12;i++){const angle=start+i*Math.PI/24;points.push([cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius]);}
  }
  return {contours:[resample(points)]};
}
export function pixelPongContours({ball,left,right}){
  return [roundedRect(2,left-2,2,5,.18),roundedRect(ball.x-.5,ball.y-.5,2,2,.25),roundedRect(17,right-2,2,5,.18)];
}
export function pixelEqualizerContours(heights){
  return heights.map((height,i)=>roundedRect(4+i*2,5.5-height/2,1,height,.18));
}
export function pixelPoseContours(shapes,pose){
  const heart=pose.mood==='love',fromHeart=pose.from==='love';
  return shapes.map(shape=>{
    const right=center(shape)[0]>10.5,eyeAnchor=right?16:5;
    // Keep the pose continuous while two eyes become one centered heart and
    // return: changing the rotation/blink anchor at the scene boundary jumps.
    const start=fromHeart?10.5:eyeAnchor,end=heart?10.5:eyeAnchor,anchorX=start+(end-start)*pose.transition;
    const blinkWeight=(fromHeart?0:1)+((heart?0:1)-(fromHeart?0:1))*pose.transition;
    const blink=(right?pose.rightBlink:pose.leftBlink)*blinkWeight;
    const tilt=pose.tilt+(right?pose.rightTilt:pose.leftTilt)*blinkWeight,cos=Math.cos(tilt),sin=Math.sin(tilt);
    const openness=1+((right?pose.rightOpen:pose.leftOpen)-1)*blinkWeight;
    return {contours:shape.contours.map(points=>points.map(([x,y])=>{
      const dx=(x-anchorX)*pose.scale,dy=(y-5.5)*pose.scale*(1-blink*.88)*openness;
      return [anchorX+dx*cos-dy*sin+pose.gaze[0],5.5+dx*sin+dy*cos+pose.gaze[1]+pose.bob];
    }))};
  });
}
function resample(points){
  if(points.length===contourSamples)return points.map(point=>[...point]);
  const lengths=points.map((p,i)=>Math.hypot(p[0]-points[(i+1)%points.length][0],p[1]-points[(i+1)%points.length][1]));
  const total=lengths.reduce((sum,value)=>sum+value,0);
  if(total===0)return Array.from({length:contourSamples},()=>[...points[0]]);
  let segment=0,start=0;
  return Array.from({length:contourSamples},(_,i)=>{
    const distance=i*total/contourSamples;
    while(segment<points.length-1&&start+lengths[segment]<distance)start+=lengths[segment++];
    const p=points[segment],q=points[(segment+1)%points.length],t=(distance-start)/(lengths[segment]||1);
    return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];
  });
}
function align(from,to){
  let best=0,cost=Infinity;
  for(let offset=0;offset<contourSamples;offset++){
    let sum=0;
    for(let i=0;i<contourSamples;i++){const a=from[i],b=to[(i+offset)%contourSamples];sum+=(a[0]-b[0])**2+(a[1]-b[1])**2;}
    if(sum<cost){cost=sum;best=offset;}
  }
  return to.map((_,i)=>to[(i+best)%contourSamples]);
}
export function pixelVectorPlan(from,to){
  if(!from.length||!to.length)return [];
  const sort=shapes=>[...shapes].sort((a,b)=>center(a)[0]-center(b)[0]||center(a)[1]-center(b)[1]);
  const starts=sort(from),ends=sort(to),count=Math.max(starts.length,ends.length);
  return Array.from({length:count},(_,i)=>{
    const source=starts[Math.floor(i*starts.length/count)],target=ends[Math.floor(i*ends.length/count)];
    const contours=Array.from({length:Math.max(source.contours.length,target.contours.length)},(_,j)=>{
      const a=source.contours[j]||[center(source)],b=target.contours[j]||[center(target)];
      const start=resample(a),end=resample(b);
      if(area(start)*area(end)<0)end.reverse();
      return {from:start,to:align(start,end)};
    });
    const a=center(source),b=center(target),dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy),bend=Math.min(.8,distance*.15);
    return {source,target,contours,bow:distance?[-dy/distance*bend,dx/distance*bend]:[0,0]};
  });
}
export function pixelVectorFrame(plan,progress){
  if(progress<=0)return plan.map(part=>part.source);
  if(progress>=1)return plan.map(part=>part.target);
  // Each whole contour follows an arc. The shared easing accelerates and brakes
  // quickly, without independent delays or trajectories for display pixels.
  const t=progress<.5?4*progress**3:1-(-2*progress+2)**3/2,arc=4*t*(1-t);
  return plan.map(part=>({contours:part.contours.map(({from,to})=>from.map((p,i)=>[p[0]+(to[i][0]-p[0])*t+part.bow[0]*arc,p[1]+(to[i][1]-p[1])*t+part.bow[1]*arc]))}));
}
export function pixelCompletionContours(kind){
  const scale=12,canvas=document.createElement('canvas');canvas.width=21*scale;canvas.height=11*scale;
  const ctx=canvas.getContext('2d'),shapes=[];
  // Each piece is a continuous stroke, rather than a collection of display cells.
  const parts=kind==='failed'?[
    c=>{c.moveTo(12,5);c.lineTo(12,13.5);},
    c=>{c.arc(12,18,1.4,0,Math.PI*2);},
  ]:kind==='result'?[
    c=>{c.moveTo(4,12);c.lineTo(9,17);},
    c=>{c.arc(9,17,1.35,0,Math.PI*2);},
    c=>{c.moveTo(9,17);c.lineTo(20,6);},
  ]:[
    c=>{c.moveTo(6,16);c.lineTo(5,16);c.arc(5,14,2,Math.PI/2,Math.PI);c.lineTo(3,5);c.arc(5,5,2,Math.PI,Math.PI*1.5);c.lineTo(14,3);c.arc(14,5,2,-Math.PI/2,0);c.lineTo(16,6);},
    c=>{c.moveTo(14,8);c.lineTo(11,8);c.arc(11,11,3,-Math.PI/2,-Math.PI,true);c.lineTo(8,18);c.arc(11,18,3,Math.PI,Math.PI/2,true);c.lineTo(14,21);},
    c=>{c.moveTo(14,21);c.lineTo(17,21);c.arc(17,18,3,Math.PI/2,0,true);c.lineTo(20,11);c.arc(17,11,3,0,-Math.PI/2,true);c.lineTo(14,8);},
  ];
  parts.forEach((path,i)=>{
    ctx.resetTransform();ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(scale/2,0,0,scale/2,4.5*scale,-.5*scale);
    ctx.strokeStyle=ctx.fillStyle='#ffffff';ctx.lineWidth=kind==='copied'?1.8:2.7;
    ctx.lineCap=kind==='copied'&&i===0?'butt':'round';ctx.lineJoin='round';ctx.beginPath();path(ctx);
    if((kind==='result'||kind==='failed')&&i===1)ctx.fill();else ctx.stroke();
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,mask=Uint8Array.from({length:canvas.width*canvas.height},(_,j)=>rgba[j*4+3]);
    shapes.push(...pixelContours(mask,canvas.width,canvas.height,scale));
  });
  return shapes.map(shape=>({contours:shape.contours.map(resample)}));
}
