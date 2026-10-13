import type { VectorShape } from './vectors.js';
export type PixelProcessing = 'auto'|'pong'|'starship'|'snake'|'breakout';
export const pixelProcessingVariants: Exclude<PixelProcessing,'auto'>[];
export function pixelProcessingVariant(options?:{processing?:string;time?:number;processingVisit?:number;reducedMotion?:boolean}):Exclude<PixelProcessing,'auto'>;
export function pixelProcessingOpacity(options?:{processing?:string;time?:number;reducedMotion?:boolean}):number;
export function pixelArcadeContours(variant:string,time?:number):VectorShape[];
