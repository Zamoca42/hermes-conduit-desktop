import { useEffect, useState } from 'react'
import { language, t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  MINIMUM_PLUGIN,
  PAUSE_DELAYS,
  PREDICT_PATH,
  pauseDelay,
  pauseEnabled,
  setPauseDelay,
  setPauseEnabled,
  REPLY_COUNTS,
  predictModel,
  repliesEnabled,
  replyCount,
  setPredictModel,
  setRepliesEnabled,
  setReplyCount,
  type PredictModel
} from '../state/predictive'
import { predictionsServed } from '../state/usePredictions'

/** Settings > Chat > Predictive, after the phone's: suggested replies, kept on this computer and off by default. */
export function PredictiveSettings() {
  const [on, setOn] = useState(repliesEnabled)
  const [count, setCount] = useState(replyCount)
  const [model, setModel] = useState(predictModel)
  const [pause, setPause] = useState(pauseEnabled)
  const [delay, setDelay] = useState(pauseDelay)
  const [served, setServed] = useState<boolean | null>(null)
  const [host, setHost] = useState<{ fast: string | null; today: number } | null>(null)

  useEffect(() => {
    let live = true
    void predictionsServed().then(ok => {
      if (!live) return
      setServed(ok)
      if (!ok) return
      gateway
        .http('GET', PREDICT_PATH)
        .then(raw => {
          const r = (raw ?? {}) as { fast_model?: unknown; today?: unknown }
          if (live)
            setHost({
              fast: typeof r.fast_model === 'string' && r.fast_model.trim() ? r.fast_model.trim() : null,
              today: typeof r.today === 'number' ? r.today : 0
            })
        })
        .catch(() => undefined)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <section className="pset-section">
      <h2>{t('Predictive')}</h2>
      <p className="meta">{t('After a reply, the messages you’ll most likely send next, best first. Click one to send it; right-click to edit it first.')}</p>
      <p className="meta">
        {t(
          "Each guess is a short extra request to your agent's model, on a copy of the chat that can't use tools. Nothing is saved to the chat, and only this device sees the guesses."
        )}
      </p>
      {served === false ? <p className="meta">{t('Needs Conduit plugin {version} or later.', { version: MINIMUM_PLUGIN })}</p> : null}
      <div className="pset-row">
        <span>{t('Suggest replies')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={on}
            disabled={served === false}
            aria-label={t('Suggest replies')}
            onChange={e => {
              setOn(e.target.checked)
              setRepliesEnabled(e.target.checked)
            }}
          />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('How many')}</span>
        <select
          className="language-select"
          value={count}
          disabled={!on}
          aria-label={t('How many')}
          onChange={e => {
            const n = Number(e.target.value)
            setCount(n)
            setReplyCount(n)
          }}
        >
          {REPLY_COUNTS.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p className="meta">
        {t(
          "When you stop typing for a moment, words to finish your message and whole messages you might mean. Your unsent draft goes to your agent's model to make them."
        )}
      </p>
      <div className="pset-row">
        <span>{t('Suggest while I pause')}</span>
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={pause}
            disabled={served === false}
            aria-label={t('Suggest while I pause')}
            onChange={e => {
              setPause(e.target.checked)
              setPauseEnabled(e.target.checked)
            }}
          />
        </label>
      </div>
      <div className="pset-row">
        <span>{t('Pause before asking')}</span>
        <select
          className="language-select"
          value={delay}
          disabled={!pause}
          aria-label={t('Pause before asking')}
          onChange={e => {
            const n = Number(e.target.value)
            setDelay(n)
            setPauseDelay(n)
          }}
        >
          {PAUSE_DELAYS.map(n => (
            <option key={n} value={n}>
              {t('{number} s', { number: n.toLocaleString(language()) })}
            </option>
          ))}
        </select>
      </div>
      <div className="pset-row">
        <span>{t('Predictions use')}</span>
        <select
          className="language-select"
          value={model}
          disabled={!on && !pause}
          aria-label={t('Predictions use')}
          onChange={e => {
            const m = e.target.value as PredictModel
            setModel(m)
            setPredictModel(m)
          }}
        >
          <option value="fast">{t('Fast model')}</option>
          <option value="chat">{t('Same as chat')}</option>
        </select>
      </div>
      {host && model === 'fast' ? (
        <p className="meta">
          {host.fast ? t('Fast model on your host: {model}.', { model: host.fast }) : t("Your host has no fast model set, so the chat's own model answers.")}
        </p>
      ) : null}
      {host ? (
        <div className="pset-row">
          <span>{t('Predictions today')}</span>
          <span className="meta">{host.today}</span>
        </div>
      ) : null}
    </section>
  )
}
