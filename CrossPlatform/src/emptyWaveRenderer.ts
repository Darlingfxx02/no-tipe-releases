type WaveSource = {
  vertex: string; fragment: string; defaults: Record<string, number>;
  palettes: Record<string, { colors: number[][]; highlights?: number[][] }>;
};

// One spectral pass serves every visible empty state. Hidden views do not draw.
// Keep this factory self-contained so the standalone gallery can use it too.
export function createEmptyWaveRenderer(source: WaveSource) {
  const width = 384, height = 192;
  const targets = new Map<HTMLCanvasElement, { context: CanvasRenderingContext2D; visible: boolean }>();
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  let surface: HTMLCanvasElement | null = null, gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null, fallback: CanvasRenderingContext2D | null = null;
  let frame = 0, lastDraw = 0, phase = 2.4, lastTime = 0;
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const set = (name: string, value: number | number[]) => {
    if (!gl || !program) return;
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
    const location = uniforms.get(name)!;
    if (typeof value === 'number') gl.uniform1f(location, value);
    else if (value.length === 2) gl.uniform2fv(location, value);
    else if (value.length === 3) gl.uniform3fv(location, value);
    else gl.uniform4fv(location, value);
  };
  const initialize = () => {
    surface = document.createElement('canvas'); surface.width = width; surface.height = height;
    try {
      gl = surface.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
      if (!gl) throw new Error('WebGL unavailable');
      const compile = (type: number, code: string) => {
        const shader = gl!.createShader(type)!; gl!.shaderSource(shader, code); gl!.compileShader(shader);
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) { gl!.deleteShader(shader); throw new Error('Wave shader unavailable'); }
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, source.vertex), fragment = compile(gl.FRAGMENT_SHADER, source.fragment);
      program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Wave program unavailable');
      gl.useProgram(program); gl.bindVertexArray(gl.createVertexArray());
      for (const [name, value] of Object.entries(source.defaults)) if (name.startsWith('u')) set(name, value);
      set('uResolution', [width, height]); set('uResolved', 1); set('uLayerOpacity', .88);
      set('uEffectScale', 1); set('uAnchor', [.5, .5]); set('uMouse', [0, 0, 0, 0]);
      set('uWaveCount', 3); set('uLow', 0); set('uMid', 0); set('uHigh', 0);
      set('uBrightnessLow', 0); set('uChromatic', 0); set('uWaveBrightness', 1.2);
    } catch {
      gl?.getExtension('WEBGL_lose_context')?.loseContext(); gl = null; program = null;
      surface = document.createElement('canvas'); surface.width = width; surface.height = height;
      fallback = surface.getContext('2d');
    }
  };
  const draw = (now: number) => {
    frame = 0;
    if (document.hidden || ![...targets.values()].some(target => target.visible)) { lastTime = 0; return; }
    if (now - lastDraw < 1000 / 24) { schedule(); return; }
    if (!reduced.matches && lastTime) phase += Math.min((now - lastTime) / 1000, .1) * .35;
    lastTime = now; lastDraw = now;
    if (gl?.isContextLost()) { surface = null; gl = null; program = null; uniforms.clear(); }
    if (!surface) initialize();
    const paletteName = document.documentElement.dataset.palette || 'prism';
    const palette = source.palettes[paletteName] || source.palettes.prism;
    if (gl && program && !gl.isContextLost()) {
      gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      set('uTime', phase); set('uWavePhase', phase);
      palette.colors.forEach((color, index) => {
        set(`uWaveColor${index}`, color); set(`uWaveHighlightColor${index}`, palette.highlights?.[index] || color.map(value => .76 + .24 * value));
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (fallback) {
      fallback.clearRect(0, 0, width, height);
      palette.colors.forEach((color, index) => {
        const ink = `rgb(${color.map(value => Math.round(value * 255)).join(' ')})`;
        const gradient = fallback!.createLinearGradient(20, 0, width - 20, 0);
        gradient.addColorStop(0, 'transparent'); gradient.addColorStop(.3, ink); gradient.addColorStop(.7, ink); gradient.addColorStop(1, 'transparent');
        fallback!.beginPath(); fallback!.moveTo(20, height / 2);
        const bend = Math.sin(phase + index * 2.2) * 32;
        fallback!.bezierCurveTo(130, height / 2 - bend, 254, height / 2 + bend, width - 20, height / 2);
        fallback!.strokeStyle = gradient; fallback!.lineWidth = 3; fallback!.shadowColor = ink; fallback!.shadowBlur = 14; fallback!.stroke();
      });
    }
    for (const [canvas, target] of targets) if (target.visible && surface) {
      target.context.clearRect(0, 0, width, height); target.context.drawImage(surface, 0, 0);
      canvas.dataset.waveReady = 'true'; canvas.dataset.wavePalette = paletteName; canvas.dataset.waveFallback = String(!gl);
    }
    if (!reduced.matches) schedule();
  };
  const schedule = () => { if (!frame && !document.hidden && [...targets.values()].some(target => target.visible)) frame = requestAnimationFrame(draw); };
  const refresh = () => { lastDraw = 0; lastTime = 0; if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else schedule(); };
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) { const target = targets.get(entry.target as HTMLCanvasElement); if (target) target.visible = entry.isIntersecting; }
    refresh();
  });
  const theme = new MutationObserver(refresh);
  return {
    mount(canvas: HTMLCanvasElement) {
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); if (!context) return () => {};
      if (!targets.size) {
        document.addEventListener('visibilitychange', refresh); reduced.addEventListener('change', refresh);
        theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] });
      }
      targets.set(canvas, { context, visible: false }); visibility.observe(canvas);
      return () => {
        visibility.unobserve(canvas); targets.delete(canvas);
        if (!targets.size) {
          cancelAnimationFrame(frame); frame = 0; lastTime = 0; lastDraw = 0;
          document.removeEventListener('visibilitychange', refresh); reduced.removeEventListener('change', refresh); theme.disconnect();
          gl?.deleteProgram(program); gl?.getExtension('WEBGL_lose_context')?.loseContext();
          surface = null; gl = null; program = null; fallback = null; uniforms.clear();
        }
      };
    },
  };
}
