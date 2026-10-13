import { useEffect, useRef } from 'react';
import cloud from './generated/cloudWave.json';
import { createEmptyWaveRenderer } from './emptyWaveRenderer';

let renderer: ReturnType<typeof createEmptyWaveRenderer> | undefined;

export function EmptyWave() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    renderer ??= createEmptyWaveRenderer(cloud);
    return renderer.mount(canvas.current!);
  }, []);
  return <canvas ref={canvas} className="empty-state-wave" width="384" height="192" aria-hidden="true"/>;
}
