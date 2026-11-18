import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { hasOwnModel, helperSummary, parseModelSettings, type ModelSettings } from '../state/helperModels'
import { groupModels, type ModelProviderRow } from '../state/models'
import { Icon } from './icons'
import { FallbackModels } from './FallbackModels'
import { ProvidersSection } from './ProvidersSection'

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
  const [providers, setProviders] = useState<ModelProviderRow[]>([])
  const [catalog, setCatalog] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    setError(null)
    try {
      const answer = parseModelSettings(await gateway.http('GET', withProfile('/api/model/auxiliary', profile)))
      if (generation.current === mine) setSettings(answer)
    } catch (e) {
      if (generation.current === mine) setError(e instanceof Error ? e.message : String(e))
    }
    const params: Record<string, unknown> = { explicit_only: true }
    if (profile !== 'default') params.profile = profile
    const options = await gateway.rpc<{ providers?: ModelProviderRow[] }>('model.options', params).catch(() => null)
    if (generation.current === mine) setProviders(options?.providers ?? [])
    // Every provider Hermes knows, connected or not: a new endpoint's name stays clear of them.
    const all = await gateway.rpc<{ providers?: ModelProviderRow[] }>('model.options', profile !== 'default' ? { profile } : {}).catch(() => null)
    if (generation.current === mine) setCatalog(all?.providers ? all.providers.flatMap(p => [p.slug, p.name]) : null)
  }, [profile])

  useEffect(() => {
    setSettings(null)
    void load()
  }, [load])

  const groups = useMemo(() => groupModels(providers, ''), [providers])
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
    const listed = groups.some(group => group.slug === value.provider && group.models.includes(value.model))
    return (
      <select
        className="language-select models-select"
        value={current}
        disabled={saving !== null}
        aria-label={key}
        onChange={e => {
          const [provider = '', model = ''] = e.target.value.split('\n')
          onPick(provider, model)
        }}
      >
        {sameAsChats ? <option value="">{t('Same as chats')}</option> : !current ? <option value="">{t('Default')}</option> : null}
        {current && !listed ? <option value={current}>{value.model}</option> : null}
        {groups.map(group => (
          <optgroup key={group.slug} label={group.name}>
            {group.models.map(model => (
              <option key={model} value={`${group.slug}\n${model}`}>
                {model}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
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
            <h2>{t('Chat model')}</h2>
            <div className="pset-row">
              <span>{t('New chats')}</span>
              {picker(t('Chat model'), settings.main, false, (provider, model) => {
                if (model) void assign('main', { scope: 'main', provider, model })
              })}
            </div>
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
