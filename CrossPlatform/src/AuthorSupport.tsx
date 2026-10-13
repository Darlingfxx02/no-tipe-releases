import { t, useLocale } from './i18n';
export const AUTHOR_BOOSTY_URL = 'https://boosty.to/notipe';

export function AuthorSupport({ onOpen }: { onOpen: () => void }) {
  useLocale();
  return <button type="button" className="author-support" onClick={onOpen}
    aria-label={t('AuthorSupport.support_the_author_on_boosty')}>
    <img className="support-boosty" src="/assets/boosty-mark.svg" width="18" height="22" alt="" aria-hidden="true"/>
    <span className="support-title">{t('AuthorSupport.support_the_author')}</span>
  </button>;
}
