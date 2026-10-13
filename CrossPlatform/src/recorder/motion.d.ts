export interface FacePose{mood:string;from:string;transition:number;action:string;gaze:number[];bob:number;tilt:number;scale:number;leftBlink:number;rightBlink:number;leftTilt:number;rightTilt:number;leftOpen:number;rightOpen:number}
export function pixelFacePose(options?:{time?:number;emotion?:string;hover?:boolean;paused?:boolean;reducedMotion?:boolean}):FacePose;
export function pixelVoiceDrive(average:number,peak?:number):number;
export function pixelAudioEnvelope(previous:number,target:number,delta:number,reducedMotion?:boolean):number;
export function pixelEqualizer(time?:number,level?:number,reducedMotion?:boolean):number[];
