import { useEffect, useRef } from 'react';
import glass from './generated/cloudGlass.json';
import wave from './generated/cloudWave.json';
import { createEmptyGlassRenderer } from './emptyGlassRenderer';

let renderer: ReturnType<typeof createEmptyGlassRenderer> | undefined;

export function EmptyGlass() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    renderer ??= createEmptyGlassRenderer(glass, wave.palettes);
    return renderer.mount(canvas.current!);
  }, []);
  return <canvas ref={canvas} className="empty-state-glass" width="144" height="144" aria-hidden="true"/>;
}
