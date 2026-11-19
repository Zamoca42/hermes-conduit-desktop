import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { updateConfig, withValue, type Http } from '../state/profileConfig'
import { withSpeechServer } from '../state/speechServer'
import { FRONT_MODEL_KEYS, localLiveAgent, localLivePersona, setLocalLiveAgent, setLocalLivePersona, type FrontModel } from '../state/localLive'

const http: Http = (method, path, body) => gateway.http(method, path, body)

/**
 * Settings > Voice > Local Live, "Your fast model": after the phone's Live > Local.
 * A quick model on the host answers first and sends real work to Hermes;
 * off, Hermes answers each turn. `front` is the host's status of it (null:
 * a plugin without agent mode); `onSaved` reads the status again.
 */
export function LocalLiveAgentSettings({
  profile,
  front,
  ownModel,
  onSaved
}: {
  profile?: string
  front: FrontModel | null
  /** The speech server's own model switch as the host has it; null hides it (an older plugin). */
  ownModel: boolean | null
  onSaved: () => void
}) {
  const [agent, setAgent] = useState(localLiveAgent)
  const [persona, setPersona] = useState(localLivePersona)
  const [url, setUrl] = useState(front?.baseUrl ?? '')
  const [model, setModel] = useState(front?.model ?? '')
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The own model switch as clicked, while its save is on the way. */
  const [ownDraft, setOwnDraft] = useState<boolean | null>(null)
  const [ownError, setOwnError] = useState<string | null>(null)

  useEffect(() => {
    setUrl(front?.baseUrl ?? '')
    setModel(front?.model ?? '')
  }, [front?.baseUrl, front?.model])

  const write = async (values: Record<string, string>) => {
    setSaving(true)
    setError(null)
    try {
      await updateConfig(http, profile ?? 'default', config => Object.entries(values).reduce((next, [k, v]) => withValue(next, k, v), config))
      setKey('')
      onSaved()
    } catch (e) {
      setError(
        t('Couldn’t save that change: {error}', {
          error: e instanceof Error ? e.message : String(e)
        })
      )
    } finally {
      setSaving(false)
    }
  }

  /** Saves by itself, like Hermes answers: true, or the setting removed, which is off. */
  const saveOwnModel = async (on: boolean) => {
    setOwnDraft(on)
    setOwnError(null)
    try {
      await updateConfig(http, profile ?? 'default', config => withSpeechServer(config, { ownModel: on }))
    } catch (e) {
      setOwnError(
        t('Couldn’t save that change: {error}', {
          error: e instanceof Error ? e.message : String(e)
        })
      )
    } finally {
      setOwnDraft(null)
      onSaved()
    }
  }

  const save = () => {
    const values: Record<string, string> = {}
    if (url.trim() !== (front?.baseUrl ?? '')) values[FRONT_MODEL_KEYS.baseUrl] = url.trim()
    if (model.trim() !== (front?.model ?? '')) values[FRONT_MODEL_KEYS.model] = model.trim()
    if (key.trim()) values[FRONT_MODEL_KEYS.apiKey] = key.trim()
    if (Object.keys(values).length) void write(values)
  }

  return (
    <div className="local-live-agent">
      <strong className="local-live-step">{t('3. Your fast model')}</strong>
      <label className="toggle">
        <input
          type="checkbox"
          checked={agent}
          onChange={e => {
            setAgent(e.target.checked)
            setLocalLiveAgent(e.target.checked)
          }}
        />
        {t('Your fast model answers first')}
      </label>
      <p className="meta settings-caption">
        {t("Your fast model answers right away and sends real work to Hermes as the chat's next message. Off, Hermes answers each turn itself.")}
      </p>
      {agent ? (
        <>
          {ownModel !== null ? (
            <>
              <label className="toggle">
                <input type="checkbox" checked={ownDraft ?? ownModel} disabled={ownDraft !== null} onChange={e => void saveOwnModel(e.target.checked)} />
                {t("The speech server's own model answers")}
              </label>
              <p className="meta settings-caption">
                {t(
                  "For a hosted realtime model, such as OpenAI Realtime or Qwen: it holds the call itself with Conduit's instructions and tools, and hands the work to Hermes as jobs. The call's instructions are sent to that server, with this profile's SOUL.md when the personality switch below is on. Classic voice and Apple Watch calls still get Hermes' replies, read aloud by it. Off, your fast model answers."
                )}
              </p>
              {ownError ? <p className="meta settings-caption voice-call-problem">{ownError}</p> : null}
            </>
          ) : null}
          {front ? (
            <>
              <p className="meta settings-caption">
                {t(
                  'Any OpenAI-compatible server works, on your network (llama.cpp, Ollama, vLLM, LM Studio) or a hosted one. A small, quick model is best: it only talks and hands the work to Hermes.'
                )}
              </p>
              <label className="local-live-field">
                <span className="meta">{t('Server address')}</span>
                <input value={url} placeholder="http://192.168.1.20:8080/v1" spellCheck={false} onChange={e => setUrl(e.target.value)} />
              </label>
              <label className="local-live-field">
                <span className="meta">{t('Model')}</span>
                <input value={model} placeholder="qwen3-4b-instruct" spellCheck={false} onChange={e => setModel(e.target.value)} />
              </label>
              <label className="local-live-field">
                <span className="meta">
                  {t('Key')} · {front.hasKey ? t('Set') : t('None')}
                </span>
                <input type="password" value={key} placeholder={t('Optional, for a hosted model')} onChange={e => setKey(e.target.value)} />
              </label>
              <div className="local-live-buttons">
                <button className="primary" disabled={saving} onClick={save}>
                  {t('Save')}
                </button>
                {front.hasKey ? (
                  <button className="secondary" disabled={saving} onClick={() => void write({ [FRONT_MODEL_KEYS.apiKey]: '' })}>
                    {t('Remove key')}
                  </button>
                ) : null}
              </div>
              {error ? <p className="meta settings-caption voice-call-problem">{error}</p> : null}
              <p className={`meta settings-caption${front.available ? '' : ' voice-call-problem'}`}>
                {front.available
                  ? t('Calls answer with {model} and hand the work to Hermes.', { model: front.model ?? '' })
                  : (front.reason ?? t('No fast model is set, so Hermes answers each turn itself, which is slower to start talking.'))}
              </p>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={persona}
                  onChange={e => {
                    setPersona(e.target.checked)
                    setLocalLivePersona(e.target.checked)
                  }}
                />
                {t('Use Hermes personality')}
              </label>
              <p className="meta settings-caption">
                {t(
                  "Your fast model talks with the personality in this profile's SOUL.md, without reading out actions or emoji. SOUL.md is sent to your fast model's server with the conversation, and a long one can slow a small model's first words. Applies to the next call."
                )}
              </p>
            </>
          ) : (
            <p className="meta settings-caption voice-call-problem">{t('Update the Conduit plugin on your Hermes host to use a fast model.')}</p>
          )}
        </>
      ) : null}
    </div>
  )
}
