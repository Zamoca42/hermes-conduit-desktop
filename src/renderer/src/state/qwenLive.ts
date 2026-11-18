/**
 * Qwen Live, after the phone's QwenLiveSocket: Alibaba Cloud's realtime model
 * (DashScope), reached directly with a temporary key the Hermes host mints per
 * connection (`qwen-live/token`); the computer's main process opens the socket
 * with it, so the key never reaches the window. The call shell is Gemini
 * Live's: this adapter turns its frames into Qwen's events and Qwen's events
 * back into Gemini's frames, as the phone does.
 */
import { gateway } from '../gateway'
import { withProfile } from './gptLive'

export const STATUS_PATH = '/api/plugins/conduit_push/qwen-live/status'
export const TOKEN_PATH = '/api/plugins/conduit_push/qwen-live/token'
export const WEB_SEARCH_STATUS_PATH = '/api/plugins/conduit_push/web-search/status'
export const WEB_SEARCH_PATH = '/api/plugins/conduit_push/web-search'
export const DEFAULT_MODEL = 'qwen3.8-omni-flash-realtime'
export const DEFAULT_VOICE = 'Tina'
/** The Omni Realtime client-events contract fixes this model value. */
export const TRANSCRIPTION_MODEL = 'qwen3-asr-flash-realtime'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export type Availability = { ok: true; model: string } | { ok: false; reason: string | null }

/** The plugin's status: whether this host can mint Qwen Live keys. */
export function availability(response: unknown): Availability {
  const r = (response ?? {}) as Row
  const reason = str(r.reason) ?? str(r.detail) ?? str(r.error)
  if (r.ok !== true || r.available !== true) return { ok: false, reason }
  return { ok: true, model: str(r.model) ?? DEFAULT_MODEL }
}

// MARK: Web search (the host's own: Qwen's native search can't run beside function tools)

export const WEB_SEARCH = 'web_search'

export const WEB_SEARCH_SPEC = {
  name: WEB_SEARCH,
  description:
    "Search the web for current information: weather, news, sports, prices, and other quick facts. Returns titles, snippets and URLs. Answer from them at the answer length your instructions set; don't read URLs aloud.",
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'A short web search query.' } }, required: ['query'] }
}

/** Whether the host has a web search set up for live calls' lookups. */
export async function webSearchAvailable(profile?: string): Promise<boolean> {
  try {
    const r = (await gateway.http('GET', withProfile(WEB_SEARCH_STATUS_PATH, profile))) as Row
    return r?.ok === true && r.available === true
  } catch {
    return false
  }
}

/** The search's answer for the model: numbered titles, snippets and URLs, as the phone sends them. */
export function searchAnswer(response: unknown): Record<string, string> {
  const results = ((response ?? {}) as Row).results
  const rows = Array.isArray(results) ? (results as Row[]).filter(r => r && typeof r === 'object' && str(r.url)) : []
  if (!rows.length) return { results: 'No results.' }
  return { results: rows.map((r, i) => `${i + 1}. ${str(r.title) ?? ''}: ${str(r.snippet) ?? ''} (${str(r.url)})`).join('\n') }
}

export async function webSearch(profile: string | undefined, query: string): Promise<Record<string, string>> {
  const q = query.trim()
  if (!q) return { error: 'query is required' }
  try {
    return searchAnswer(await gateway.http('POST', withProfile(WEB_SEARCH_PATH, profile), { query: q, limit: 3 }, 20_000))
  } catch (e) {
    // The host's own reason lets the model tell the user what's wrong.
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// MARK: The adapter

/** Gemini's OpenAPI schema (types in capitals) as JSON Schema. */
export function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value as Row).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toLowerCase() : jsonSchema(v)]))
  return value
}

/** Gemini's setup as Qwen's session.update: PCM 16 kHz in, 24 kHz out, server turn detection, the function tools only. */
export function sessionUpdate(setup: Row, voice: string): Row {
  const parts = ((setup.systemInstruction as Row | undefined)?.parts ?? []) as Row[]
  const declarations = ((setup.tools ?? []) as Row[]).flatMap(tool => (Array.isArray(tool?.functionDeclarations) ? (tool.functionDeclarations as Row[]) : []))
  return {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: parts
        .map(part => part.text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n'),
      audio: { input: { format: { type: 'pcm', sample_rate: 16000 } }, output: { format: { type: 'pcm', sample_rate: 24000 }, voice } },
      input_audio_transcription: { model: TRANSCRIPTION_MODEL },
      turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 800 },
      tools: declarations.map(d => ({
        type: 'function',
        function: { name: d.name ?? '', description: d.description ?? '', parameters: jsonSchema(d.parameters ?? {}) }
      }))
    }
  }
}

/** A second of silence at 16 kHz (32,000 zero bytes): Qwen ends a muted utterance through its VAD. */
let secondOfSilence = ''
const SECOND_OF_SILENCE = () => (secondOfSilence ||= btoa('\0'.repeat(32_000)))

export class QwenLiveError extends Error {}

/**
 * Turns the Gemini call's frames into Qwen events (`send`) and Qwen's events
 * into Gemini frames (`receive`). A reply is asked for (`response.create`)
 * only when none is running and no function call waits on its answer.
 */
export class QwenAdapter {
  private activeResponse = false
  private wantsResponse = false
  private pendingTools = new Set<string>()
  private toolNames = new Map<string, string>()
  private deliveredTools = new Set<string>()

  constructor(
    private readonly voice: string,
    private readonly emit: (event: Row) => void,
    private readonly eventId: () => string = () => crypto.randomUUID()
  ) {}

  private out(event: Row) {
    this.emit({ ...event, event_id: this.eventId() })
  }

  private respond() {
    this.wantsResponse = true
    this.flush()
  }

  private flush() {
    if (!this.wantsResponse || this.activeResponse || this.pendingTools.size) return
    this.wantsResponse = false
    this.activeResponse = true
    this.out({ type: 'response.create' })
  }

  /** One frame the Gemini call would send. */
  send(frame: Row): void {
    if (frame.setup && typeof frame.setup === 'object') return this.out(sessionUpdate(frame.setup as Row, this.voice))
    const input = frame.realtimeInput as Row | undefined
    if (input && typeof input === 'object') {
      const audio = str((input.audio as Row | undefined)?.data)
      if (audio) this.out({ type: 'input_audio_buffer.append', audio })
      if (input.audioStreamEnd === true) this.out({ type: 'input_audio_buffer.append', audio: SECOND_OF_SILENCE() })
      return
    }
    const content = frame.clientContent as Row | undefined
    if (content && typeof content === 'object') {
      for (const turn of (Array.isArray(content.turns) ? content.turns : []) as Row[]) {
        const words = ((Array.isArray(turn?.parts) ? turn.parts : []) as Row[])
          .map(part => part.text)
          .filter((text): text is string => typeof text === 'string')
          .join('\n')
        if (words) this.out({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: words }] } })
      }
      if (content.turnComplete === true) this.respond()
      return
    }
    const responses = (frame.toolResponse as Row | undefined)?.functionResponses
    if (Array.isArray(responses)) {
      let respond = false
      for (const r of responses as Row[]) {
        const id = str(r.id)
        if (!id) continue
        const output: Row = { ...((r.response as Row | undefined) ?? {}) }
        const scheduling = str(r.scheduling) ?? str(output.scheduling)
        if (scheduling !== 'SILENT') respond = true
        delete output.scheduling
        this.out({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: id, output: JSON.stringify(output) } })
        this.pendingTools.delete(id)
        this.toolNames.delete(id)
        this.deliveredTools.delete(id)
      }
      if (respond) this.respond()
      else this.flush()
    }
  }

  /** One Qwen event as the Gemini frame the call reads; null for one it doesn't need. Throws when Qwen reports a failure. */
  receive(text: string): string | null {
    let event: Row
    try {
      event = JSON.parse(text) as Row
    } catch {
      return null
    }
    if (!event || typeof event !== 'object') return null
    let mapped: Row | null = null
    switch (event.type) {
      case 'session.updated':
        mapped = { setupComplete: {} }
        break
      case 'response.created':
        this.activeResponse = true
        break
      case 'response.audio.delta': {
        const audio = str(event.delta)
        if (audio) mapped = { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: audio } }] } } }
        break
      }
      case 'response.audio_transcript.delta':
      case 'response.text.delta': {
        const delta = str(event.delta)
        if (delta) mapped = { serverContent: { outputTranscription: { text: delta } } }
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = str(event.transcript)
        if (transcript) mapped = { serverContent: { inputTranscription: { text: transcript } } }
        break
      }
      case 'input_audio_buffer.speech_started':
        this.wantsResponse = false
        mapped = { serverContent: { interrupted: true } }
        break
      case 'response.output_item.added': {
        const item = (event.item ?? {}) as Row
        const id = str(item.call_id)
        const name = str(item.name)
        if (item.type === 'function_call' && id && name) {
          this.toolNames.set(id, name)
          this.pendingTools.add(id)
        }
        break
      }
      case 'response.function_call_arguments.done': {
        const id = str(event.call_id)
        const name = str(event.name) ?? (id ? this.toolNames.get(id) : undefined)
        if (id && name && !this.deliveredTools.has(id)) {
          let args: unknown = {}
          try {
            args = JSON.parse(str(event.arguments) ?? '{}')
          } catch {
            args = null
          }
          this.pendingTools.add(id)
          this.deliveredTools.add(id)
          // Arguments that aren't an object reach the call as a list, which it marks invalid.
          mapped = {
            toolCall: { functionCalls: [{ id, name, args: args && typeof args === 'object' && !Array.isArray(args) ? args : { invalid_arguments: true } }] }
          }
        }
        break
      }
      case 'response.done': {
        this.activeResponse = false
        // A cancelled response can end before a call's arguments arrive: no one can answer that call.
        for (const id of [...this.pendingTools]) if (!this.deliveredTools.has(id)) this.pendingTools.delete(id)
        for (const id of [...this.toolNames.keys()]) if (!this.deliveredTools.has(id)) this.toolNames.delete(id)
        if (((event.response ?? {}) as Row).status === 'failed') throw new QwenLiveError('Qwen Live request failed. Check the model, workspace and quota.')
        mapped = { serverContent: { turnComplete: true } }
        this.flush()
        break
      }
      case 'error':
        throw new QwenLiveError('Qwen Live request failed. Check the model, workspace and quota.')
    }
    return mapped ? JSON.stringify(mapped) : null
  }
}

// MARK: Settings (kept on this computer, each off until switched on: it sends that text to Alibaba Cloud)

const VOICE_KEY = 'conduit.qwenLiveVoice'
const MEMORY_KEY = 'conduit.qwenLiveMemory'
const PERSONA_KEY = 'conduit.qwenLivePersonality'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // The default next time.
  }
}

/** The voice typed here; '' leaves the host's (or Tina). */
export const qwenVoice = () => read(VOICE_KEY)
export const setQwenVoice = (voice: string) => write(VOICE_KEY, voice.trim())
/** Letters, digits, - or _, as the plugin bounds it. */
export const validVoice = (voice: string) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(voice)
export const qwenSendsMemory = () => read(MEMORY_KEY) === 'true'
export const qwenSendsPersona = () => read(PERSONA_KEY) === 'true'
export const setQwenSendsMemory = (on: boolean) => write(MEMORY_KEY, on ? 'true' : '')
export const setQwenSendsPersona = (on: boolean) => write(PERSONA_KEY, on ? 'true' : '')
