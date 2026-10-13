// Tiny arcade scenes share the robot's 21 × 11 coordinate space. Motion stays
// continuous; the recorder applies its usual rounded display rows afterwards.
export const pixelProcessingVariants=['pong','starship','snake','breakout'];
const arcadeWrap=(value,span)=>((value%span)+span)%span;
const arcadeReflect=(value,span)=>span-Math.abs(arcadeWrap(value,span*2)-span);
const arcadeRect=(x,y,width,height)=>({contours:[[[x,y],[x+width,y],[x+width,y+height],[x,y+height]]]});
const arcadeGlyph=(lines,x,y,scale=1)=>lines.flatMap((line,row)=>[...line].flatMap((dot,column)=>dot==='1'?[arcadeRect(x+column*scale,y+row*scale,scale,scale)]:[]));
const shipGlyph=['00100','01110','11111','10101'];
const invaderGlyph=['01010','11111','10101'];
export function pixelProcessingVariant({processing='auto',time=0,processingVisit=0,reducedMotion=false}={}){
  if(pixelProcessingVariants.includes(processing))return processing;
  const turn=reducedMotion?0:Math.floor(Math.max(0,time)/8);
  return pixelProcessingVariants[arcadeWrap(processingVisit+turn,pixelProcessingVariants.length)];
}
export function pixelProcessingOpacity({processing='auto',time=0,reducedMotion=false}={}){
  if(reducedMotion||pixelProcessingVariants.includes(processing))return 1;
  const local=arcadeWrap(Math.max(0,time),8),fade=Math.min(1,local/.18,(8-local)/.18);
  return fade*fade*(3-2*fade);
}
export function pixelArcadeContours(variant,time=0){
  if(variant==='starship'){
    const shapes=[],shipX=2+arcadeReflect(time*2.4,12),shipY=5.75+Math.sin(time*2.6)*.2;
    // Stars stream past, a fighter banks underneath the alien formation, and
    // each shot keeps the horizontal launch position of the moving ship.
    for(let i=0;i<6;i++)shapes.push(arcadeRect(1.2+i*3.35,arcadeWrap(i*1.8+time*(1.7+i*.16),10.2),.45,.65));
    const drift=Math.sin(time*1.7)*.65;
    for(let i=0;i<3;i++)shapes.push(...arcadeGlyph(invaderGlyph,2.5+i*6+drift,.7,.65));
    const shotAge=arcadeWrap(time,.72),launch=time-shotAge,shotX=2+arcadeReflect(launch*2.4,12)+2.2;
    shapes.push(arcadeRect(shotX,5.8-shotAge*7,.6,1.2));
    shapes.push(...arcadeGlyph(shipGlyph,shipX,shipY));
    shapes.push(arcadeRect(shipX+2,shipY+4,.9,.4+(1+Math.sin(time*22))*.25));
    return shapes;
  }
  if(variant==='snake'){
    // The head follows an inset rectangular track; its tail follows the same
    // path, so every corner remains connected and the food is actually eaten.
    const perimeter=48,path=distance=>{
      const at=arcadeWrap(distance,perimeter);
      return at<17?[2+at,2]:at<24?[19,2+at-17]:at<41?[19-(at-24),9]:[2,9-(at-41)];
    };
    const travel=time*5,meal=Math.floor(travel/12),head=path(travel),shapes=[];
    for(let i=9;i>=0;i--){const [x,y]=path(travel-i*.8),size=i===0?1.65:1.25;shapes.push(arcadeRect(x-size/2,y-size/2,size,size));}
    const food=path((meal+1)*12);shapes.push(arcadeRect(food[0]-.55,food[1]-.55,1.1,1.1));
    // A small four-point glint marks each bite in the center of the screen.
    const bite=arcadeWrap(travel,12);
    if(meal>0&&bite<1.7){const size=.8+Math.sin(bite/1.7*Math.PI)*.7;shapes.push(arcadeRect(10.5-size/2,4.3,size,2.4),arcadeRect(9.3,5.5-size/2,2.4,size));}
    return shapes;
  }
  if(variant==='breakout'){
    // A complete wave clears five large bricks, then refills. Each flight meets a
    // brick on its upward leg and the moving paddle on its downward leg.
    const flight=1.35,turn=Math.floor(time/flight),progress=arcadeWrap(time,flight)/flight,index=arcadeWrap(turn,5);
    const target=hit=>3+arcadeWrap(hit*2,5)*3.7,hitX=target(turn),previousX=target(turn-1),nextX=target(turn+1);
    const bottomX=(previousX+hitX)/2,nextBottomX=(hitX+nextX)/2;
    const ballX=progress<.5?bottomX+(hitX-bottomX)*progress*2:hitX+(nextBottomX-hitX)*(progress-.5)*2;
    const ballY=7.75-Math.sin(progress*Math.PI)*4.05;
    const paddleX=bottomX+(nextBottomX-bottomX)*progress,shapes=[];
    for(let brick=0;brick<5;brick++)if(brick>index||brick===index&&progress<.5)shapes.push(arcadeRect(1.4+arcadeWrap(brick*2,5)*3.7,.7,3.2,2));
    shapes.push(arcadeRect(paddleX-2.6,8.75,5.2,1.7),arcadeRect(ballX-1,ballY-1,2,2));
    const impact=(progress-.5)*flight;
    if(impact>=0&&impact<.22)for(const direction of [-1,1])shapes.push(arcadeRect(hitX+direction*(1.1+impact*5)-.4,2.6+impact*2,.8,.8));
    return shapes;
  }
  return [];
}
