import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { GatewayError, gateway } from '../gateway'
import { withProfile } from '../state/callSettings'
import { updateConfig, type Http } from '../state/profileConfig'
import {
  SPEECH_SERVER_MISSING,
  SPEECH_SERVER_PRESETS_PATH,
  SPEECH_SERVER_STATUS_PATH,
  SPEECH_SERVER_TEST_PATH,
  changedNames,
  followed,
  savedNames,
  speechServerPresets,
  speechServerStatus,
  speechServerTest,
  testMessage,
  withSpeechServer,
  type Names,
  type SpeechServerChange,
  type SpeechServerPreset,
  type SpeechServerStatus,
  type SpeechServerTest
} from '../state/speechServer'

const http: Http = (method, path, body) => gateway.http(method, path, body)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Settings > Voice > Local Live, "1. Your speech server": after the phone's
 * SpeechServerSettingsView. Mounted per profile (keyed by it), so a switch
 * starts from that profile's saved values. `onChanged` tells the steps
 * below to read their status again.
 */
export function SpeechServerSettings({ profile, onChanged }: { profile?: string; onChanged: () => void }) {
  const [status, setStatus] = useState<SpeechServerStatus | null>(null)
  const statusRef = useRef<SpeechServerStatus | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [names, setNames] = useState<Names>(savedNames(null))
  const [presets, setPresets] = useState<SpeechServerPreset[]>([])
  const [picked, setPicked] = useState<SpeechServerPreset | null>(null)
  /** The address the last pick filled in, so another pick replaces it and never an address typed. */
  const pickedUrl = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<SpeechServerTest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    []
  )

  /** Reads what the host has; a read that fails keeps what's shown and says why. */
  const read = useCallback(
    async (sent: { url?: string; names?: Partial<Names> } = {}): Promise<SpeechServerStatus | null> => {
      try {
        const loaded = speechServerStatus(await gateway.http('GET', withProfile(SPEECH_SERVER_STATUS_PATH, profile), undefined, 30_000))
        if (!live.current) return null
        const before = statusRef.current
        statusRef.current = loaded
        // A field nobody touched since takes the host's value; one typed meanwhile stays.
        setUrl(draft => {
          if (!before) return loaded.url ?? ''
          if (sent.url !== undefined && draft.trim() === sent.url) return loaded.url ?? ''
          return followed(draft, before.url, loaded.url)
        })
        setNames(drafts => {
          if (!before) return savedNames(loaded)
          const was = savedNames(before)
          const now = savedNames(loaded)
          return {
            model: followed(drafts.model, was.model, now.model, sent.names?.model),
            voice: followed(drafts.voice, was.voice, now.voice, sent.names?.voice),
            transcription_model: followed(drafts.transcription_model, was.transcription_model, now.transcription_model, sent.names?.transcription_model)
          }
        })
        setStatus(loaded)
        if (loaded.namesItsModel) {
          gateway
            .http('GET', SPEECH_SERVER_PRESETS_PATH)
            .then(raw => live.current && setPresets(list => (list.length ? list : speechServerPresets(raw))))
            .catch(() => undefined)
        }
        return loaded
      } catch (e) {
        if (!live.current) return null
        if (e instanceof GatewayError && e.code === 404) setMissing(SPEECH_SERVER_MISSING())
        else setError(message(e))
        return null
      }
    },
    [profile]
  )

  useEffect(() => {
    void read()
  }, [read])

  const runTest = async () => {
    setTesting(true)
    try {
      const result = speechServerTest(await gateway.http('POST', withProfile(SPEECH_SERVER_TEST_PATH, profile), {}, 30_000))
      if (live.current) setTest(result)
    } catch (e) {
      if (live.current)
        setTest({
          connected: false,
          latencyMs: null,
          reason: message(e),
          answersAlone: null
        })
    } finally {
      if (live.current) setTesting(false)
    }
  }

  /** One save of the change, then a read of what the host has now. */
  const write = async (change: SpeechServerChange): Promise<SpeechServerStatus | null> => {
    setSaving(true)
    setError(null)
    setTest(null)
    let saved = false
    try {
      await updateConfig(http, profile ?? 'default', config => withSpeechServer(config, change))
      saved = true
    } catch (e) {
      if (live.current) setError(t('Couldn’t save that change: {error}', { error: message(e) }))
    }
    const loaded = await read({ url: change.url, names: change.names })
    if (live.current) setSaving(false)
    if (saved) onChanged()
    return saved ? loaded : null
  }

  const pickedDrivesTurns = picked && status?.driveTurns !== null && status?.driveTurns !== picked.drivesTurns ? picked.drivesTurns : undefined
  const changes: SpeechServerChange = {}
  if (status && url.trim() !== (status.url ?? '')) changes.url = url.trim()
  if (key.trim()) changes.apiKey = key.trim()
  const named = changedNames(names, status)
  if (Object.keys(named).length) changes.names = named
  if (pickedDrivesTurns !== undefined) changes.driveTurns = pickedDrivesTurns
  const hasChanges = Object.keys(changes).length > 0

  const saveAll = async () => {
    const typedKey = key.trim()
    const loaded = await write(changes)
    if (!loaded || !live.current) return
    if (typedKey && key.trim() === typedKey) setKey('')
    setPicked(null)
    pickedUrl.current = null
    if (loaded.available) await runTest()
  }

  const pick = (preset: SpeechServerPreset) => {
    setPicked(preset)
    if (preset.url) setUrl(preset.url)
    else if (pickedUrl.current !== null && url === pickedUrl.current) setUrl('')
    pickedUrl.current = preset.url
    setNames({
      model: preset.model ?? '',
      voice: preset.voice ?? '',
      transcription_model: preset.transcriptionModel ?? ''
    })
    setTest(null)
  }

  if (missing) return <p className="meta settings-caption voice-call-problem">{missing}</p>
  const answered = status !== null
  const driveTurns = pickedDrivesTurns ?? status?.driveTurns ?? null
  return (
    <div className="speech-server-settings local-live-agent">
      <p className="meta settings-caption">
        {t(
          'Your voice is recognized by a server you run, such as Hugging Face speech-to-speech or the one Hermes Live Voice starts. Hermes connects to it for Conduit, so it can run on another machine on your network.'
        )}
      </p>
      {!answered && !error ? <p className="meta settings-caption">{t('Checking…')}</p> : null}
      {status?.namesItsModel && presets.length ? (
        <label className="local-live-field">
          <span className="meta">{t('Known servers')}</span>
          <select
            value={picked?.id ?? ''}
            disabled={saving}
            onChange={e => {
              const preset = presets.find(p => p.id === e.target.value)
              if (preset) pick(preset)
            }}
          >
            <option value="" disabled>
              {t('Known servers')}
            </option>
            {presets.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="local-live-field">
        <span className="meta">{t('Server address')}</span>
        <input
          value={url}
          disabled={!answered}
          placeholder={picked?.urlHint ?? 'ws://192.168.1.20:8765/v1/realtime'}
          spellCheck={false}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && changes.url !== undefined && !saving) void write({ url: changes.url })
          }}
        />
        <span className="meta">
          {picked?.urlHint && !url
            ? t('Finish the address: put your own workspace or host in place of the example.')
            : t('Plain ws:// works for home network and Tailscale addresses. A server on the internet needs wss://.')}
        </span>
      </label>
      <label className="local-live-field">
        <span className="meta">
          {t('Key')} · {status?.hasKey ? t('Set') : t('None')}
        </span>
        <input type="password" value={key} disabled={!answered} placeholder={t('Optional, for a server behind a login')} onChange={e => setKey(e.target.value)} />
      </label>
      {status?.namesItsModel ? (
        <>
          <label className="local-live-field">
            <span className="meta">{t('Model')}</span>
            <input value={names.model} placeholder="gpt-realtime" spellCheck={false} onChange={e => setNames(n => ({ ...n, model: e.target.value }))} />
          </label>
          <label className="local-live-field">
            <span className="meta">{t('Voice')}</span>
            <input value={names.voice} placeholder="marin" spellCheck={false} onChange={e => setNames(n => ({ ...n, voice: e.target.value }))} />
          </label>
          <label className="local-live-field">
            <span className="meta">{t('Transcription model')}</span>
            <input
              value={names.transcription_model}
              placeholder="gpt-4o-mini-transcribe"
              spellCheck={false}
              onChange={e => setNames(n => ({ ...n, transcription_model: e.target.value }))}
            />
          </label>
          <p className="meta settings-caption">
            {t('Optional. A hosted server may need its model, a voice and a transcription model named. Leave them empty for a server that needs none, such as speech-to-speech.')}
          </p>
        </>
      ) : null}
      {driveTurns !== null && status?.configured ? (
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={driveTurns}
              disabled={saving}
              onChange={e => {
                const on = e.target.checked
                // The switch as clicked wins over a picked server's.
                setPicked(p => (p ? { ...p, drivesTurns: on } : p))
                void write({ driveTurns: on })
              }}
            />
            {t('Hermes answers')}
          </label>
          <p className="meta settings-caption">
            {t(
              "For a server with a model of its own, such as a hosted realtime model: it then only listens and reads Hermes' replies aloud. Leave it off for a server you point at Conduit, such as speech-to-speech."
            )}
          </p>
        </>
      ) : null}
      <div className="local-live-buttons">
        <button className="primary" disabled={!answered || saving || !hasChanges} onClick={() => void saveAll()}>
          {t('Save')}
        </button>
        <button className="secondary" disabled={testing || saving || !status?.configured} onClick={() => void runTest()}>
          {testing ? t('Testing…') : t('Test connection')}
        </button>
        {status?.hasKey ? (
          <button className="secondary" disabled={saving} onClick={() => void write({ apiKey: '' })}>
            {t('Remove key')}
          </button>
        ) : null}
      </div>
      {error ? <p className="meta settings-caption voice-call-problem">{error}</p> : null}
      {test ? (
        <>
          <p className={`meta settings-caption${test.connected ? '' : ' voice-call-problem'}`}>{testMessage(test)}</p>
          {test.connected && test.answersAlone === true && status?.driveTurns === false && status.ownModel !== true && pickedDrivesTurns !== true ? (
            <p className="meta settings-caption voice-call-problem">{t('This server has a model of its own. Turn on Hermes answers to have Hermes answer your calls on it.')}</p>
          ) : null}
        </>
      ) : status?.configured && !status.available && status.reason ? (
        <p className="meta settings-caption voice-call-problem">{status.reason}</p>
      ) : null}
    </div>
  )
}
