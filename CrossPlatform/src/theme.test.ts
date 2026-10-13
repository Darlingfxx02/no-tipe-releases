import { expect, test } from 'vitest';
import { insightsMaterial, themeLuminance, themeOptions, themePalette, themeTokens, resolveTheme } from './theme';
import { accentMaterial } from './accentMaterial';

function mix(top: string, bottom: string, position: number): string {
  const channels = (color: string) => color.slice(1).match(/../g)!.map(hex => parseInt(hex, 16));
  const end = channels(bottom);
  return '#' + channels(top).map((value, i) => Math.round(value + (end[i] - value) * position).toString(16).padStart(2, '0')).join('');
}

test('all themes keep labels and icons readable across control gradients and states', () => {
  for (const [name] of themeOptions) {
    const tokens = themeTokens(name);
    expect(tokens['--control-ink'], name).toBe('#000000');
    // Neutral action and keyboard faces retain contrast through hover.
    const gradients = [
      ['primary', '--control-top', '--control-bottom', 1],
      ['primary hover', '--control-hover', '--control-top', 1],
      ['primary active', '--control-bottom', '--control-bottom', 1],
      ['disabled', '--control-disabled', '--control-disabled', 1],
      ['keycap', '--keycap-face-top', '--keycap-face-bottom', 1],
      ['keycap hover/pressed', '--keycap-face-top', '--keycap-face-bottom', 1.08],
    ] as const;
    for (const [state, top, bottom, brightness] of gradients) {
      const minimumContrast = 4.5;
      for (let step = 0; step <= 20; step++) {
        const background = mix(tokens[top], tokens[bottom], step / 20);
        const ink = themeLuminance(tokens[state==='disabled'?'--control-disabled-ink':'--control-ink'], brightness);
        const fill = themeLuminance(background, brightness);
        const ratio = (Math.max(ink,fill)+.05)/(Math.min(ink,fill)+.05);
        expect(ratio, `${name}: ${state}, ${step * 5}%`).toBeGreaterThanOrEqual(minimumContrast);
      }
    }
    expect(tokens['--accent'], name).toBe(themePalette(name).accent);
  }
});
test('retired themes resolve consistently across controls, waves and keycaps', () => {
  const replacements = {indigo:'prism',blue:'lagoon',cyan:'aurora',purple:'sakura',rose:'ember',amber:'dune'};
  expect(themeOptions.map(([name])=>name)).toEqual(['prism','aurora','lagoon','sakura','ember','dune','siri','sber']);
  for (const [oldName, newName] of Object.entries(replacements)) {
    expect(resolveTheme(oldName)).toBe(newName);
    expect(themeTokens(oldName)).toEqual(themeTokens(newName));
    expect(themePalette(oldName)).toEqual(themePalette(newName));
    expect(insightsMaterial(oldName)).toEqual(insightsMaterial(newName));
  }
  for (const invalid of ['unknown', 'constructor', '__proto__']) {
    expect(themeTokens(invalid)).toEqual(themeTokens('prism'));
  }
});
test('Chromium replaces Ember with neutral waves, glass and controls while retaining saved selections', () => {
  expect(themeOptions.find(([name])=>name==='ember')?.[1]).toBe('Chromium');
  const palette=themePalette('ember');
  expect(palette.neutral).toBe(true);
  for(const color of [...palette.colors,...palette.highlights!])expect(color[0]===color[1]&&color[1]===color[2]).toBe(true);
  const neutral=(hex:string)=>{const channels=hex.slice(1,7).match(/../g)!;return channels[0]===channels[1]&&channels[1]===channels[2];};
  const material=accentMaterial('ember');
  for(const color of [palette.accent,...material.face,...material.reflections.flatMap(reflection=>reflection.colors),themeTokens('ember')['--chart-fill']])expect(neutral(color),color).toBe(true);
  expect(themePalette('rose')).toEqual(palette);
});
test('all themes use white primary buttons and the original black Sber Insights keycap', () => {
  const reference = themeTokens('sber');
  for (const [name] of themeOptions) {
    const tokens = themeTokens(name);
    expect(tokens['--primary-fill']).toBe('#ffffff');
    expect(tokens['--primary-hover-fill']).toBe('#ededed');
    expect(tokens['--primary-active-fill']).toBe('#dedede');
    expect(tokens['--control-ink']).toBe('#000000');
    expect(tokens['--insights-ink']).toBe('#ffffff');
    expect(tokens['--insights-face']).toBe(reference['--insights-face']);
    expect(tokens['--insights-rim']).toBe(reference['--insights-rim']);
    expect(tokens['--accent-fill']).not.toBe(tokens['--primary-fill']);
  }
  expect(themePalette('sber').accent).toBe('#21a038');
});

test('Insights labels remain readable throughout each material, including hover', () => {
  for (const [name] of themeOptions) {
    const material = insightsMaterial(name);
    const colors = [...material.face, ...material.sheen].map(color=>color.slice(1).match(/../g)!.map(hex=>parseInt(hex,16)));
    // Every composited gradient pixel stays between these channel bounds.
    const bounds = [Math.min, Math.max].map(bound=>'#'+[0,1,2].map(channel=>bound(...colors.map(color=>color[channel])).toString(16).padStart(2,'0')).join(''));
    for (const brightness of [1,1.08]) {
      const ink = themeLuminance(material.ink,brightness);
      for (const background of bounds) {
        const fill = themeLuminance(background,brightness);
        const contrast = (Math.max(ink,fill)+.05)/(Math.min(ink,fill)+.05);
        expect(contrast,`${name}, ${brightness}, ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
