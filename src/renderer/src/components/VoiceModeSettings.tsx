import { useEffect, useState } from 'react'
import { locale, t } from '@shared/i18n'
import { GatewayError, gateway } from '../gateway'
import {
  API_VOICES,
  LIMIT_CHOICES,
  PLAN_VOICES,
  STATUS_PATH,
  apiLimitMinutes,
  gptLiveVoice,
  limitTitle,
  setApiLimitMinutes,
  setGptLiveVoice,
  voiceName,
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
  const [voice, setVoice] = useState(() => gptLiveVoice(gptLiveBilling()))
  const [limit, setLimit] = useState(apiLimitMinutes)
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
    setVoice(gptLiveVoice(next))
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
          <p className="meta settings-caption">
            {billing === 'api'
              ? t(
                  "Bills your Hermes server's OpenAI API key per minute of call time, separately from any ChatGPT plan. The call screen shows which one a call is on."
                )
              : t('Bills the ChatGPT subscription your Hermes server is signed in to. A call never moves to the API key on its own.')}
          </p>
          <label className="voice-mode-pick">
            <span className="meta">{t('Voice')}</span>
            <select
              value={voice}
              onChange={e => {
                setVoice(e.target.value)
                setGptLiveVoice(billing, e.target.value)
              }}
            >
              <option value="">{t('Server default')}</option>
              {billing === 'api'
                ? API_VOICES.map(name => (
                    <option key={name} value={name}>
                      {voiceName(name)}
                    </option>
                  ))
                : PLAN_VOICES.map(v => (
                    <option key={v.name} value={v.name}>
                      {`${voiceName(v.name)} · ${v.style()}`}
                    </option>
                  ))}
              {voice && !(billing === 'api' ? API_VOICES.includes(voice) : PLAN_VOICES.some(v => v.name === voice)) ? (
                <option value={voice}>{voice}</option>
              ) : null}
            </select>
          </label>
          <p className="meta settings-caption">
            {billing === 'api'
              ? t(
                  "The voice GPT-Live speaks with on the API key. Server default uses voice.gpt_live.voice in the profile's config. Applies to the next conversation."
                )
              : t(
                  "The voice GPT-Live speaks with. Server default uses the voice set on your Hermes server (voice.gpt_live in the profile's config). The model is set there too. Applies to the next conversation."
                )}
          </p>
          {billing === 'api' ? (
            <>
              <label className="voice-mode-pick">
                <span className="meta">{t('Time limit per call')}</span>
                <select
                  value={limit}
                  onChange={e => {
                    setLimit(Number(e.target.value))
                    setApiLimitMinutes(Number(e.target.value))
                  }}
                >
                  {(LIMIT_CHOICES.includes(limit) ? LIMIT_CHOICES : [limit, ...LIMIT_CHOICES]).map(minutes => (
                    <option key={minutes} value={minutes}>
                      {limitTitle(minutes, locale())}
                    </option>
                  ))}
                </select>
              </label>
              <p className="meta settings-caption">{t('An API-key call says goodbye and ends when it reaches this limit.')}</p>
            </>
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
