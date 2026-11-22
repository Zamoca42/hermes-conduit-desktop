/**
 * Classic voice's conversation switches and Read Aloud's speed, after the
 * phone's Settings > Voice > Conversation and Read Aloud > Speed. Kept on
 * this computer, as the phone keeps push to talk on the phone.
 *
 * - Push to talk: hold the microphone button while you speak and let go to
 *   send, so a pause never ends your turn; slide off before letting go to
 *   cancel; a press while Hermes speaks stops the reply.
 * - Continuous Conversation (on by default): Conduit listens again after
 *   each reply. Off, the call stays open and you start the next turn.
 * - Read Aloud speed: how fast a reply is read, without changing the
 *   voice's pitch. Calls always play at normal speed.
 */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const PUSH_KEY = 'conduit.voice.pushToTalk'
const CONTINUOUS_KEY = 'conduit.voice.continuousConversation'
const SPEED_KEY = 'conduit.voice.readAloudSpeed'

/** The phone's speeds, 1x to 2x. */
export const READ_ALOUD_SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const
export const speedLabel = (speed: number) => `${speed}x`

function read(key: string, storage: Storage): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string, storage: Storage): void {
  try {
    storage.setItem(key, value)
  } catch {
    // Private storage: the default stands.
  }
}

export const pushToTalk = (storage: Storage = localStorage): boolean => read(PUSH_KEY, storage) === 'on'
export const setPushToTalk = (on: boolean, storage: Storage = localStorage) => write(PUSH_KEY, on ? 'on' : 'off', storage)

export const continuousConversation = (storage: Storage = localStorage): boolean => read(CONTINUOUS_KEY, storage) !== 'off'
export const setContinuousConversation = (on: boolean, storage: Storage = localStorage) => write(CONTINUOUS_KEY, on ? 'on' : 'off', storage)

/** The speed picked, the nearest of the phone's to one stored any other way; normal until one is. */
export function readAloudSpeed(storage: Storage = localStorage): number {
  const stored = Number(read(SPEED_KEY, storage))
  if (!Number.isFinite(stored) || stored <= 0) return 1
  return READ_ALOUD_SPEEDS.reduce((best, s) => (Math.abs(s - stored) < Math.abs(best - stored) ? s : best), 1)
}
export const setReadAloudSpeed = (speed: number, storage: Storage = localStorage) => write(SPEED_KEY, String(speed), storage)

/** What a Classic call does once a reply is spoken (or a turn heard nothing): listen again, or wait for you. */
export function afterReply(options: { muted: boolean; pushToTalk: boolean; continuous: boolean }): 'listen' | 'ready' | 'muted' {
  if (options.muted) return 'muted'
  return options.pushToTalk || !options.continuous ? 'ready' : 'listen'
}
