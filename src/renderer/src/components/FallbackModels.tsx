import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { delegateChain, fallbackList, isComplete, moved, sameList, savedValue, type Fallback } from '../state/fallbacks'
import { groupModels } from '../state/models'
import { readConfig, updateConfig, withValue, type Http } from '../state/profileConfig'
import { ModelChooser } from './ModelChooser'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'

const http: Http = (method, path, body) => gateway.http(method, path, body)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

interface Props {
  profile: string
  /** The subagents' list (`delegation.fallback_providers`), which can follow the chat's. */
  delegate?: boolean
}

/** Settings > Models' Fallback models, and Memory & delegation's Delegate fallback models, after the phone's. */
export function FallbackModels({ profile, delegate = false }: Props) {
  const key = delegate ? 'delegation.fallback_providers' : 'fallback_providers'
  const [entries, setEntries] = useState<Fallback[] | null>(null)
  const [saved, setSaved] = useState<Fallback[]>([])
  const [inherits, setInherits] = useState(false)
  const [savedInherits, setSavedInherits] = useState(false)
  const catalog = useModelCatalog(
    useMemo(() => (profile !== 'default' ? { explicit_only: true, profile } : { explicit_only: true }), [profile]),
    { quietReadAgain: true }
  )
  const providers = catalog.providers ?? []
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = useRef(0)

  const load = useCallback(async () => {
    const mine = ++read.current
    setError(null)
    try {
      const config = await readConfig(http, profile)
      if (read.current !== mine) return
      const chain = delegate ? delegateChain(config) : { inherits: false, entries: fallbackList(config.fallback_providers) }
      setEntries(chain.entries)
      setSaved(chain.entries)
      setInherits(chain.inherits)
      setSavedInherits(chain.inherits)
    } catch (e) {
      if (read.current === mine) setError(t('Could not load fallback models.') + ` ${message(e)}`)
    }
  }, [profile, delegate])

  useEffect(() => {
    setEntries(null)
    void load()
  }, [load, profile])

  const groups = useMemo(() => groupModels(providers, ''), [providers])
  const list = entries ?? []
  const own = !(delegate && inherits)
  const changed = inherits !== savedInherits || (own && !sameList(list, saved))
  // A list that didn't load is never edited or saved.
  const canSave = !!entries && !saving && changed && catalog.answered && (!own || list.every(isComplete))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateConfig(http, profile, config => withValue(config, key, savedValue(delegate && inherits, list)))
      const kept = list.filter(isComplete)
      setEntries(kept)
      setSaved(kept)
      setSavedInherits(delegate && inherits)
    } catch (e) {
      setError(t('Could not save fallback models: {error}', { error: message(e) }))
    } finally {
      setSaving(false)
    }
  }

  const set = (index: number, entry: Fallback) => setEntries(list.map((e, i) => (i === index ? entry : e)))

  return (
    <section className="pset-section">
      <h2 className="model-section-title">
        {delegate ? t('Delegate fallback models') : t('Fallback models')}
        {own ? <RefreshModelsButton catalog={catalog} /> : null}
      </h2>
      <p className="meta">
        {delegate
          ? t(
              "If a subagent's model fails, Hermes tries these in order. A subagent on the chat's model can use the chat's fallbacks; one on its own delegate model or route gets none unless these are its own."
            )
          : t('If the default model fails, Hermes tries these in order.')}
      </p>
      {!entries ? (
        error ? (
          <div className="pset-row">
            <span className="error-text">{error}</span>
            <button className="secondary" onClick={() => void load()}>
              {t('Try Again')}
            </button>
          </div>
        ) : (
          <p className="meta">{t('Loading available models…')}</p>
        )
      ) : (
        <>
          {delegate ? (
            <div className="segmented" role="radiogroup" aria-label={t('Fallbacks')}>
              <button role="radio" aria-checked={inherits} className={inherits ? 'on' : ''} disabled={saving} onClick={() => setInherits(true)}>
                {t('Same as the chat')}
              </button>
              <button role="radio" aria-checked={!inherits} className={!inherits ? 'on' : ''} disabled={saving} onClick={() => setInherits(false)}>
                {t('Their own')}
              </button>
            </div>
          ) : null}
          {own ? (
            <>
              {list.length === 0 ? (
                <p className="meta">{delegate ? t("None: a subagent's model that fails isn't retried on another.") : t('No fallback models yet.')}</p>
              ) : null}
              <ol className="fallback-list">
                {list.map((entry, index) => {
                  const value = entry.provider || entry.model ? `${entry.provider}\n${entry.model}` : ''
                  return (
                    <li key={index} className="pset-row">
                      <span className="fallback-rank">{index + 1}</span>
                      <ModelChooser
                        value={value}
                        providers={providers}
                        defaultLabel={null}
                        disabled={saving}
                        label={t('Fallback {number}', { number: String(index + 1) })}
                        onChange={next => {
                          const [provider = '', model = ''] = next.split('\n')
                          // A different model keeps no routing written for the old one.
                          set(index, { provider, model, extras: provider === entry.provider ? entry.extras : {} })
                        }}
                      />
                      <button
                        className="staged-remove"
                        disabled={saving || index === 0}
                        aria-label={t('Move up')}
                        title={t('Move up')}
                        onClick={() => setEntries(moved(list, index, -1))}
                      >
                        ↑
                      </button>
                      <button
                        className="staged-remove"
                        disabled={saving || index === list.length - 1}
                        aria-label={t('Move down')}
                        title={t('Move down')}
                        onClick={() => setEntries(moved(list, index, 1))}
                      >
                        ↓
                      </button>
                      <button
                        className="staged-remove"
                        disabled={saving}
                        aria-label={t('Delete')}
                        title={t('Delete')}
                        onClick={() => setEntries(list.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : null}
          <div className="pset-actions">
            {own ? (
              <button
                className="secondary"
                disabled={saving || !catalog.answered || !groups.length}
                onClick={() => setEntries([...list, { provider: '', model: '', extras: {} }])}
              >
                {t('Add fallback')}
              </button>
            ) : null}
            <button className="primary" disabled={!canSave} onClick={() => void save()}>
              {saving ? t('Saving…') : t('Save fallbacks')}
            </button>
          </div>
          {own ? <ModelCatalogNote catalog={catalog} /> : null}
          {own && !list.every(isComplete) ? <p className="meta">{t('Pick a provider and model for every fallback to save.')}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </>
      )}
    </section>
  )
}
