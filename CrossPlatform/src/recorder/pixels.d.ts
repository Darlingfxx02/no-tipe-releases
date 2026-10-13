import type { VectorShape } from './vectors.js';
export interface PixelOptions{empowerment?:import('./empowerment.js').EmpowermentSelection|null;state?:string;paused?:boolean;emotion?:string;processing?:string;processingVisit?:number;time?:number;level?:number;hover?:boolean;petting?:boolean;reducedMotion?:boolean;tint?:number[];brightness?:number;center?:number[];pitch?:number;visible?:boolean;iconSource?:string;gaze?:number[]|null}
export interface PixelPointer{x:number;y:number;buttons?:number;valid?:boolean}
export class PixelPetting{until:number;constructor();resetStroke():void;clear():void;active(now:number):boolean;move(x:number,y:number,now:number,near?:boolean):boolean}
export class PixelAffection{value:number;constructor();clear():void;update(active:boolean,now:number,reducedMotion?:boolean):{heart:boolean;opacity:number;time:number;phase:string}}
export function pixelHeartEchoes(time:number,opacity?:number,reducedMotion?:boolean):Array<{scale:number;opacity:number}>;
export function pixelIconMarkup(kind:string,source:string):string;
export function pixelFrame(options?:PixelOptions):{cells:Uint8Array;mood:string};
export function pixelPong(time?:number):{ball:{x:number;y:number};left:number;right:number};
export function pixelProcessingContours(options?:PixelOptions):VectorShape[];
export function pixelGeometry(width:number,height:number,dpr:number,requestedPitch?:number,requestedCenter?:number[]):{pitch:number;gap:number;origin:number[];center:number[]};
export class PixelRecorder{constructor(canvas:HTMLCanvasElement);petPointer(pointer:PixelPointer):void;attachPetting(surface:HTMLElement,onChange?:()=>void,options?:{nativePointer?:boolean}):()=>void;draw(options:PixelOptions,delta?:number):void;dispose():void}
