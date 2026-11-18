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
import {
  STATUS_PATH as GROK_STATUS_PATH,
  availability as grokAvailability,
  grokSendsMemory,
  grokSendsPersona,
  setGrokSendsMemory,
  setGrokSendsPersona,
  via,
  type Availability as GrokAvailability
} from '../state/grokLive'
import { savesCalls, setSavesCalls } from '../state/voiceSave'

/** Settings > Voice's mode, after the phone's Voice mode: Classic, or GPT-Live with how it's paid for. */
export function VoiceModeSettings({ profile }: { profile?: string }) {
  const [mode, setMode] = useState<VoiceMode>(voiceMode)
  const [billing, setBilling] = useState<Billing>(gptLiveBilling)
  const [voice, setVoice] = useState(() => gptLiveVoice(gptLiveBilling()))
  const [limit, setLimit] = useState(apiLimitMinutes)
  const [memory, setMemory] = useState(sendsMemory)
  const [persona, setPersona] = useState(sendsPersona)
  const [status, setStatus] = useState<Availability | 'checking' | 'missing' | null>(null)
  const [saveCalls, setSaveCalls] = useState(savesCalls)
  const [grokMemory, setGrokMemory] = useState(grokSendsMemory)
  const [grokPersona, setGrokPersona] = useState(grokSendsPersona)
  const [grokStatus, setGrokStatus] = useState<GrokAvailability | 'checking' | 'missing' | null>(null)

  useEffect(() => {
    if (mode !== 'grok') return setGrokStatus(null)
    let live = true
    setGrokStatus('checking')
    gateway
      .http('GET', withProfile(GROK_STATUS_PATH, profile), undefined, 30_000)
      .then(body => live && setGrokStatus(grokAvailability(body)))
      .catch((e: unknown) => {
        if (!live) return
        setGrokStatus(e instanceof GatewayError && e.code === 404 ? 'missing' : { ok: false, reason: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      live = false
    }
  }, [mode, profile])

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
        <button aria-pressed={mode === 'grok'} onClick={() => choose('grok')}>
          {t('Grok Live')}
        </button>
      </div>
      {mode === 'grok' ? (
        <>
          <p
            className={`meta settings-caption${grokStatus && grokStatus !== 'checking' && (grokStatus === 'missing' || !grokStatus.ok) ? ' voice-call-problem' : ''}`}
          >
            {grokStatus === 'checking'
              ? t('Checking…')
              : grokStatus === 'missing'
                ? t('Install or update the Hermes notifier plugin on your Hermes server.')
                : grokStatus?.ok
                  ? grokStatus.voice
                    ? t('Available ({model}, voice {voice}, via {via})', { model: grokStatus.model, voice: grokStatus.voice, via: via(grokStatus.auth) })
                    : t('Available ({model}, via {via})', { model: grokStatus.model, via: via(grokStatus.auth) })
                  : grokStatus
                    ? grokStatus.reason
                      ? t('Grok Live is not available on this Hermes server: {reason}', { reason: grokStatus.reason })
                      : t('Grok Live is not available on this Hermes server.')
                    : null}
          </p>
          <p className="meta settings-caption">{t("The voice and model are set on your Hermes server (voice.grok_live in the profile's config).")}</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={grokMemory}
              onChange={e => {
                setGrokMemory(e.target.checked)
                setGrokSendsMemory(e.target.checked)
              }}
            />
            {t('Use Hermes memory')}
          </label>
          <p className="meta settings-caption">
            {t(
              'Grok Live gets what your Hermes agent remembers about you. That memory is sent to xAI with the conversation. Applies to the next conversation.'
            )}
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={grokPersona}
              onChange={e => {
                setGrokPersona(e.target.checked)
                setGrokSendsPersona(e.target.checked)
              }}
            />
            {t('Use Hermes personality')}
          </label>
          <p className="meta settings-caption">
            {t(
              "Grok Live talks with the personality in this profile's SOUL.md. SOUL.md is sent to xAI with the conversation. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
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
      {mode !== 'classic' ? (
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={saveCalls}
              onChange={e => {
                setSaveCalls(e.target.checked)
                setSavesCalls(e.target.checked)
              }}
            />
            {t('Save calls to Sessions')}
          </label>
          <p className="meta settings-caption">
            {t(
              "Each call's transcript is saved to your Hermes server's history and shows under Voice in Sessions, where you can read it or resume the call. Needs an up-to-date Hermes notifier plugin. Shared by every live voice mode. Applies to the next conversation."
            )}
          </p>
        </>
      ) : null}
    </div>
  )
}
