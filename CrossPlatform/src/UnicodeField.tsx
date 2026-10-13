import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { createUnicodeAtlas, unicodeBloomFragment, unicodeBlurFragment,
  unicodeDownsampleFragment, unicodeFragment, unicodeVertex } from './unicodeShader';

type Props = {
  cellSize: number;
  glow: number;
  spread: number;
  speed: number;
  background: number;
  paused: boolean;
};

export default function UnicodeField(props: Props) {
  useLocale();
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(props);
  const wake = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  current.current = props;
  useEffect(() => { wake.current?.(); }, [props]);

  useEffect(() => {
    const node = canvas.current!;
    const gl = node.getContext('webgl2', { alpha: false, antialias: false, depth: false });
    if (!gl) {
      setError(t('UnicodeField.webgl_required'));
      return;
    }
    let program: WebGLProgram | null = null;
    let bloomProgram: WebGLProgram | null = null;
    let downsampleProgram: WebGLProgram | null = null;
    let blurProgram: WebGLProgram | null = null;
    let texture: WebGLTexture | null = null;
    let sceneTexture: WebGLTexture | null = null;
    let sceneBuffer: WebGLFramebuffer | null = null;
    type LightTarget = { texture: WebGLTexture; buffer: WebGLFramebuffer };
    let lightTargets: LightTarget[] = [];
    let vao: WebGLVertexArrayObject | null = null;
    let frame = 0, last = 0, time = 0, disposed = false, failed = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const bloomUniforms = new Map<string, WebGLUniformLocation | null>();
    const downsampleUniforms = new Map<string, WebGLUniformLocation | null>();
    const blurUniforms = new Map<string, WebGLUniformLocation | null>();
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || t('UnicodeField.compile_error');
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };
    const link = (source: string) => {
      const vertex = compile(gl.VERTEX_SHADER, unicodeVertex);
      let fragment: WebGLShader;
      try { fragment = compile(gl.FRAGMENT_SHADER, source); }
      catch (error) { gl.deleteShader(vertex); throw error; }
      const linked = gl.createProgram()!;
      gl.attachShader(linked, vertex);
      gl.attachShader(linked, fragment);
      gl.linkProgram(linked);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(linked) || t('UnicodeField.link_error');
        gl.deleteProgram(linked);
        throw new Error(message);
      }
      return linked;
    };
    const configureTexture = () => {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    const initialize = () => {
      program = link(unicodeFragment);
      bloomProgram = link(unicodeBloomFragment);
      downsampleProgram = link(unicodeDownsampleFragment);
      blurProgram = link(unicodeBlurFragment);
      gl.useProgram(program);
      vao = gl.createVertexArray();
      texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, createUnicodeAtlas());
      configureTexture();
      sceneTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      configureTexture();
      sceneBuffer = gl.createFramebuffer();
      // Base light, shared horizontal scratch, then near / middle / far light.
      lightTargets = Array.from({ length: 5 }, () => {
        const targetTexture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, targetTexture);
        configureTexture();
        return { texture: targetTexture, buffer: gl.createFramebuffer()! };
      });
      uniforms.clear();
      for (const name of ['uResolution', 'uPixelRatio', 'uCellSize', 'uTime', 'uBackground'])
        uniforms.set(name, gl.getUniformLocation(program, name));
      gl.uniform1i(gl.getUniformLocation(program, 'uGlyphs'), 0);
      bloomUniforms.clear();
      gl.useProgram(bloomProgram);
      for (const name of ['uResolution', 'uGlow'])
        bloomUniforms.set(name, gl.getUniformLocation(bloomProgram, name));
      gl.uniform1i(gl.getUniformLocation(bloomProgram, 'uScene'), 0);
      gl.uniform1i(gl.getUniformLocation(bloomProgram, 'uNear'), 1);
      gl.uniform1i(gl.getUniformLocation(bloomProgram, 'uMiddle'), 2);
      gl.uniform1i(gl.getUniformLocation(bloomProgram, 'uFar'), 3);
      gl.useProgram(downsampleProgram);
      downsampleUniforms.clear();
      for (const name of ['uResolution', 'uSourceResolution'])
        downsampleUniforms.set(name, gl.getUniformLocation(downsampleProgram, name));
      gl.uniform1i(gl.getUniformLocation(downsampleProgram, 'uSource'), 0);
      gl.useProgram(blurProgram);
      blurUniforms.clear();
      for (const name of ['uResolution', 'uStep'])
        blurUniforms.set(name, gl.getUniformLocation(blurProgram, name));
      gl.uniform1i(gl.getUniformLocation(blurProgram, 'uSource'), 0);
      // Force the framebuffer texture allocation, including after context restore.
      node.width = 0;
      failed = false;
      setError(null);
      node.dataset.ready = 'true';
    };
    const draw = (now: number) => {
      frame = 0;
      if (disposed || failed || document.hidden || gl.isContextLost() || !program) return;
      const p = current.current;
      const dt = last ? Math.min((now - last) / 1000, .06) : 0;
      last = now;
      if (!p.paused && !reduced.matches) time += dt * p.speed;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(node.clientWidth * dpr));
      const height = Math.max(1, Math.round(node.clientHeight * dpr));
      const lightWidth = Math.max(1, Math.ceil(width / 4));
      const lightHeight = Math.max(1, Math.ceil(height / 4));
      gl.activeTexture(gl.TEXTURE0);
      if (node.width !== width || node.height !== height) {
        node.width = width; node.height = height;
        const targets = [{ texture: sceneTexture!, buffer: sceneBuffer! }, ...lightTargets];
        for (const [i, target] of targets.entries()) {
          gl.bindTexture(gl.TEXTURE_2D, target.texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, i === 0 ? width : lightWidth,
            i === 0 ? height : lightHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            reportError(new Error(t('UnicodeField.light_error')));
            return;
          }
        }
      }
      gl.viewport(0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneBuffer);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform2f(uniforms.get('uResolution')!, width, height);
      for (const [name, value] of Object.entries({ uPixelRatio: dpr, uCellSize: p.cellSize,
        uTime: time, uBackground: p.background }))
        gl.uniform1f(uniforms.get(name)!, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // All broad light is processed at quarter resolution. Full-resolution
      // glyphs are retained separately, including when the glow is turned off.
      if (p.glow > 0) {
        gl.viewport(0, 0, lightWidth, lightHeight);
        gl.useProgram(downsampleProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, lightTargets[0].buffer);
        gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
        gl.uniform2f(downsampleUniforms.get('uResolution')!, lightWidth, lightHeight);
        gl.uniform2f(downsampleUniforms.get('uSourceResolution')!, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(blurProgram);
        gl.uniform2f(blurUniforms.get('uResolution')!, lightWidth, lightHeight);
        const radii = [3, Math.min(width, height) / dpr * .05, Math.max(width, height) / dpr * .16];
        for (const [i, radius] of radii.entries()) {
          const extent = radius * dpr * p.spread * .5;
          gl.bindFramebuffer(gl.FRAMEBUFFER, lightTargets[1].buffer);
          // Feed each larger radius from the previous, already smoothed light
          // layer. Sparse long-distance taps must not resample the glyph grid.
          gl.bindTexture(gl.TEXTURE_2D, lightTargets[i === 0 ? 0 : i + 1].texture);
          gl.uniform2f(blurUniforms.get('uStep')!, extent / width, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, lightTargets[i + 2].buffer);
          gl.bindTexture(gl.TEXTURE_2D, lightTargets[1].texture);
          gl.uniform2f(blurUniforms.get('uStep')!, 0, extent / height);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(bloomProgram);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      for (let i = 0; i < 3; i++) {
        gl.activeTexture(gl.TEXTURE1 + i);
        gl.bindTexture(gl.TEXTURE_2D, lightTargets[i + 2].texture);
      }
      gl.uniform2f(bloomUniforms.get('uResolution')!, width, height);
      gl.uniform1f(bloomUniforms.get('uGlow')!, p.glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!p.paused && !reduced.matches && p.speed > 0) frame = requestAnimationFrame(draw);
    };
    const schedule = () => {
      last = 0;
      if (!frame && !disposed && !failed && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const reportError = (error: unknown) => {
      failed = true;
      node.dataset.ready = 'false';
      setError(error instanceof Error ? error.message : t('UnicodeField.start_error'));
    };
    const lost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
      node.dataset.ready = 'false';
    };
    const restored = () => {
      try { initialize(); schedule(); } catch (error) { reportError(error); }
    };
    wake.current = schedule;
    try { initialize(); schedule(); } catch (error) { reportError(error); }
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    document.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', schedule);
    node.addEventListener('webglcontextlost', lost);
    node.addEventListener('webglcontextrestored', restored);
    return () => {
      disposed = true;
      wake.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      reduced.removeEventListener('change', schedule);
      node.removeEventListener('webglcontextlost', lost);
      node.removeEventListener('webglcontextrestored', restored);
      gl.deleteTexture(texture);
      gl.deleteTexture(sceneTexture);
      gl.deleteFramebuffer(sceneBuffer);
      for (const target of lightTargets) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.buffer);
      }
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteProgram(bloomProgram);
      gl.deleteProgram(downsampleProgram);
      gl.deleteProgram(blurProgram);
    };
  }, []);

  return <><canvas ref={canvas} className="unicode-canvas" role="img"
    aria-label={t('UnicodeField.description')} />
    {error && <p className="unicode-error" role="alert">{error}</p>}</>;
}
