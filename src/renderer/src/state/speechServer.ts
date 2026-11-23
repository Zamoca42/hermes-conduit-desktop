/**
 * The user's own speech server, after the phone's Your speech server
 * (SpeechServerSettingsView): its address, an optional key, the names a
 * hosted server needs, the known servers that fill them in, the Hermes
 * answers and own model switches, and a test the Hermes host runs. All of
 * it lives in the profile's Hermes config under `voice.speech_server`,
 * which the Conduit plugin reads when it relays a call's audio.
 */
import { t } from '../../../shared/i18n'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export const SPEECH_SERVER_STATUS_PATH = '/api/plugins/conduit_push/speech-server/status'
export const SPEECH_SERVER_TEST_PATH = '/api/plugins/conduit_push/speech-server/test'
export const SPEECH_SERVER_PRESETS_PATH = '/api/plugins/conduit_push/speech-server/presets'

export const SPEECH_SERVER_MISSING = () => t('Update the Conduit plugin on your Hermes host to use your own speech server.')

export interface SpeechServerStatus {
  configured: boolean
  available: boolean
  /** The WebSocket address the host dials, normalized. */
  url: string | null
  hasKey: boolean
  /** Null from a plugin before the Hermes answers switch (0.173.0), which shows none. */
  driveTurns: boolean | null
  /** Null from a plugin before the own model switch (0.175.0). */
  ownModel: boolean | null
  model: string | null
  voice: string | null
  transcriptionModel: string | null
  /** False from a plugin before the names (0.174.0), which has no fields for them. */
  namesItsModel: boolean
  reason: string | null
}

export function speechServerStatus(raw: unknown): SpeechServerStatus {
  const r = object(raw) ?? {}
  return {
    configured: r.configured === true,
    available: r.available === true,
    url: text(r.url),
    hasKey: r.has_key === true,
    driveTurns: typeof r.drive_turns === 'boolean' ? r.drive_turns : null,
    ownModel: typeof r.own_model === 'boolean' ? r.own_model : null,
    model: text(r.model),
    voice: text(r.voice),
    transcriptionModel: text(r.transcription_model),
    namesItsModel: 'model' in r,
    reason: text(r.reason) ?? text(r.detail)
  }
}

/** A server the plugin knows by name: picking it only fills the fields in. */
export interface SpeechServerPreset {
  id: string
  name: string
  /** A complete address, saved as is. */
  url: string | null
  /** An example address to finish, such as one with a workspace in it. */
  urlHint: string | null
  model: string | null
  voice: string | null
  transcriptionModel: string | null
  needsKey: boolean
  /** The server has a model of its own, so Hermes answers starts on. */
  drivesTurns: boolean
}

export function speechServerPresets(raw: unknown): SpeechServerPreset[] {
  const list = object(raw)?.presets
  if (!Array.isArray(list)) return []
  return list.flatMap(item => {
    const r = object(item)
    const id = text(r?.id)
    const name = text(r?.name)
    if (!r || !id || !name) return []
    return [
      {
        id,
        name,
        url: text(r.url),
        urlHint: text(r.url_hint),
        model: text(r.model),
        voice: text(r.voice),
        transcriptionModel: text(r.transcription_model),
        needsKey: r.needs_key === true,
        drivesTurns: r.drive_turns === true
      }
    ]
  })
}

export interface SpeechServerTest {
  connected: boolean
  latencyMs: number | null
  reason: string | null
  /** What the server's first event says: it answers by itself, the kind of server Hermes answers is for. */
  answersAlone: boolean | null
}

export function speechServerTest(raw: unknown): SpeechServerTest {
  const r = object(raw) ?? {}
  const abilities = object(r.abilities)
  return {
    connected: r.connected === true,
    latencyMs: typeof r.latency_ms === 'number' ? Math.round(r.latency_ms) : null,
    reason: text(r.reason) ?? text(r.detail),
    answersAlone: typeof abilities?.answers_alone === 'boolean' ? abilities.answers_alone : null
  }
}

export function testMessage(result: SpeechServerTest): string {
  if (result.connected) {
    return result.latencyMs !== null
      ? t('Connected. Your speech server answered in {ms} ms.', {
          ms: String(result.latencyMs)
        })
      : t('Connected to your speech server.')
  }
  return result.reason ?? t('Could not reach your speech server.')
}

/** The names a hosted server may need, by their key under voice.speech_server. */
export type NameKey = 'model' | 'voice' | 'transcription_model'
export type Names = Record<NameKey, string>

export const savedNames = (status: SpeechServerStatus | null): Names => ({
  model: status?.model ?? '',
  voice: status?.voice ?? '',
  transcription_model: status?.transcriptionModel ?? ''
})

/** The names that differ from what the host has; an emptied one is sent as "" (see withSpeechServer). */
export function changedNames(drafts: Names, status: SpeechServerStatus | null): Partial<Names> {
  if (!status?.namesItsModel) return {}
  const saved = savedNames(status)
  const changed: Partial<Names> = {}
  for (const key of Object.keys(drafts) as NameKey[]) {
    const value = drafts[key].trim()
    if (value !== saved[key]) changed[key] = value
  }
  return changed
}

export interface SpeechServerChange {
  url?: string
  apiKey?: string
  names?: Partial<Names>
  driveTurns?: boolean
  ownModel?: boolean
}

/**
 * `config` with the change made under voice.speech_server, as the phone
 * writes it: a value trimmed, an emptied one saved as "" and a switch off
 * as false. Never a key taken out: Hermes' PUT /api/config merges what it's
 * sent over the file, so a missing key keeps its old value, and Hermes
 * answers could never be turned off (app issue 3153). The plugin reads ""
 * and false as unset. One read and one save, so a picked known server
 * lands whole or not at all.
 */
export function withSpeechServer(config: Row, change: SpeechServerChange): Row {
  const voice: Row = { ...(object(config.voice) ?? {}) }
  const server: Row = { ...(object(voice.speech_server) ?? {}) }
  const put = (key: string, value: string | boolean | undefined) => {
    if (value === undefined) return
    server[key] = typeof value === 'string' ? value.trim() : value
  }
  put('url', change.url)
  put('api_key', change.apiKey)
  for (const [key, value] of Object.entries(change.names ?? {})) put(key, value)
  put('drive_turns', change.driveTurns)
  put('own_model', change.ownModel)
  voice.speech_server = server
  return { ...config, voice }
}

/**
 * A field the user hasn't touched since the host last answered follows the
 * host's newer value; one typed meanwhile stays. `sent` is what a save sent,
 * so a field typed back to the old value during that save stays too.
 */
export function followed(draft: string, was: string | null, now: string | null, sent?: string): string {
  return draft.trim() === (sent ?? was ?? '') ? (now ?? '') : draft
}
