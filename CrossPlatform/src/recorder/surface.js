// Keep the robot's drawing buffer independent of the expanding settings panel.
// Only its position and shader scale follow the bottom toolbar.
export function pixelSurfaceLayout(bounds,onboarding=false){
  const margin=96,width=onboarding?bounds.width:90,height=onboarding?bounds.height:63;
  const toolbarHeight=onboarding?bounds.height:Math.min(63,bounds.height);
  return {width:width+margin*2,height:height+margin*2,
    left:(bounds.width-width)/2-margin,top:bounds.height-toolbarHeight/2-height/2-margin,
    center:[margin+width/2,margin+height/2],scale:toolbarHeight/63};
}

// Input rectangles use top-left canvas coordinates; WebGL scissor uses bottom-left.
// Round outwards so fractional display scales never clip an antialiased edge.
export function surfaceScissor(width,height,rectangles,padding=0){
  const left=Math.max(0,Math.floor(Math.min(...rectangles.map(r=>r.x))-padding));
  const top=Math.max(0,Math.floor(Math.min(...rectangles.map(r=>r.y))-padding));
  const right=Math.max(0,Math.min(width,Math.ceil(Math.max(...rectangles.map(r=>r.x+r.width))+padding)));
  const bottom=Math.max(0,Math.min(height,Math.ceil(Math.max(...rectangles.map(r=>r.y+r.height))+padding)));
  return [Math.min(width,left),Math.max(0,height-bottom),Math.max(0,right-left),Math.max(0,bottom-top)];
}

// Windows already applies display scaling. Avoid adding 1.5x supersampling on
// top of it, or allocating a scene above 2x density on high-DPI desktop screens.
export function recorderRenderScale(identity,dpr){
  return /Windows|Win32|Win64/i.test(identity)?Math.min(1,2/Math.max(1,dpr||1)):1.5;
}
