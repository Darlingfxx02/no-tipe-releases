import definitions from './accentMaterials.json';
import { resolveTheme } from './themeNames';

export interface AccentMaterial {
  face: string[];
  /** Ellipse radii and center, as percentages of the painted element. */
  position: number[];
  reflections: { position: number[]; colors: string[] }[];
  hover?: { face: string[]; reflection: string[] };
  active?: { face: string[]; reflection: string[] };
}
export type MaterialState = 'rest' | 'hover' | 'active';

function shade(color: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  return '#' + color.slice(1, 7).match(/../g)!.map(hex => {
    const value = parseInt(hex, 16);
    return Math.round(value + (target - value) * Math.abs(amount)).toString(16).padStart(2, '0');
  }).join('') + color.slice(7);
}

export function accentMaterial(name: string, state: MaterialState = 'rest'): AccentMaterial {
  const material: AccentMaterial = definitions[resolveTheme(name)];
  if (state === 'rest') return material;
  const override = material[state];
  const amount = state === 'hover' ? .025 : -.07;
  return {
    ...material,
    face: override?.face ?? material.face.map(color => shade(color, amount)),
    reflections: material.reflections.map((reflection, index) => ({
      ...reflection,
      colors: override && index === 0 ? override.reflection : reflection.colors.map(color => shade(color, amount)),
    })),
  };
}

function alpha(color: string, opacity: number): string {
  const original = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  return color.slice(0, 7) + Math.round(original * opacity * 255).toString(16).padStart(2, '0');
}

export function materialFill(material: AccentMaterial, opacity = 1): string {
  const ellipse = (position: number[], colors: string[], stops: number[]) =>
    `radial-gradient(ellipse ${position[0]}% ${position[1]}% at ${position[2]}% ${position[3]}%, ${colors.map((color, index) => `${opacity === 1 ? color : alpha(color, opacity)} ${stops[index]}%`).join(', ')})`;
  return [
    ...material.reflections.map(reflection => ellipse(reflection.position, reflection.colors, [0, 32, 72])),
    ellipse(material.position, material.face, [0, 42, 100]),
  ].join(', ');
}
