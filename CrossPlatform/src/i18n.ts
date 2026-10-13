import i18next from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

export type UiLanguage = 'system' | 'en' | 'ru';
export type Locale = Exclude<UiLanguage, 'system'>;
export type MessageKey = keyof typeof en;
export const localePreferenceKey = 'no-tipe.ui-language.v1';
export const supportedLocales = ['en', 'ru'] as const;

export function resolveLocale(preference: string, languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): Locale {
  if (preference === 'en' || preference === 'ru') return preference;
  // Use the preferred system language, with English for unsupported languages.
  return languages[0]?.toLowerCase().split(/[-_]/)[0] === 'ru' ? 'ru' : 'en';
}
export function cachedLanguage(): UiLanguage {
  try { const value = localStorage.getItem(localePreferenceKey); return value === 'en' || value === 'ru' ? value : 'system'; }
  catch { return 'system'; }
}
export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: resolveLocale(cachedLanguage()), supportedLngs: [...supportedLocales],
  fallbackLng: 'en', load: 'languageOnly', keySeparator: false,
  initAsync: false, interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export function t(key: MessageKey, values?: Record<string, unknown>): string {
  return i18n.t(key, values ?? {}) as string;
}
// Subscribe each view so retained views, dialogs and separate recorder windows
// update in place without remounting or losing drafts.
export function useLocale(): Locale {
  const { i18n: instance } = useTranslation(undefined, { i18n });
  return instance.resolvedLanguage === 'ru' ? 'ru' : 'en';
}
export function locale(): Locale { return i18n.resolvedLanguage === 'ru' ? 'ru' : 'en'; }
export function setUiLanguage(preference: UiLanguage, persistCache = true, languages?: readonly string[]): void {
  if (persistCache) { try { localStorage.setItem(localePreferenceKey, preference); } catch { /* settings remain in the native store */ } }
  const next = resolveLocale(preference, languages);
  if (locale() !== next) void i18n.changeLanguage(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}
setUiLanguage(cachedLanguage(), false);
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale(), options).format(value);
export const formatDate = (value: Date | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), options).format(value);

export function translateMessage(message: string): string {
  const prefix = 'no-tipe-i18n:';
  if (!message.startsWith(prefix)) return message;
  const payload=message.slice(prefix.length);
  if(Object.hasOwn(en,payload))return t(payload as MessageKey);
  try {
    const decoded=JSON.parse(payload) as {key?:unknown;values?:unknown};
    if(typeof decoded.key==='string'&&Object.hasOwn(en,decoded.key)&&decoded.values&&typeof decoded.values==='object'&&!Array.isArray(decoded.values)) {
      const values=Object.fromEntries(Object.entries(decoded.values).map(([key,value])=>[key,typeof value==='string'?translateMessage(value):value]));
      return t(decoded.key as MessageKey,values);
    }
  } catch { /* Preserve diagnostics from unknown app/provider versions. */ }
  return message;
}
