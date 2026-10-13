type GlassSource = {
  vertex: string; background: string; glass: string;
  optics: { refractAmount: number; highlightHeight: number; highlightCut: number; highlightAmount: number };
  rim: { strength: number; width: number };
};
type GlassPalettes = Record<string, { accent: string; neutral?: boolean }>;

// Bake the actual recorder material once per theme. Every plate shares the
// resulting image; its lighting and rim phase never advance, even on hover.
// Self-contained so the standalone gallery can use the same renderer.
export function createEmptyGlassRenderer(source: GlassSource, palettes: GlassPalettes) {
  const scale = 2, size = 72 * scale, face = 52 * scale, inset = 10 * scale;
  const targets = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();
  const cache = new Map<string, HTMLCanvasElement>();
  let surface: HTMLCanvasElement | null = null, gl: WebGL2RenderingContext | null = null;
  let background: WebGLProgram | null = null, glass: WebGLProgram | null = null;
  let scene: WebGLTexture | null = null, dummy: WebGLTexture | null = null, framebuffer: WebGLFramebuffer | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null, failed = false;
  const release = () => {
    gl?.deleteProgram(background); gl?.deleteProgram(glass);
    gl?.deleteTexture(scene); gl?.deleteTexture(dummy); gl?.deleteFramebuffer(framebuffer); gl?.deleteVertexArray(vertexArray);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    gl = null; surface = null; background = null; glass = null; scene = null; dummy = null; framebuffer = null; vertexArray = null;
  };
  const initialize = () => {
    surface = document.createElement('canvas'); surface.width = size; surface.height = size;
    gl = surface.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
    if (!gl) throw new Error('Glass WebGL unavailable');
    const compile = (type: number, code: string) => {
      const shader = gl!.createShader(type)!; gl!.shaderSource(shader, code); gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) { gl!.deleteShader(shader); throw new Error('Glass shader unavailable'); }
      return shader;
    };
    const program = (fragment: string) => {
      const vertex = compile(gl!.VERTEX_SHADER, source.vertex), shader = compile(gl!.FRAGMENT_SHADER, fragment);
      const result = gl!.createProgram()!;
      gl!.attachShader(result, vertex); gl!.attachShader(result, shader); gl!.linkProgram(result);
      gl!.deleteShader(vertex); gl!.deleteShader(shader);
      if (!gl!.getProgramParameter(result, gl!.LINK_STATUS)) { gl!.deleteProgram(result); throw new Error('Glass program unavailable'); }
      return result;
    };
    background = program(source.background); glass = program(source.glass);
    vertexArray = gl.createVertexArray(); gl.bindVertexArray(vertexArray);
    const texture = () => {
      const result = gl!.createTexture()!; gl!.bindTexture(gl!.TEXTURE_2D, result);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      return result;
    };
    dummy = texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([3, 4, 8, 255]));
    scene = texture(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scene, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Glass scene unavailable');
  };
  const render = (paletteName: string) => {
    const previous = cache.get(paletteName); if (previous) return previous;
    if (failed) return null;
    try {
      if (gl?.isContextLost()) release();
      if (!gl) initialize();
      const context = gl!, palette = palettes[paletteName] || palettes.prism, accent = palette.accent;
      const tint = [1, 3, 5].map(offset => parseInt(accent.slice(offset, offset + 2), 16) / 255);
      const common = {
        uResolution: [size, size], uCanvasSize: [size, size], uTextureSize: [1, 1],
        uMaterialOrigin: [-10 * scale, -10 * scale], uMaterialSize: [92 * scale, 92 * scale],
        uFaceOrigin: [inset, inset], uFaceSize: [face, face], uFaceShade: .9,
        uBackgroundReady: 0, uNeutralBackground: Number(palette.neutral===true), uMonochromeMaterial: Number(palette.neutral===true), uThemeTint: tint,
        uLightIntensity: .28, uWaveVisibility: 0, uCompletionTint: 0, uError: 0,
      };
      const draw = (program: WebGLProgram, values: Record<string, number | number[]>) => {
        context.useProgram(program);
        for (const [name, value] of Object.entries(values)) {
          const location = context.getUniformLocation(program, name);
          if (typeof value === 'number') context.uniform1f(location, value);
          else if (value.length === 2) context.uniform2fv(location, value);
          else if (value.length === 3) context.uniform3fv(location, value);
          else context.uniform4fv(location, value);
        }
        context.activeTexture(context.TEXTURE1); context.bindTexture(context.TEXTURE_2D, dummy);
        context.uniform1i(context.getUniformLocation(program, 'uBackground'), 1);
        // Avoid sampling a texture attached to the active scene framebuffer.
        context.activeTexture(context.TEXTURE0); context.bindTexture(context.TEXTURE_2D, program === glass ? scene : dummy);
        context.uniform1i(context.getUniformLocation(program, 'uSceneTexture'), 0);
        context.drawArrays(context.TRIANGLES, 0, 3);
      };
      context.viewport(0, 0, size, size); context.disable(context.BLEND);
      context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
      draw(background!, common);
      context.bindFramebuffer(context.FRAMEBUFFER, null);
      context.clearColor(0, 0, 0, 0); context.clear(context.COLOR_BUFFER_BIT);
      draw(glass!, {
        ...common, uPanelOrigin: [0, 0], uPanelSize: [size, size], uMarginPx: inset, uCornerRadius: 14 * scale,
        uHeight: 18 * .7 * scale, uCurvature: 1, uRefractAmount: source.optics.refractAmount * .7 * scale,
        uAngle: 0, uGradRadialMix: .08, uKeyAngle: Math.PI * .25, uFillAngle: Math.PI * 1.25,
        uHlHeight: source.optics.highlightHeight * .7 * scale, uHlCut: source.optics.highlightCut,
        uHlNorm: 8, uHlAmount: source.optics.highlightAmount, uHlCurv: 1, uTransparentOutside: 1,
        uPixelScale: scale, uRimWidth: source.rim.width * scale, uRimStrength: source.rim.strength, uRimTime: 2.4,
        uVoiceImpact: 0, uVoicePhase: 0, uControlProgress: 0, uLobeProgress: [0, 0, 0],
        uLobe0: [0, 0, 0, 0], uLobe1: [0, 0, 0, 0], uLobe2: [0, 0, 0, 0],
        uControl0: [0, 0, 0, 0], uControl1: [0, 0, 0, 0], uMergeRadius: 12 * scale, uTranslationActive: 0,
      });
      if (context.getError() !== context.NO_ERROR) throw new Error('Glass draw unavailable');
      const image = document.createElement('canvas'); image.width = size; image.height = size;
      image.getContext('2d')!.drawImage(surface!, 0, 0); cache.set(paletteName, image);
      return image;
    } catch { failed = true; release(); return null; }
  };
  const refresh = () => {
    const paletteName = document.documentElement.dataset.palette || 'prism';
    const image = render(paletteName);
    for (const [canvas, context] of targets) {
      context.clearRect(0, 0, size, size); if (image) context.drawImage(image, 0, 0);
      canvas.dataset.glassReady = String(Boolean(image)); canvas.dataset.glassPalette = paletteName;
      if (canvas.parentElement) canvas.parentElement.dataset.glassReady = String(Boolean(image));
    }
  };
  const theme = new MutationObserver(refresh);
  return {
    mount(canvas: HTMLCanvasElement) {
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d'); if (!context) return () => {};
      if (!targets.size) { failed = false; theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] }); }
      targets.set(canvas, context); refresh();
      return () => {
        targets.delete(canvas);
        if (!targets.size) { theme.disconnect(); cache.clear(); release(); }
      };
    },
  };
}
