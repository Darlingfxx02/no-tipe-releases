// One atlas of real Unicode glyphs; the fragment shader selects their density
// from a continuous light field rather than scattering random characters.
export const unicodeGlyphs = ['·', '⁙', '+', '✣', '⊟', '✚', '⊞', '■'] as const;

export const unicodeVertex = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const unicodeFragment = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uCellSize;
uniform float uTime;
uniform float uBackground;
uniform sampler2D uGlyphs;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

// A broad, folded ribbon. Coordinate warping keeps the motion continuous,
// including the cell-to-cell transitions in the faint exterior texture.
float field(vec2 uv) {
  float t = uTime;
  vec2 q = uv;
  q += vec2(sin(uv.y * 5.0 + t * .27), cos(uv.x * 4.0 - t * .21)) * .027;
  float center = .63 - .22 * q.x + .028 * sin(q.x * 7.0 + t * .22);
  float ribbon = exp(-pow((q.y - center) / .19, 4.0));
  float entrance = smoothstep(.13, .28, q.x + .04 * sin(q.y * 5.0 - t * .2));
  float fold = exp(-pow((q.x - .33) / .16, 4.0)
                   -pow((q.y - .58) / .21, 4.0));
  float shape = max(ribbon * entrance, fold * .93);
  float clouds = noise(q * 5.5 + vec2(t * .055, -t * .032));
  float detail = noise(q * 17.0 + vec2(-t * .035, t * .04));
  float light = .59 + .42 * clouds + .12 * detail;
  float highlight = .22 * exp(-pow((q.x - .81) / .32, 2.0)
                             -pow((q.y - .42) / .065, 2.0));
  float halo = exp(-pow((q.y - center) / .24, 2.0)) * entrance * .075;
  return shape * (light + highlight) + halo;
}
vec3 spectrum(vec2 uv, float light) {
  float shift = .022 * sin(uTime * .17);
  float cyan = smoothstep(.37, .78, uv.x + (uv.y - .47) * 1.75 + shift);
  vec3 violet = mix(vec3(.24, .18, 1.0), vec3(.70, .29, 1.0),
                   exp(-pow((uv.x - .38) / .23, 2.0) - pow((uv.y - .31) / .17, 2.0)));
  vec3 color = mix(violet, vec3(.06, .94, 1.0), cyan);
  return mix(color, vec3(.91, 1.0, 1.0), smoothstep(1.04, 1.26, light));
}
float glyph(vec2 local, float index) {
  // The 64px atlas tiles include a guard margin, so linear filtering cannot
  // bleed one Unicode character into its neighbour.
  return texture(uGlyphs, vec2((index + local.x) / 8.0, local.y)).a;
}
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 uv = pixel / uResolution;
  float cellSize = uCellSize * uPixelRatio;
  vec2 cell = floor(pixel / cellSize);
  vec2 center = (cell + .5) * cellSize / uResolution;
  vec2 local = fract(pixel / cellSize);
  float light = field(center);
  float grain = hash(cell);
  float texture = noise(center * 11.0 + vec2(uTime * .025, 0.0));
  float density = light * .80 + (texture - .5) * .18;
  float index = floor(clamp(density * 7.0, 0.0, 7.0));
  // Brighter cells occasionally become solid; most retain visible counters.
  if (light > .96 && grain > .88) index = 7.0;
  float mask = glyph(local, index);
  float faint = .044 + .036 * texture;
  float strength = faint + pow(max(light, 0.0), 1.5) * 1.22;
  vec3 color = spectrum(center, light);
  vec3 ink = color * mask * strength;

  float smoothLight = field(uv);
  vec3 background = spectrum(uv, smoothLight) * pow(smoothLight, 2.0)
                    * .06 * uBackground;
  outColor = vec4(ink + background, 1.0);
}`;

// Average the source before the wide blur to avoid sampling only the gaps
// between glyphs when rendering into the quarter-resolution light buffers.
export const unicodeDownsampleFragment = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uResolution;
uniform vec2 uSourceResolution;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 light = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 offset = (vec2(float(x), float(y)) - 1.5) / uSourceResolution;
      light += texture(uSource, uv + offset).rgb;
    }
  }
  outColor = vec4(light / 16.0, 1.0);
}`;

// A separable exponential kernel: exp(-abs(distance) / radius). Three radii
// combine a small halo with a long, gradually fading tail over the whole field.
// There is no border mask or vignette applied to the emitted light.
export const unicodeBlurFragment = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uResolution;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 light = vec3(0.0);
  float total = 0.0;
  for (int i = -12; i <= 12; i++) {
    float weight = exp(-abs(float(i)) * .5);
    light += texture(uSource, uv + float(i) * uStep).rgb * weight;
    total += weight;
  }
  outColor = vec4(light / total, 1.0);
}`;

export const unicodeBloomFragment = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uNear;
uniform sampler2D uMiddle;
uniform sampler2D uFar;
uniform vec2 uResolution;
uniform float uGlow;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 bloom = texture(uNear, uv).rgb * .44
             + texture(uMiddle, uv).rgb * .70
             + texture(uFar, uv).rgb * 1.50;
  vec3 face = texture(uScene, uv).rgb;
  outColor = vec4(face + bloom * uGlow, 1.0);
}`;

export function createUnicodeAtlas(): HTMLCanvasElement {
  const tile = 64;
  const atlas = document.createElement('canvas');
  atlas.width = tile * unicodeGlyphs.length;
  atlas.height = tile;
  const ctx = atlas.getContext('2d');
  if (!ctx) throw new Error('Не удалось создать атлас символов.');
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '48px Menlo, "DejaVu Sans Mono", "Arial Unicode MS", monospace';
  unicodeGlyphs.forEach((character, index) => {
    // Center each actual glyph's ink, including Unicode fallback fonts.
    const metrics = ctx.measureText(character);
    const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
    const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    const scale = 46 / Math.max(width, height);
    // Keep sparse marks small; fit square symbols to the same cell footprint.
    const fit = index < 2 ? 1 : scale;
    ctx.save();
    ctx.translate(index * tile + tile / 2, tile / 2);
    ctx.scale(fit, fit);
    ctx.fillText(character, (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
      (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
    ctx.restore();
  });
  return atlas;
}
