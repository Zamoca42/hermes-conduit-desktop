/**
 * Gemini Live, after the phone's GeminiLiveTokenClient and GeminiLiveProtocol:
 * the Hermes host keeps GEMINI_API_KEY and mints a single-use Google token per
 * connection (`gemini-live/token`); the computer's main process opens Google's
 * socket with it (BidiGenerateContent), so the token never reaches the window.
 * Pure encode and decode here, so every message shape is testable.
 */
import { RECALL_SPEC, TOOL_SPECS, liveInstructions, pcmBase64 } from './liveCall'

export const STATUS_PATH = '/api/plugins/conduit_push/gemini-live/status'
export const TOKEN_PATH = '/api/plugins/conduit_push/gemini-live/token'
export const DEFAULT_MODEL = 'models/gemini-3.8-live'
export const INPUT_RATE = 16_000
export const OUTPUT_RATE = 24_000
export const START_TIMEOUT_MS = 15_000

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export type Availability = { ok: true; model: string } | { ok: false; reason: string | null }

/** The plugin's status: whether this host can mint Gemini Live tokens. */
export function availability(response: unknown): Availability {
  const r = (response ?? {}) as Row
  const reason = str(r.reason) ?? str(r.error)
  if (r.ok !== true || r.available !== true) return { ok: false, reason }
  return { ok: true, model: str(r.model) ?? DEFAULT_MODEL }
}

/** `gemini-3.8-live` → `models/gemini-3.8-live`. */
export const qualifiedModel = (model: string) => (model.startsWith('models/') ? model : `models/${model}`)

// MARK: Instructions

/**
 * Gemini's instructions: the shared ones, with Google Search for quick facts,
 * and the request acknowledged as it goes (its ask_thread call stays open
 * until Hermes replies).
 */
export function instructions(options: { language?: string; persona?: string; memory?: string; recall?: boolean; chat?: string }): string {
  return liveInstructions({
    ...options,
    lookups: 'For weather, news, sports, prices, and other quick facts from the web, use Google Search and answer directly.',
    announces: true
  })
}

// MARK: Client → server

/**
 * The tools as Gemini declarations: OpenAPI types in capitals; ask_thread and
 * read_last_reply NON_BLOCKING (the call stays open while the model talks on),
 * end_conversation BLOCKING.
 */
export function functionDeclarations(recall = false): Row[] {
  const upper = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(upper)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value as Row).map(([k, v]) => [k, k === 'type' && typeof v === 'string' ? v.toUpperCase() : upper(v)]))
    return value
  }
  return [...TOOL_SPECS, ...(recall ? [RECALL_SPEC] : [])].map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: upper(tool.parameters),
    behavior: tool.name === 'end_conversation' ? 'BLOCKING' : 'NON_BLOCKING'
  }))
}

/** The session's setup: audio replies, the instructions, the tools with Google Search, and both transcriptions. */
export function setupMessage(model: string, systemInstruction: string, voice?: string | null, recall = false): Row {
  const generationConfig: Row = { responseModalities: ['AUDIO'] }
  if (voice) generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
  return {
    setup: {
      model: qualifiedModel(model),
      generationConfig,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: [{ functionDeclarations: functionDeclarations(recall) }, { googleSearch: {} }],
      realtimeInputConfig: {
        automaticActivityDetection: { disabled: false },
        // The user's speech always interrupts the model.
        activityHandling: 'START_OF_ACTIVITY_INTERRUPTS'
      },
      contextWindowCompression: { slidingWindow: {} },
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    }
  }
}

/** One microphone chunk at 16 kHz. */
export const audioMessage = (samples: Float32Array): Row => ({
  realtimeInput: { audio: { mimeType: `audio/pcm;rate=${INPUT_RATE}`, data: pcmBase64(samples) } }
})

/** The microphone was muted mid-utterance: the server ends the user's turn now. */
export const audioStreamEnd = (): Row => ({ realtimeInput: { audioStreamEnd: true } })

/** A message from Conduit for a call that has no open function call to answer on. */
export const textTurn = (text: string): Row => ({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } })

export type Scheduling = 'WHEN_IDLE' | 'SILENT'

/** A function call's answer; a NON_BLOCKING one's `scheduling` goes in both places Google reads it. */
export function toolResponse(id: string, name: string, result: Record<string, string>, scheduling?: Scheduling): Row {
  const response: Row = { ...result }
  const functionResponse: Row = { id, name }
  if (scheduling) {
    response.scheduling = scheduling
    functionResponse.scheduling = scheduling
  }
  functionResponse.response = response
  return { toolResponse: { functionResponses: [functionResponse] } }
}

// MARK: Server → client

export type ServerEvent =
  | { type: 'ready' }
  | { type: 'audio'; pcm: string }
  | { type: 'input'; text: string }
  | { type: 'output'; text: string }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'toolCall'; id: string; name: string; args: Record<string, string> }
  | { type: 'toolCancel'; ids: string[] }
  | { type: 'goAway' }

/** One frame can carry several events (audio, a transcription and turnComplete together). */
export function decode(text: string): ServerEvent[] {
  let o: Row
  try {
    o = JSON.parse(text) as Row
  } catch {
    return []
  }
  if (!o || typeof o !== 'object') return []
  const events: ServerEvent[] = []
  if (o.setupComplete !== undefined) events.push({ type: 'ready' })
  const content = o.serverContent as Row | undefined
  if (content && typeof content === 'object') {
    const parts = ((content.modelTurn as Row | undefined)?.parts ?? []) as Row[]
    for (const part of Array.isArray(parts) ? parts : []) {
      const inline = part.inlineData as Row | undefined
      const mime = str(inline?.mimeType)
      const data = str(inline?.data)
      if (mime?.startsWith('audio/pcm') && data) events.push({ type: 'audio', pcm: data })
    }
    const heard = str((content.inputTranscription as Row | undefined)?.text)
    if (heard) events.push({ type: 'input', text: heard })
    const said = str((content.outputTranscription as Row | undefined)?.text)
    if (said) events.push({ type: 'output', text: said })
    if (content.interrupted === true) events.push({ type: 'interrupted' })
    if (content.turnComplete === true) events.push({ type: 'turnComplete' })
  }
  const calls = (o.toolCall as Row | undefined)?.functionCalls
  for (const call of Array.isArray(calls) ? (calls as Row[]) : []) {
    const id = str(call.id)
    const name = str(call.name)
    if (!id || !name) continue
    const args: Record<string, string> = {}
    const raw = call.args && typeof call.args === 'object' ? (call.args as Row) : {}
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue
      args[key] = typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    events.push({ type: 'toolCall', id, name, args })
  }
  const cancelled = (o.toolCallCancellation as Row | undefined)?.ids
  if (Array.isArray(cancelled) && cancelled.length) events.push({ type: 'toolCancel', ids: cancelled.filter((id): id is string => typeof id === 'string') })
  if (o.goAway !== undefined) events.push({ type: 'goAway' })
  return events
}

/** Why Google closed the socket, for the call's failure line; null for an ordinary close. */
export const closeReason = (code: number, reason: string): string | null => (code === 1000 || code === 1005 ? null : reason.trim() || null)

// MARK: Voices

/** Google's prebuilt voices for native-audio models, in Google's order, with the phone's styles. */
export const VOICES: [string, string][] = [
  ['Zephyr', 'Bright'],
  ['Puck', 'Upbeat'],
  ['Charon', 'Informative'],
  ['Kore', 'Firm'],
  ['Fenrir', 'Excitable'],
  ['Leda', 'Youthful'],
  ['Orus', 'Firm'],
  ['Aoede', 'Breezy'],
  ['Callirrhoe', 'Easy-going'],
  ['Autonoe', 'Bright'],
  ['Enceladus', 'Breathy'],
  ['Iapetus', 'Clear'],
  ['Umbriel', 'Easy-going'],
  ['Algieba', 'Smooth'],
  ['Despina', 'Smooth'],
  ['Erinome', 'Clear'],
  ['Algenib', 'Gravelly'],
  ['Rasalgethi', 'Informative'],
  ['Laomedeia', 'Upbeat'],
  ['Achernar', 'Soft'],
  ['Alnilam', 'Firm'],
  ['Schedar', 'Even'],
  ['Gacrux', 'Mature'],
  ['Pulcherrima', 'Forward'],
  ['Achird', 'Friendly'],
  ['Zubenelgenubi', 'Casual'],
  ['Vindemiatrix', 'Gentle'],
  ['Sadachbia', 'Lively'],
  ['Sadaltager', 'Knowledgeable'],
  ['Sulafat', 'Warm']
]

const VOICE_KEY = 'conduit.geminiLiveVoice'

/** The voice picked here; '' leaves the host's (or Gemini's) default. */
export function geminiVoice(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setGeminiVoice(voice: string): void {
  try {
    if (voice) localStorage.setItem(VOICE_KEY, voice)
    else localStorage.removeItem(VOICE_KEY)
  } catch {
    // The default next time.
  }
}

// MARK: Settings (kept on this computer, each off until switched on: it sends that text to Google)

const MEMORY_KEY = 'conduit.geminiLiveMemory'
const PERSONA_KEY = 'conduit.geminiLivePersonality'

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function setFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'true')
    else localStorage.removeItem(key)
  } catch {
    // Off next time.
  }
}

export const geminiSendsMemory = () => flag(MEMORY_KEY)
export const geminiSendsPersona = () => flag(PERSONA_KEY)
export const setGeminiSendsMemory = (on: boolean) => setFlag(MEMORY_KEY, on)
export const setGeminiSendsPersona = (on: boolean) => setFlag(PERSONA_KEY, on)
