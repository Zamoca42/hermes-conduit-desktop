import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { hasOwnModel, helperSummary, helperSwitch, parseModelSettings, switchValue, type HelperSwitch, type ModelSettings } from '../state/helperModels'
import { readConfig, updateConfig, withValue, type Http } from '../state/profileConfig'
import { type ModelProviderRow } from '../state/models'
import { Icon } from './icons'
import { FallbackModels } from './FallbackModels'
import { ProvidersSection } from './ProvidersSection'
import { ModelChooser } from './ModelChooser'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelCatalogNote, RefreshModelsButton } from './ModelCatalogNote'

interface Props {
  bots: { name: string; title: string }[]
  profile: string
  onBack: () => void
}

const withProfile = (path: string, profile: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

/**
 * Settings > Models, after the phone's Models & providers: the model new
 * chats start on and each helper model. A pick saves at once (a guarded
 * model asks first), for new chats; a running chat keeps its own.
 */
export function ModelsPage({ bots, profile: initialProfile, onBack }: Props) {
  const [profile, setProfile] = useState(initialProfile)
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const modelCatalog = useModelCatalog(
    useMemo(() => (profile !== 'default' ? { explicit_only: true, profile } : { explicit_only: true }), [profile]),
    { quietReadAgain: true }
  )
  const providers = modelCatalog.providers ?? []
  const [catalog, setCatalog] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    setError(null)
    try {
      const path = withProfile('/api/model/auxiliary', profile)
      const keep = answerKeeper(path)
      const raw = await gateway.http('GET', path)
      const answer = parseModelSettings(raw)
      if (generation.current === mine) {
        setSettings(answer)
        keep(raw)
      }
    } catch (e) {
      if (generation.current === mine) setError(e instanceof Error ? e.message : String(e))
    }
    // Every provider Hermes knows, connected or not: a new endpoint's name stays clear of them.
    const all = await gateway.rpc<{ providers?: ModelProviderRow[] }>('model.options', profile !== 'default' ? { profile } : {}).catch(() => null)
    if (generation.current === mine) setCatalog(all?.providers ? all.providers.flatMap(p => [p.slug, p.name]) : null)
  }, [profile])

  useEffect(() => {
    // The profile's settings as Hermes last gave them, until it answers again.
    const kept = keptAnswer(withProfile('/api/model/auxiliary', profile))
    setSettings(kept ? parseModelSettings(kept) : null)
    void load()
  }, [load])

  // The bot list is a new array on every render above: the profiles stay the same one while their names do.
  const profileKey = bots.map(bot => bot.name).join('\n')
  const profiles = useMemo(() => (profileKey ? profileKey.split('\n') : []), [profileKey])

  const assign = async (key: string, body: Record<string, unknown>) => {
    setSaving(key)
    setSaveError(null)
    try {
      const path = withProfile('/api/model/set', profile)
      let answer = (await gateway.http('POST', path, body)) as { confirm_required?: unknown; confirm_message?: unknown } | null
      if (answer?.confirm_required === true) {
        const note = typeof answer.confirm_message === 'string' && answer.confirm_message ? answer.confirm_message : t('Use This Model?')
        if (!window.confirm(note)) return
        answer = (await gateway.http('POST', path, { ...body, confirm_expensive_model: true })) as typeof answer
      }
      await load()
    } catch (e) {
      setSaveError(t('Couldn’t save that change: {error}', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setSaving(null)
    }
  }

  const picker = (key: string, value: { provider: string; model: string }, sameAsChats: boolean, onPick: (provider: string, model: string) => void) => {
    const current = value.model && value.provider !== 'auto' ? `${value.provider}\n${value.model}` : ''
    return (
      <ModelChooser
        value={current}
        providers={providers}
        defaultLabel={sameAsChats ? t('Same as chats') : null}
        emptyLabel={t('Default')}
        label={key}
        disabled={saving !== null || !modelCatalog.answered}
        onChange={next => {
          const [provider = '', model = ''] = next.split('\n')
          onPick(provider, model)
        }}
      />
    )
  }

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Models')}</h1>
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
      {!settings ? (
        error ? (
          <div className="pset-row">
            <span className="error-text">{error}</span>
            <button className="secondary" onClick={() => void load()}>
              {t('Try Again')}
            </button>
          </div>
        ) : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : (
        <>
          <section className="pset-section">
            <h2 className="model-section-title">
              {t('Chat model')}
              <RefreshModelsButton catalog={modelCatalog} />
            </h2>
            <div className="pset-row">
              <span>{t('New chats')}</span>
              {picker(t('Chat model'), settings.main, false, (provider, model) => {
                if (model) void assign('main', { scope: 'main', provider, model })
              })}
            </div>
            <ModelCatalogNote catalog={modelCatalog} />
            <p className="meta">{t('New chats start on this model. A chat that’s already open keeps its own until you change it there.')}</p>
          </section>
          <section className="pset-section">
            <h2>{t('Helper models')}</h2>
            <p className="meta">
              {settings.slots.length
                ? `${t('Hermes runs these jobs on the chat model unless you pick one. A small, fast model saves time and money on most of them.')} ${helperSummary(settings.slots)}.`
                : t('This Hermes has no helper models to set.')}
            </p>
            {settings.slots.map(slot => (
              <div key={slot.task} className={`models-slot${hasOwnModel(slot) ? ' own' : ''}`}>
                <div className="pset-row">
                  <strong>{slot.title}</strong>
                  {picker(
                    slot.title,
                    slot,
                    true,
                    (provider, model) =>
                      void assign(
                        slot.task,
                        model ? { scope: 'auxiliary', task: slot.task, provider, model } : { scope: 'auxiliary', task: slot.task, provider: 'auto', model: '' }
                      )
                  )}
                </div>
                {slot.caption ? <p className="meta">{slot.caption}</p> : null}
                {slot.follows && !hasOwnModel(slot) ? (
                  <p className="meta">{t('Follows {slot} while it has no model of its own.', { slot: slot.follows })}</p>
                ) : null}
                {helperSwitch(slot.task) ? <HelperSwitchRow key={`${profile}:${slot.task}`} profile={profile} words={helperSwitch(slot.task)!} /> : null}
              </div>
            ))}
          </section>
          <FallbackModels key={`fallbacks:${profile}`} profile={profile} />
          <ProvidersSection
            profile={profile}
            profileName={bots.find(bot => bot.name === profile)?.title ?? profile}
            profiles={profiles}
            defaultProvider={settings.main.provider}
            catalog={catalog}
            onChanged={() => void load()}
          />
        </>
      )}
    </div>
  )
}

const configHttp: Http = (method, path, body) => gateway.http(method, path, body)

/** A helper's on/off switch (Background review's), read from and saved in the profile's config, in turn with every config save. */
function HelperSwitchRow({ profile, words }: { profile: string; words: HelperSwitch }) {
  const [on, setOn] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    readConfig(configHttp, profile).then(
      config => current && setOn(switchValue(config, words)),
      e => current && setError(t('Could not load profile settings: {error}', { error: e instanceof Error ? e.message : String(e) }))
    )
    return () => {
      current = false
    }
    // The words are made anew on each render; the key names the setting.
  }, [profile, words.key])

  const save = async (next: boolean) => {
    const before = on
    setOn(next)
    setSaving(true)
    setError(null)
    try {
      await updateConfig(configHttp, profile, config => withValue(config, words.key, next))
    } catch (e) {
      setOn(before)
      setError(t('Couldn’t save that change: {error}', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="pset-row">
        <span>
          {words.title}: {words.label}
        </span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={on ?? words.defaultValue}
            disabled={on === null || saving}
            aria-label={words.label}
            onChange={e => void save(e.target.checked)}
          />
        </label>
      </div>
      <p className="meta">{words.caption}</p>
      {error ? <p className="error-text">{error}</p> : null}
    </>
  )
}
