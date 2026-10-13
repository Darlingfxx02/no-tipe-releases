import { useLayoutEffect } from 'react';
import cloud from './generated/cloudWave.json';
import { accentMaterial, materialFill } from './accentMaterial';
import { resolveTheme, type ThemeName } from './themeNames';
import './theme-materials.css';
export { themeOptions, resolveTheme } from './themeNames';

interface Palette { accent: string; colors: number[][]; highlights?: number[][]; neutral?: boolean }

interface KeyMaterial { ink: string; face: string[]; rim: string[]; sheen: string[] }

// Data marks use vivid, flat colors instead of the recorder's shaded material.
const chartColors: Record<ThemeName, string> = {
  prism:'#9e8acb', aurora:'#18cfa0', lagoon:'#16b6c9', sakura:'#ef568e',
  ember:'#a8a8a8', dune:'#e4ae37', siri:'#9676f5', sber:'#20c55b',
};

// Every theme uses the original black Sber keycap on the Dashboard.
const dashboardKeycap: KeyMaterial = {
  ink:'#ffffff',face:['#1b1d20','#131416','#0e0f11'],
  rim:['#2c2e31','#0b0c0e'],sheen:['#25272a','#191a1d'],
};
export function insightsMaterial(_name: string): KeyMaterial {
  return dashboardKeycap;
}

// The recorder, dashboard and controls all read the same palette definition.
export function themePalette(name: string): Palette {
  return cloud.palettes[resolveTheme(name)];
}

// Show the wave's color combination in the picker, including its second accent.
export function themeSwatch(name: string): string {
  const colors = themePalette(name).colors.map(color => '#' + color.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join(''));
  return `radial-gradient(ellipse at 10% 100%, ${colors[2]}, transparent 68%), radial-gradient(ellipse at 100% 0%, ${colors[1]}, transparent 72%), ${colors[0]}`;
}

export function themeLuminance(accent: string, brightness = 1): number {
  const rgb = accent.slice(1).match(/../g)!.map(hex => Math.min(parseInt(hex, 16) / 255 * brightness, 1));
  const linear = rgb.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}

// Action surfaces stay neutral across themes; recorder palettes supply the
// colors for selected items, focus, charts and lighting.
export function themeTokens(name: string): Record<string,string> {
  const palette = resolveTheme(name);
  const accent = themePalette(palette).accent;
  const chart = chartColors[palette];
  const action = accentMaterial(palette);
  const material = insightsMaterial(palette);
  return {
    '--accent':accent,
    '--accent-bottom':accent,
    '--accent-hover':`color-mix(in srgb, ${accent}, white 10%)`,
    '--accent-soft':`color-mix(in srgb, ${accent}, transparent 86%)`,
    '--accent-border':`color-mix(in srgb, ${accent}, transparent 62%)`,
    '--accent-glow':`color-mix(in srgb, ${accent}, transparent 84%)`,
    '--accent-text':`color-mix(in srgb, ${accent}, white 64%)`,
    '--accent-pale':`color-mix(in srgb, ${accent}, #ededf1 91%)`,
    '--control-ink':'#000000',
    '--control-top':'#ffffff',
    '--control-bottom':'#ffffff',
    '--control-hover':'#ededed',
    '--control-disabled':'#b0b0b0',
    '--control-disabled-ink':'#323232',
    '--primary-fill':'#ffffff',
    '--primary-hover-fill':'#ededed',
    '--primary-active-fill':'#dedede',
    '--secondary-fill':'#ffffff12',
    '--secondary-hover-fill':'#ffffff19',
    '--secondary-active-fill':'#ffffff0d',
    '--secondary-ink':'#ededf1',
    '--chart-fill':chart,
    '--chart-hover-fill':`color-mix(in srgb, ${chart}, white 10%)`,
    '--chart-label':'#ffffff',
    '--chart-rim':'rgb(255 255 255 / .1)',
    '--chart-cell-rim-1':'transparent',
    '--chart-cell-rim-2':'rgb(255 255 255 / .015)',
    '--chart-cell-rim-3':'rgb(255 255 255 / .03)',
    '--chart-cell-rim-4':'rgb(255 255 255 / .05)',
    '--chart-level-1':`color-mix(in srgb, ${chart} 32%, #101012)`,
    '--chart-level-2':`color-mix(in srgb, ${chart} 54%, #101012)`,
    '--chart-level-3':`color-mix(in srgb, ${chart} 77%, #101012)`,
    '--accent-fill':materialFill(action),
    '--accent-hover-fill':materialFill(accentMaterial(palette, 'hover')),
    '--accent-fill-soft':materialFill(action, .14),
    '--accent-fill-faint':materialFill(action, .07),
    '--keycap-face-top':'#ffffff',
    '--keycap-face-bottom':'#e8e8e8',
    '--keycap-edge-bottom':'#b0b0b0',
    '--insights-ink':material.ink,
    '--insights-rim':`linear-gradient(160deg, ${material.rim[0]}, ${material.rim[1]})`,
    '--insights-face':`radial-gradient(ellipse at 95% 8%, ${material.sheen[0]}, transparent 60%), radial-gradient(ellipse at 0% 95%, ${material.sheen[1]}, transparent 58%), linear-gradient(155deg, ${material.face[0]} 0%, ${material.face[1]} 48%, ${material.face[2]} 100%)`,
    '--focus-ring':`color-mix(in srgb, ${accent}, white 48%)`,
    '--key-icon-opacity':'.78',
  };
}

export function useTheme(name: string) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = resolveTheme(name);
    for (const [token,value] of Object.entries(themeTokens(name))) root.style.setProperty(token,value);
  }, [name]);
}
