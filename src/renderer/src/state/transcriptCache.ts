/**
 * The last few chats' transcripts in this window (desktop#201), so going
 * back to a chat draws it at once while its resume runs, as the phone's
 * transcript cache does. The resume always runs and its answer replaces
 * what's drawn, so a chat changed elsewhere (the phone, another window)
 * shows its new rows once it answers. Only a settled transcript is kept:
 * not one with a turn running, a message still sending, or held messages,
 * whose live parts only the resume can give back.
 */
import type { TranscriptState } from './transcript'

export const TRANSCRIPT_CACHE_SIZE = 6

const kept = new Map<string, TranscriptState>()

/** Each dashboard's own, so switching between combined dashboards draws the chat it opens at once. */
const keyOf = (storedId: string, profile: string | undefined, host = '') => `${host}\n${profile || 'default'}\n${storedId}`

export function settled(state: TranscriptState): boolean {
  return !state.running && !state.held?.length && state.items.length > 0 && !state.items.some(i => i.kind === 'user' && i.pending)
}

/** Keeps a chat's transcript as it was left, the newest first out of TRANSCRIPT_CACHE_SIZE. */
export function keepTranscript(storedId: string | null, profile: string | undefined, state: TranscriptState, host = ''): void {
  if (!storedId) return
  const key = keyOf(storedId, profile, host)
  kept.delete(key)
  if (!settled(state)) return
  kept.set(key, state)
  // Each dashboard keeps its own six, so opening chats on one doesn't push out another's.
  const prefix = `${host}\n`
  const mine = [...kept.keys()].filter(k => k.startsWith(prefix))
  for (const old of mine.slice(0, Math.max(0, mine.length - TRANSCRIPT_CACHE_SIZE))) kept.delete(old)
}

/** The transcript kept for a chat, to draw while it resumes; null when none. */
export function keptTranscript(storedId: string, profile: string | undefined, host = ''): TranscriptState | null {
  const key = keyOf(storedId, profile, host)
  const state = kept.get(key)
  if (!state) return null
  kept.delete(key)
  kept.set(key, state)
  return state
}

/** The chats kept for dashboards no longer saved go. */
export function forgetTranscriptHosts(hosts: readonly string[]): void {
  for (const key of [...kept.keys()]) if (!hosts.includes(key.slice(0, key.indexOf('\n')))) kept.delete(key)
}

/** A dashboard's connection dropped: what was kept for it may not be current. The others' stay. */
export function forgetTranscripts(host = ''): void {
  const prefix = `${host}\n`
  for (const key of [...kept.keys()]) if (key.startsWith(prefix)) kept.delete(key)
}
