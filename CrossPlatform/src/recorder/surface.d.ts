export interface SurfaceRect{x:number;y:number;width:number;height:number}
export function pixelSurfaceLayout(bounds:Pick<SurfaceRect,'width'|'height'>,onboarding?:boolean):{width:number;height:number;left:number;top:number;center:number[];scale:number};
export function surfaceScissor(width:number,height:number,rectangles:SurfaceRect[],padding?:number):number[];
export function recorderRenderScale(identity:string,dpr:number):number;
