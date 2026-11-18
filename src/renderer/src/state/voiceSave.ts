/**
 * Saved live calls, after the phone's VoiceHistory: a live call never runs a
 * Hermes turn, so nothing on the host records it. When the call ends, the
 * plugin's `voice/sessions` route keeps its finished turns with the chat it
 * was attached to (or, with no chat yet, as a call of its own under Voice in
 * Sessions). Shared by every live voice mode, on unless switched off.
 */
import { gateway } from '../gateway'
import { withProfile } from './gptLive'

export const SESSIONS_PATH = '/api/plugins/conduit_push/voice/sessions'
/** The plugin's caps: turns per request and characters per turn. */
const MAX_TURNS = 500
const MAX_TURN_CHARACTERS = 16_000

export type LiveEngine = 'gpt-live' | 'grok-live' | 'gemini-live' | 'qwen-live' | 'local-live'
export interface CallTurn {
  role: 'user' | 'assistant'
  text: string
  /** Seconds since 1970, when it was said. */
  at: number
}

/** A call's id: the plugin skips turns it already holds under it, so a retry never doubles them. */
export const newCallId = () => `desktop-${crypto.randomUUID()}`

/** The request body: finished turns in order, numbered from 0; null when there's nothing to keep. */
export function saveBody(callId: string, engine: LiveEngine, turns: CallTurn[], chatId?: string | null): Record<string, unknown> | null {
  const kept = turns.map(turn => ({ ...turn, text: turn.text.trim() })).filter(turn => turn.text)
  if (!kept.length) return null
  const body: Record<string, unknown> = {
    call_id: callId,
    engine,
    turns: kept.slice(0, MAX_TURNS).map((turn, index) => ({
      index,
      role: turn.role,
      text: turn.text.slice(0, MAX_TURN_CHARACTERS),
      at: Math.round(turn.at)
    }))
  }
  if (chatId) body.chat_id = chatId
  return body
}

/** Keeps the call's transcript on the host; a host without the route (or a failure) loses only the copy. */
export async function saveCall(profile: string | undefined, callId: string, engine: LiveEngine, turns: CallTurn[], chatId?: string | null): Promise<boolean> {
  if (!savesCalls()) return false
  const body = saveBody(callId, engine, turns, chatId)
  if (!body) return false
  try {
    await gateway.http('POST', withProfile(SESSIONS_PATH, profile), body)
    return true
  } catch {
    return false
  }
}

const SAVE_KEY = 'conduit.liveSaveCalls'

/** On unless switched off, as on the phone. */
export function savesCalls(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setSavesCalls(on: boolean): void {
  try {
    if (on) localStorage.removeItem(SAVE_KEY)
    else localStorage.setItem(SAVE_KEY, 'false')
  } catch {
    // On next time.
  }
}
