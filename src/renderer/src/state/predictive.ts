/**
 * Predictive suggested replies, after the phone's Predictive.swift: after a
 * reply settles in the open chat, the messages you'll most likely send next,
 * best first, from the plugin's `POST /predict` (0.80+), a no-tools fork of
 * the chat that saves nothing and answers only the device that asked. Off by
 * default and kept on this computer.
 */
import type { TranscriptItem } from './transcript'

export const PREDICT_CAPABILITY = 'predict'
export const PREDICT_PATH = '/api/plugins/conduit_push/predict'
export const MINIMUM_PLUGIN = '0.80'
export const REPLY_COUNTS = [1, 3, 5] as const
export const DEFAULT_REPLY_COUNT = 3
export const REPLIES_WAIT_S = 20
/** A guess longer than this is dropped, never shortened: a chip shows its whole message. */
export const MAX_GUESS_LENGTH = 200
/** Clicks this soon after the row shows are ignored, so a click meant for something else doesn't send. */
export const TAP_GUARD_MS = 400

export type PredictModel = 'fast' | 'chat'

const REPLIES_KEY = 'conduit.predictive.replies'
const COUNT_KEY = 'conduit.predictive.replyCount'
const MODEL_KEY = 'conduit.predictive.model'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The default next time.
  }
}

export const repliesEnabled = () => read(REPLIES_KEY) === 'true'
export const setRepliesEnabled = (on: boolean) => {
  write(REPLIES_KEY, String(on))
  window.dispatchEvent(new Event(PREDICTIVE_EVENT))
}
export function replyCount(): number {
  const n = Number(read(COUNT_KEY))
  return (REPLY_COUNTS as readonly number[]).includes(n) ? n : DEFAULT_REPLY_COUNT
}
export const setReplyCount = (n: number) => write(COUNT_KEY, String(n))
export const predictModel = (): PredictModel => (read(MODEL_KEY) === 'chat' ? 'chat' : 'fast')
export const setPredictModel = (m: PredictModel) => write(MODEL_KEY, m)
/** Fired when the switch changes, so an open chat shows or drops its chips. */
export const PREDICTIVE_EVENT = 'conduit:predictive'

export function repliesBody(sessionId: string, count: number, language: string, model: PredictModel) {
  return { session_id: sessionId, kind: 'replies', count: Math.min(Math.max(count, 1), 5), language, model, wait_s: REPLIES_WAIT_S }
}

/** The route's guesses, best first: blank or over-long ones dropped, repeats once, ties in the host's order. */
export function guesses(answer: unknown): string[] {
  const list = ((answer ?? {}) as Record<string, unknown>).replies
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  return list
    .flatMap((item, index) => {
      const r = (item ?? {}) as Record<string, unknown>
      const text = typeof r.text === 'string' ? r.text.trim() : ''
      if (!text || [...text].length > MAX_GUESS_LENGTH) return []
      const key = text.toLocaleLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      const p = typeof r.p === 'number' && Number.isFinite(r.p) ? Math.min(1, Math.max(0, r.p)) : 0.5
      return [{ text, p, index }]
    })
    .sort((a, b) => b.p - a.p || a.index - b.index)
    .map(g => g.text)
}

/**
 * The settled reply a chat ends on, as the key its guesses are kept under;
 * null while a turn runs, or when the chat ends on anything but a reply
 * (a notice, a failed turn, your own message).
 */
export function settledReply(items: TranscriptItem[], running: boolean): string | null {
  if (running) return null
  const last = items[items.length - 1]
  if (!last || last.kind !== 'assistant' || last.streaming || !last.text.trim()) return null
  const text = last.text.trim()
  return `${items.filter(i => i.kind === 'user').length}:${text.length}:${text.slice(-120)}`
}
