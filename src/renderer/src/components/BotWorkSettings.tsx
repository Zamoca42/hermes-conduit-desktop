import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import type { ModelProviderRow } from '../state/models'
import { ModelChooser } from './ModelChooser'
import { WORK, workPath } from '../state/work'
import {
  approvalsCaption,
  coordinationCaption,
  modelBody,
  parseWorkSettings,
  policyCaption,
  policyChoices,
  quickStepsChoices,
  type Policy,
  type WorkSettings
} from '../state/workSettings'
import { Select } from './Select'

interface Props {
  bot: string
  botName: string
  /** The models to pick from, as the Model panel lists them. */
  providers: ModelProviderRow[] | null
}

/**
 * Edit Bot > Work, after the phone's: each change saves at once, shows
 * what Hermes kept, and says so when it didn't save.
 */
export function BotWorkSettings({ bot, botName, providers }: Props) {
  const [settings, setSettings] = useState<WorkSettings | null>(null)
  const [missing, setMissing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const path = workPath(`${WORK}/settings`, bot)

  const load = async () => {
    setLoadError(false)
    try {
      setSettings(parseWorkSettings(await gateway.http('GET', path)))
    } catch (e) {
      // An older plugin, or none: no Work section.
      if ((e as { code?: unknown }).code === 404) setMissing(true)
      else setLoadError(true)
    }
  }

  useEffect(() => {
    void load()
  }, [bot])

  const save = async (change: Record<string, unknown>, shown: Partial<WorkSettings>) => {
    if (!settings) return
    const before = settings
    setSettings({ ...settings, ...shown })
    setSaving(true)
    setSaveError(false)
    try {
      setSettings(parseWorkSettings(await gateway.http('POST', path, change)))
    } catch {
      setSettings(before)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  if (missing) return null
  if (!settings)
    return (
      <section className="pset-section">
        <h2>{t('Work')}</h2>
        {loadError ? (
          <div className="pset-row">
            <span className="meta">{t('Couldn’t load the work settings.')}</span>
            <button className="secondary" onClick={() => void load()}>
              {t('Try Again')}
            </button>
          </div>
        ) : (
          <p className="meta">{t('Loading…')}</p>
        )}
      </section>
    )

  const on = settings.policy !== 'off'
  const steps = quickStepsChoices(settings)
  const modelValue = settings.model ? `${settings.model.provider ?? ''}\n${settings.model.model}` : ''

  return (
    <>
      <section className="pset-section">
        <h2>{t('Work')}</h2>
        {saveError ? <p className="error-text">{t('Couldn’t save that change. Try again.')}</p> : null}
        {settings.unavailable ? (
          <>
            <p className="pset-warn">{t('Workstreams can’t run on this Hermes.')}</p>
            <p className="meta">{settings.unavailable}</p>
          </>
        ) : null}
        <label className="toggle">
          <input
            type="checkbox"
            checked={on}
            disabled={saving}
            onChange={e => void save({ policy: e.target.checked ? 'lookups' : 'off' }, { policy: e.target.checked ? 'lookups' : 'off' })}
          />
          {t('Coordinate Work')}
        </label>
        <p className="meta">
          {on
            ? t('{bot} starts a chat of its own for longer tasks, works on them in the background, and tells you in its Bot Chat when they’re done.', {
                bot: botName
              })
            : t('{bot} does everything in its Bot Chat itself. Work that’s already running carries on.', { bot: botName })}
        </p>
        {on ? (
          <>
            <div className="pset-row">
              <span>{t('What It Does Itself')}</span>
              <Select
                className="language-select"
                value={settings.policy}
                disabled={saving}
                onChange={picked => void save({ policy: picked }, { policy: picked as Policy })}
              >
                {policyChoices(settings).map(choice => (
                  <option key={choice.id} value={choice.id}>
                    {choice.title}
                  </option>
                ))}
              </Select>
            </div>
            <p className="meta">{policyCaption(settings.policy, botName)}</p>
            {settings.policy === 'lookups' && settings.quickSteps !== undefined && steps.length > 1 ? (
              <>
                <div className="pset-row">
                  <span>{t('Steps in One Turn')}</span>
                  <Select
                    className="language-select"
                    value={settings.quickSteps}
                    disabled={saving}
                    onChange={picked => void save({ quick_steps: Number(picked) }, { quickSteps: Number(picked) })}
                  >
                    {steps.map(n => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <p className="meta">
                  {t('{bot} does up to {steps} steps of a task in its Bot Chat. A task that needs more carries on in the background.', {
                    bot: botName,
                    steps: String(settings.quickSteps)
                  })}
                </p>
              </>
            ) : null}
            <div className="pset-row">
              <span>{t('Running at Once')}</span>
              <Select
                className="language-select"
                value={settings.maxRunning}
                disabled={saving}
                onChange={picked => void save({ max_running: Number(picked) }, { maxRunning: Number(picked) })}
              >
                {Array.from({ length: Math.max(settings.maxRunningLimit, settings.maxRunning) }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
            <p className="meta">
              {t('When this many are running, {bot} waits for one to finish or sends new work to one that’s already on it.', { bot: botName })}
            </p>
          </>
        ) : null}
      </section>

      {on && settings.coordination ? (
        <section className="pset-section">
          <h2>{t('Coordination')}</h2>
          <div className="pset-row">
            <span>{t('Between Workstreams')}</span>
            <Select segments
              className="language-select"
              value={settings.coordination}
              disabled={saving}
              onChange={picked => void save({ coordination: picked }, { coordination: picked as WorkSettings['coordination'] })}
            >
              <option value="ask">{t('Ask Me First')}</option>
              <option value="auto">{t('Automatic')}</option>
              <option value="off">{t('Off')}</option>
            </Select>
          </div>
          <p className="meta">{coordinationCaption(settings.coordination, botName)}</p>
          <p className="meta">{t('This doesn’t change what workstreams may do: their approvals stay as set under Safety.')}</p>
        </section>
      ) : null}

      {on ? (
        <section className="pset-section">
          <h2>{t('Workstream Model')}</h2>
          <div className="pset-row">
            <span>{t('Model')}</span>
            <ModelChooser
              value={modelValue}
              providers={providers}
              defaultLabel={t('Same as Bot Chat')}
              label={t('Workstream Model')}
              disabled={saving}
              onChange={next => {
                const [provider = '', model = ''] = next.split('\n')
                const pick = model ? { model, provider: provider || undefined } : null
                void save({ workstream_model: modelBody(pick) }, { model: pick })
              }}
            />
          </div>
          <p className="meta">{t('New workstreams start on this model. Work that’s already running keeps its own.')}</p>
        </section>
      ) : null}

      {on ? (
        <section className="pset-section">
          <h2>{t('Safety')}</h2>
          <div className="pset-row">
            <span>{t('After a Restart')}</span>
            <Select segments
              className="language-select"
              value={settings.afterRestart}
              disabled={saving}
              onChange={picked => void save({ after_restart: picked }, { afterRestart: picked as WorkSettings['afterRestart'] })}
            >
              <option value="continue">{t('Continue Safe Work')}</option>
              <option value="ask">{t('Ask Me First')}</option>
            </Select>
          </div>
          <p className="meta">{t('Work cut off during a step that can change things always waits for you. This is for the rest.')}</p>
          <div className="pset-row">
            <span>{t('Approvals in Workstreams')}</span>
            <Select segments
              className="language-select"
              value={settings.approvals}
              disabled={saving}
              onChange={picked => void save({ workstream_approvals: picked }, { approvals: picked as WorkSettings['approvals'] })}
            >
              <option value="chats">{t('Same as Chats')}</option>
              <option value="ask">{t('Ask Me First')}</option>
              <option value="off">{t('Don’t Ask')}</option>
            </Select>
          </div>
          <p className="meta">{approvalsCaption(settings, botName)}</p>
        </section>
      ) : null}
    </>
  )
}
