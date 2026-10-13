import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, errorSource } from './api';
import { Icon, SettingsGroup as Panel, Row } from './ui';
import './legal.css';

const getDocuments = () => ({
  license: { title: t('Legal.no_tipe_license'), path: '/LICENSE.txt' },
  notice: { title: t('Legal.no_type_attribution'), path: '/NOTICE.txt' },
  thirdParty: { title: t('Legal.third_party_licenses'), path: '/THIRD-PARTY-LICENSES.txt' },
} as const);
type Document = keyof ReturnType<typeof getDocuments>;

export function LegalPanel() {
  useLocale();
  const [document, setDocument] = useState<Document | null>(null);
  return <Panel title={t('Legal.license_and_notices')} titleIcon={<Icon name="document" src="/assets/mode-icons/document-text.svg" size={18}/>}>
    <Row title="No Type" description={t('Legal.apache_2_0_copyright_2026_darlingfxx02')}>
      <button onClick={() => setDocument('license')}>{t('Legal.view_license')}</button>
      <button onClick={() => setDocument('notice')}>{t('Legal.view_attribution')}</button>
    </Row>
    <Row title={t('Legal.third_party_licenses')}>
      <button onClick={() => setDocument('thirdParty')}>{t('Legal.view_notices')}</button>
    </Row>
    {document && <LegalDocument key={document} document={document} onClose={() => setDocument(null)}/>}
  </Panel>;
}

function LegalDocument({ document, onClose }: { document: Document; onClose: () => void }) {
  useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(''), [error, setError] = useState('');
  const { title, path } = getDocuments()[document];
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, { signal: controller.signal }).then(async response => {
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error(t('Legal.the_bundled_license_could_not_be_loaded'));
      }
      const content = await response.text();
      if (!content.trim()) throw new Error(t('Legal.the_bundled_license_is_empty'));
      if (!controller.signal.aborted) setText(content);
    }).catch(error => { if (!controller.signal.aborted) setError(errorSource(error)); });
    return () => controller.abort();
  }, [path]);
  return <dialog ref={dialog} className="legal-dialog" aria-labelledby="legal-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id="legal-title">{title}</h2><button aria-label={t('common.close')} onClick={onClose}>×</button></header>
    {error ? <p role="alert" className="field-error">{errorMessage(error)}</p> : text ? <div className="legal-document" tabIndex={0} aria-label={title}>{text}</div> : <p role="status" className="muted">{t('Legal.loading_license')}</p>}
    <footer><button onClick={onClose}>{t('common.done')}</button></footer>
  </dialog>;
}
