import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { GatewayError, gateway } from '../gateway'
import {
  STATUS_PATH,
  availability,
  gptLiveBilling,
  setGptLiveBilling,
  setSendsMemory,
  setSendsPersona,
  setVoiceMode,
  sendsMemory,
  sendsPersona,
  voiceMode,
  withProfile,
  type Availability,
  type Billing,
  type VoiceMode
} from '../state/gptLive'

/** Settings > Voice's mode, after the phone's Voice mode: Classic, or GPT-Live with how it's paid for. */
export function VoiceModeSettings({ profile }: { profile?: string }) {
  const [mode, setMode] = useState<VoiceMode>(voiceMode)
  const [billing, setBilling] = useState<Billing>(gptLiveBilling)
  const [memory, setMemory] = useState(sendsMemory)
  const [persona, setPersona] = useState(sendsPersona)
  const [status, setStatus] = useState<Availability | 'checking' | 'missing' | null>(null)

  useEffect(() => {
    if (mode !== 'gpt') return setStatus(null)
    let live = true
    setStatus('checking')
    gateway
      .http('GET', withProfile(STATUS_PATH, profile), undefined, 12_000)
      .then(body => live && setStatus(availability(body, billing)))
      .catch((e: unknown) => {
        if (!live) return
        setStatus(e instanceof GatewayError && e.code === 404 ? 'missing' : { ok: false, reason: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      live = false
    }
  }, [mode, billing, profile])

  const choose = (next: VoiceMode) => {
    setMode(next)
    setVoiceMode(next)
  }
  const pay = (next: Billing) => {
    // As on the phone: the API key is billed per minute, so it's asked first.
    if (
      next === 'api' &&
      !window.confirm(
        `${t('Bill GPT-Live to the API key?')}\n\n${t("GPT-Live calls will use your Hermes server's OpenAI API key, which OpenAI bills per minute of call time, separately from any ChatGPT plan. Your Hermes server has to allow it too (voice.gpt_live.conduit_api_billing in the profile's config).")}`
      )
    )
      return
    setBilling(next)
    setGptLiveBilling(next)
  }

  return (
    <div className="voice-mode-settings">
      <span className="meta">{t('Voice mode')}</span>
      <div className="segmented" role="group" aria-label={t('Voice mode')}>
        <button aria-pressed={mode === 'classic'} onClick={() => choose('classic')}>
          {t('Classic')}
        </button>
        <button aria-pressed={mode === 'gpt'} onClick={() => choose('gpt')}>
          {t('GPT-Live')}
        </button>
      </div>
      {mode === 'gpt' ? (
        <>
          <span className="meta">{t('Billing')}</span>
          <div className="segmented" role="group" aria-label={t('Billing')}>
            <button aria-pressed={billing === 'subscription'} onClick={() => pay('subscription')}>
              {t('ChatGPT plan')}
            </button>
            <button aria-pressed={billing === 'api'} onClick={() => pay('api')}>
              {t('API key · billed per minute')}
            </button>
          </div>
          {billing === 'api' ? (
            <p className="meta settings-caption">
              {t(
                "Bills your Hermes server's OpenAI API key per minute of call time, separately from any ChatGPT plan. The call screen shows which one a call is on."
              )}
            </p>
          ) : null}
          <p className={`meta settings-caption${status && status !== 'checking' && (status === 'missing' || !status.ok) ? ' voice-call-problem' : ''}`}>
            {status === 'checking'
              ? t('Checking…')
              : status === 'missing'
                ? t('Install or update the Hermes notifier plugin on your Hermes server.')
                : status?.ok
                  ? `${t('Ready')} · ${status.model}`
                  : status
                    ? status.reason
                      ? t('GPT-Live is not available on this Hermes server: {reason}', { reason: status.reason })
                      : t('GPT-Live is not available on this Hermes server.')
                    : null}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={memory}
              onChange={e => {
                setMemory(e.target.checked)
                setSendsMemory(e.target.checked)
              }}
            />
            {t('Use Hermes memory')}
          </label>
          <p className="meta settings-caption">
            {t(
              'GPT-Live gets what your Hermes agent remembers about you. That memory is sent to OpenAI with the conversation. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={persona}
              onChange={e => {
                setPersona(e.target.checked)
                setSendsPersona(e.target.checked)
              }}
            />
            {t('Use Hermes personality')}
          </label>
          <p className="meta settings-caption">
            {t(
              "GPT-Live talks with the personality in this profile's SOUL.md. SOUL.md is sent to OpenAI with the conversation. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
    </div>
  )
}
