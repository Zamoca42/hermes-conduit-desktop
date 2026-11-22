/**
 * When a Classic call's turn is said: speech, then a pause. Pure, so the
 * thresholds can be tested.
 */

export type CallPhase = 'starting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'muted' | 'ready' | 'failed'

/** The meter's level that counts as speech, and as quiet. */
export const SPEECH_LEVEL = 0.08
export const QUIET_LEVEL = 0.045
/** How long a pause after speech ends the turn. */
export const PAUSE_MS = 1300
/** Speech must last this long to count, so a click or a cough doesn't. */
export const SPEECH_MS = 250
/** The longest a turn listens. */
export const MAX_TURN_S = 120

export interface VoiceState {
  heard: boolean
  /** When the current run of speech began, or 0. */
  loudAt: number
  /** When the current quiet began. */
  quietSince: number
}

export function callStep(state: VoiceState, level: number, now: number, elapsedS: number): { state: VoiceState; done: boolean } {
  if (elapsedS >= MAX_TURN_S) return { state, done: true }
  if (level >= SPEECH_LEVEL) {
    const loudAt = state.loudAt || now
    return { state: { heard: state.heard || now - loudAt >= SPEECH_MS, loudAt, quietSince: 0 }, done: false }
  }
  if (level <= QUIET_LEVEL) {
    const quietSince = state.quietSince || now
    return { state: { ...state, loudAt: 0, quietSince }, done: state.heard && now - quietSince >= PAUSE_MS }
  }
  return { state, done: false }
}

/** A call orb's size for the microphone's level (0 to 1): quiet speech shows too. */
export const micScale = (level: number) => 1 + Math.min(0.9, Math.sqrt(Math.max(0, level)) * 1.6)
