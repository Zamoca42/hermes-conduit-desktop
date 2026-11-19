import { t } from '@shared/i18n'
import { Icon } from './icons'
import { catalogNote, type ModelCatalog } from '../state/modelCatalog'

/**
 * What a model picker says under its models, as the phone's
 * ModelCatalogPlaceholder: loading, a read that failed with Try Again, or
 * a catalog that loaded empty.
 */
export function ModelCatalogNote({ catalog }: { catalog: ModelCatalog }) {
  const note = catalogNote(catalog)
  if (note === 'failed')
    return (
      <div className="model-note error model-catalog-note">
        {t('Could not load models.')}
        <button type="button" className="link-button" disabled={catalog.loading || catalog.refreshing} onClick={catalog.tryAgain}>
          {t('Try Again')}
        </button>
      </div>
    )
  if (note === 'empty') return <div className="model-note model-catalog-note">{t('No models are available from this gateway.')}</div>
  if (note === 'loading') return <div className="model-note model-catalog-note">{t('Loading…')}</div>
  return null
}

/** Refresh models: Hermes fetches every provider's live list before it answers, which can take a while. */
export function RefreshModelsButton({ catalog }: { catalog: ModelCatalog }) {
  return (
    <button
      className="staged-remove refresh-models"
      aria-label={t('Refresh models')}
      title={t('Refresh models')}
      disabled={catalog.refreshing}
      onClick={catalog.refresh}
    >
      <Icon name={catalog.refreshing ? 'spinner' : 'refresh'} style={catalog.refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
    </button>
  )
}
