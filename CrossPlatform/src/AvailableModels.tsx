import { t, useLocale } from './i18n';
import type { Model } from './types';
import { modelReady } from './fileTranscription';
import { Empty } from './ui';
import { NoTypeButton } from './DesignControls';
import './available-models.css';

export function AvailableModels({ models, onManage }: { models: Model[]; onManage: () => void }) {
  useLocale();
  const groups = [
    { id: 'local', title: t('AvailableModels.on_device'), models: models.filter(model => model.local), empty: t('AvailableModels.download_a_local_model_in_ai_models') },
    { id: 'cloud', title: t('AvailableModels.cloud'), models: models.filter(model => !model.local), empty: t('AvailableModels.connect_a_provider_with_your_api_key_in') },
  ];

  return <section className="available-models" aria-labelledby="available-models-title">
    <div className="available-models-panel panel">
      <header className="available-models-heading">
        <h2 id="available-models-title">{t('AvailableModels.available_models')}</h2>
        <NoTypeButton onClick={onManage}>{t('AvailableModels.manage_models')}</NoTypeButton>
      </header>
      <div className="available-models-groups">
        {groups.map(group => {
          const ready = group.models.filter(modelReady);
          return <div className="available-models-group" key={group.id}>
            <h3>{group.title}<span>{ready.length} {t('AvailableModels.ready')} {group.models.length} {t('AvailableModels.in_library')}</span></h3>
            {ready.length ? <ul className="available-models-list">
              {ready.map(model => <li key={model.id}>{model.name}</li>)}
            </ul> : <Empty compact icon="models" title={t(group.id==='local'?'Empty.no_installed_models':'Empty.no_connected_models')} body={group.empty}><NoTypeButton onClick={onManage}>{t('AvailableModels.manage_models')}</NoTypeButton></Empty>}
          </div>;
        })}
      </div>
    </div>
  </section>;
}
