export interface NotchGeometry {
  /** Physical camera height in logical points; zero on a flat display. */
  top:number;
  cutoutWidth:number;
  maximumWidth:number;
  displayId?:number;
  scaleFactor?:number;
}

export function notchLayout(geometry:NotchGeometry,open:boolean,settings:boolean,textHeight:number|null){
  const hardware=geometry.cutoutWidth>0&&geometry.top>0;
  const dockWidth=hardware?geometry.cutoutWidth:112;
  const dockHeight=hardware?geometry.top:32;
  const compactHeight=Math.max(32,dockHeight);
  const controlWidth=dockWidth+80;
  const maximumWidth=Math.max(1,geometry.maximumWidth);
  const settingsWidth=Math.min(maximumWidth,Math.max(320,controlWidth));
  const width=settings?settingsWidth:Math.min(maximumWidth,textHeight!==null?Math.max(360,controlWidth):open?controlWidth:dockWidth+12);
  const height=settings?compactHeight+104:textHeight!==null?compactHeight+textHeight+30:compactHeight;
  return {hardware,dockWidth,dockHeight,compactHeight,width,height,shortLanguages:settingsWidth<272};
}

/** CSS owns the animated bounds; the material and controls share this geometry. */
export function notchAnimatedLayout(dockWidth:number,dockHeight:number,width:number,height:number,expandedHeight:number,reveal:number){
  const menu=Math.max(0,Math.min(1,(height-dockHeight)/Math.max(1,expandedHeight-dockHeight)));
  // The compact control row has two detached circles outside the camera body.
  // As it expands, that extra width becomes part of the panel itself.
  const materialWidth=Math.max(dockWidth,width-80*(1-menu));
  const compactSide=dockWidth/2-14+38*reveal;
  const controlSide=Math.max(compactSide,materialWidth/2-20);
  return {menu,materialWidth,materialHeight:Math.max(dockHeight,height),controlSide};
}
