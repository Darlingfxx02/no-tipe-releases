export const themeOptions = [
  ['prism', 'Prism'], ['aurora', 'Aurora'], ['lagoon', 'Opal'],
  ['sakura', 'Sakura'], ['ember', 'Chromium'], ['dune', 'Dune'],
  ['siri', 'Siri'], ['sber', 'Sber'],
] as const;

export type ThemeName = typeof themeOptions[number][0];

// Resolve saved preferences and backups from the retired monochrome collection.
const legacyThemes: Record<string, ThemeName> = {
  indigo: 'prism', blue: 'lagoon', cyan: 'aurora',
  purple: 'sakura', rose: 'ember', amber: 'dune',
};

export function resolveTheme(name: string): ThemeName {
  return Object.hasOwn(legacyThemes, name) ? legacyThemes[name] : (themeOptions.find(([id]) => id === name)?.[0] ?? 'prism');
}
