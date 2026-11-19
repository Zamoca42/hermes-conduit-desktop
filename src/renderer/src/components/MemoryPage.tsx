import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { groupModels, reasoningTitle, REASONING_LEVELS } from '../state/models'
import {
  fieldValue,
  inTurn,
  memorySections,
  pluginChoices,
  pluginRouteBody,
  readConfig,
  schemaKeys,
  shownFields,
  updateConfig,
  valueAt,
  withChoices,
  withValue,
  type Http
} from '../state/profileConfig'
import { FieldRow } from './ConfigPage'
import { FallbackModels } from './FallbackModels'
import { Icon } from './icons'
import { ModelOptions } from './ModelOptions'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote } from './ModelCatalogNote'

const http: Http = (method, path, body) => gateway.http(method, path, body)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const withProfile = (path: string, profile: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

interface Props {
  bots: { name: string; title: string }[]
  profile: string
  onBack: () => void
}

/**
 * Settings > Memory & delegation, after the phone's: memory, context
 * compression and how delegate agents run (`delegation.*`), the delegate
 * model, and Pause delegation for the whole Hermes. A row saves as it
 * changes, in turn with every other config save.
 */
export function MemoryPage({ bots, profile: initialProfile, onBack }: Props) {
  const [profile, setProfile] = useState(initialProfile)
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [schema, setSchema] = useState<Set<string> | null>(null)
  const [choices, setChoices] = useState<Record<string, string[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    setError(null)
    try {
      const [read, keys, hub] = await Promise.all([
        readConfig(http, profile),
        gateway.http('GET', withProfile('/api/config/schema', profile)).then(schemaKeys, () => null),
        gateway.http('GET', withProfile('/api/dashboard/plugins/hub', profile)).then(pluginChoices, () => pluginChoices(null))
      ])
      if (generation.current !== mine) return
      setConfig(read)
      setSchema(keys)
      setChoices(hub)
    } catch (e) {
      if (generation.current === mine) setError(message(e))
    }
  }, [profile])

  useEffect(() => {
    setConfig(null)
    void load()
  }, [load])

  const save = async (key: string, values: Record<string, unknown>) => {
    setSaving(key)
    setSaveError(null)
    const mine = generation.current
    try {
      const route = pluginRouteBody(profile, key, values[key])
      if (route) {
        await inTurn(() => gateway.http('PUT', '/api/dashboard/plugin-providers', route))
        if (generation.current === mine) setConfig(current => (current ? withValue(current, key, values[key]) : current))
        return
      }
      const saved = await updateConfig(http, profile, current => Object.entries(values).reduce((next, [k, v]) => withValue(next, k, v), current))
      if (generation.current === mine) setConfig(saved)
    } catch (e) {
      setSaveError(t('Couldn’t save that change: {error}', { error: message(e) }))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Memory & delegation')}</h1>
        <span className="spacer" />
        {bots.length > 1 ? (
          <select className="language-select" value={profile} aria-label={t('Bot')} onChange={e => setProfile(e.target.value)}>
            {bots.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {saveError ? <p className="error-text">{saveError}</p> : null}
      {!config ? (
        error ? (
          <div className="pset-row">
            <span className="error-text">{t('Could not load profile settings: {error}', { error })}</span>
            <button className="secondary" onClick={() => void load()}>
              {t('Try Again')}
            </button>
          </div>
        ) : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : (
        <>
          {memorySections().map(section => {
            const fields = shownFields(section, schema)
            if (!fields.length) return null
            return (
              <section key={section.title} className="pset-section">
                <h2>{section.title}</h2>
                {fields.map(plain => {
                  const field = withChoices(plain, choices, String(fieldValue(config, plain)))
                  return (
                    <FieldRow
                      key={`${profile}:${field.key}`}
                      field={field}
                      value={fieldValue(config, field)}
                      busy={saving !== null}
                      onSave={v => void save(field.key, { [field.key]: v })}
                    />
                  )
                })}
              </section>
            )
          })}
          <DelegateModel profile={profile} config={config} busy={saving !== null} onSave={values => save('delegate-model', values)} />
          {!schema || schema.has('delegation.fallback_providers') ? <FallbackModels key={`delegate-fallbacks:${profile}`} profile={profile} delegate /> : null}
          <PauseDelegation />
        </>
      )}
    </div>
  )
}

/** `delegation.provider`, `.model` and `.reasoning_effort`: empty inherits the chat's. */
function DelegateModel({
  profile,
  config,
  busy,
  onSave
}: {
  profile: string
  config: Record<string, unknown>
  busy: boolean
  onSave: (values: Record<string, unknown>) => Promise<void>
}) {
  const savedProvider = String(valueAt(config, 'delegation.provider') ?? '')
  const savedModel = String(valueAt(config, 'delegation.model') ?? '')
  const savedReasoning = String(valueAt(config, 'delegation.reasoning_effort') ?? '')
  const [pick, setPick] = useState(savedModel ? `${savedProvider}\n${savedModel}` : '')
  const [reasoning, setReasoning] = useState(savedReasoning)
  const catalog = useModelCatalog(
    useMemo(() => (profile !== 'default' ? { explicit_only: true, profile } : { explicit_only: true }), [profile]),
    { quietReadAgain: true }
  )
  const providers = catalog.providers ?? []
  useEffect(() => {
    setPick(savedModel ? `${savedProvider}\n${savedModel}` : '')
    setReasoning(savedReasoning)
  }, [savedProvider, savedModel, savedReasoning])
  const groups = useMemo(() => groupModels(providers, ''), [providers])
  const listed = !pick || groups.some(group => group.models.some(model => `${group.slug}\n${model}` === pick))
  const changed = pick !== (savedModel ? `${savedProvider}\n${savedModel}` : '') || reasoning !== savedReasoning
  return (
    <section className="pset-section">
      <h2>{t('Delegate model')}</h2>
      <div className="pset-row">
        <span>{t('Model')}</span>
        <select
          className="language-select models-select"
          value={pick}
          disabled={busy || !catalog.answered}
          aria-label={t('Delegate model')}
          onChange={e => setPick(e.target.value)}
        >
          <option value="">{t('Inherit chat model')}</option>
          {!listed ? <option value={pick}>{pick.split('\n')[1]}</option> : null}
          <ModelOptions providers={providers} groups={groups} />
        </select>
      </div>
      <ModelCatalogNote catalog={catalog} />
      <div className="pset-row">
        <span>{t('Reasoning')}</span>
        <select className="language-select" value={reasoning} disabled={busy} aria-label={t('Reasoning')} onChange={e => setReasoning(e.target.value)}>
          <option value="">{t('Inherit chat reasoning')}</option>
          {REASONING_LEVELS.filter(level => level !== 'none').map(level => (
            <option key={level} value={level}>
              {reasoningTitle(level)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <button
          className="secondary"
          disabled={busy || !changed || !catalog.answered}
          onClick={() => {
            const [provider = '', model = ''] = pick.split('\n')
            void onSave({ 'delegation.provider': pick ? provider : '', 'delegation.model': pick ? model : '', 'delegation.reasoning_effort': reasoning })
          }}
        >
          {busy ? t('Saving…') : t('Save delegate defaults')}
        </button>
      </div>
    </section>
  )
}

/** Holds new delegate agents on the whole Hermes (`delegation.pause`); agents already working carry on. */
function PauseDelegation() {
  const [paused, setPaused] = useState<boolean | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const read = useCallback(async () => {
    setFailed(false)
    try {
      const answer = await gateway.rpc<{ paused?: unknown }>('delegation.status')
      if (typeof answer?.paused === 'boolean') setPaused(answer.paused)
      else setFailed(true)
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => {
    void read()
  }, [read])

  return (
    <section className="pset-section">
      <h2>{t('Pause delegation')}</h2>
      {paused !== null ? (
        <div className="mem-row">
          <div className="mem-text">
            <span>{t('Pause new delegate agents')}</span>
            <span className="meta">
              {t('Hermes starts no new delegate agents while this is on. Agents already working carry on. This applies to every profile on this Hermes.')}
            </span>
          </div>
          <label className="switch-inline">
            <input
              type="checkbox"
              checked={paused}
              disabled={saving}
              aria-label={t('Pause new delegate agents')}
              onChange={e => {
                const want = e.target.checked
                setSaving(true)
                setError(null)
                gateway
                  .rpc<{ paused?: unknown }>('delegation.pause', { paused: want })
                  .then(answer => setPaused(typeof answer?.paused === 'boolean' ? answer.paused : want))
                  .catch(() => setError(t('Could not change the delegation pause.')))
                  .finally(() => setSaving(false))
              }}
            />
          </label>
        </div>
      ) : failed ? (
        <div className="pset-row">
          <span className="meta">{t("This Hermes can't pause delegation, or Conduit isn't connected.")}</span>
          <button className="secondary" onClick={() => void read()}>
            {t('Try Again')}
          </button>
        </div>
      ) : (
        <p className="meta">{t('Loading…')}</p>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  )
}
