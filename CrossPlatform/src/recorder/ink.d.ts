export interface PixelMaskField{width:number;height:number;values:Float32Array;data:Uint8Array}
export const pixelInkStyle:{warp:number;curve:number;follow:number;rounding:number};
export function pixelMaskField(rgba:Uint8Array|Uint8ClampedArray,width:number,height:number,pixelsPerCell:number):PixelMaskField;
export function pixelRoundedIntersection(shape:number,stripe:number,radius:number):number;
export function pixelInkCoverage(field:PixelMaskField,point:number[],layout:{maskOrigin:number[];maskSize:number[];center:number[];pitch:number;gap:number;scale?:number}):number;
