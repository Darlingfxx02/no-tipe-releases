import type { Snapshot } from '../types';
import type { NotchGeometry } from '../notchGeometry';

export function connectRecorderBridge(api: {
  core: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
  event: { listen: (name: string, handler: (event: { payload: unknown }) => void) => Promise<() => void> };
}, renderer: {
  update: (snapshot: Snapshot) => void;
  active?: (active: boolean) => void;
  audio?: (audio: { level: number; peak: number }) => void;
  pointer?: (pointer: unknown) => void;
  dock?: (geometry: NotchGeometry) => void;
  error?: (error: unknown) => void;
}, lifecycle?: Document): { ready: Promise<void>; refresh: () => Promise<void>; dispose: () => void };
