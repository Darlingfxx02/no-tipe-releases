import { useId, type CSSProperties } from 'react';
import { t, useLocale } from './i18n';
import { resolveTheme, themeOptions, themeSwatch } from './theme';
import './theme-picker.css';

export function ThemePicker({ value, onChange }: { value: string; onChange: (palette: string) => void }) {
  useLocale();
  const id = useId(), selected = resolveTheme(value);
  return <section className="customization-themes" aria-labelledby={id}>
    <h2 id={id}>{t('Settings.color_theme')}</h2>
    <div className="theme-gallery" role="radiogroup" aria-labelledby={id}>
      {themeOptions.map(([palette, name]) => <label className="theme-card" key={palette} data-selected={selected === palette}>
        <input type="radio" name={`${id}-palette`} value={palette} checked={selected === palette} onClick={event => event.currentTarget.focus()} onChange={() => onChange(palette)} />
        {/* Palette selection stays separate from appearance. A future light
            preview can share this row without changing saved palette names. */}
        <span className="theme-card-previews" aria-hidden="true">
          <span className="theme-card-preview" data-appearance="dark" style={{ '--theme-swatch': themeSwatch(palette) } as CSSProperties}>
            <span className="theme-card-orb" />
          </span>
        </span>
        <span className="theme-card-name">{name}</span>
      </label>)}
    </div>
  </section>;
}
