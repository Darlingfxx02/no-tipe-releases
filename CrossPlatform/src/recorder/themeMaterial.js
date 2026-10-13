// One palette treatment for both pixel recorder surfaces. Liquid material keeps
// its established tint; the robot uses all three theme colors in its glass.
export const recorderThemeMaterial = `
uniform float uPixelMaterial;
uniform float uPixelHalo;
uniform float uMonochromeMaterial;
uniform vec3 uThemeColor0;
uniform vec3 uThemeColor1;
uniform vec3 uThemeColor2;
float recorderPixelHalo(float distance, float pixelScale, float intensity) {
  float d = max(distance, 0.) / max(pixelScale, .001);
  // Fade along the surface contour to zero before the 64px render margin.
  // Cap emission separately from the brightness of the robot's material.
  float fade = 1. - smoothstep(16., 32., d);
  return uPixelHalo * exp(-d / 6.) * fade * clamp(intensity, 0., 1.) * .006;
}
vec3 recorderMaterialTheme(vec3 color, vec2 uv, vec3 accent, float neutral) {
  const vec3 luma = vec3(.2126, .7152, .0722);
  float brightness = dot(color, luma);
  vec3 gradient = mix(uThemeColor2, uThemeColor0, smoothstep(0., 1., uv.y));
  float reflection = smoothstep(0., 1., uv.x) * (1. - smoothstep(0., 1., uv.y));
  gradient = mix(gradient, uThemeColor1, reflection * .8);
  vec3 tint = mix(accent, gradient, uPixelMaterial);
  vec3 themed = tint * brightness / max(dot(tint, luma), .01);
  vec3 material = mix(color, themed, mix(.16, .9, uPixelMaterial));
  material *= mix(1., 1.65, uPixelMaterial);
  return mix(material, vec3(dot(material, luma)), max(uMonochromeMaterial, neutral * (1. - uPixelMaterial)));
}
`;
