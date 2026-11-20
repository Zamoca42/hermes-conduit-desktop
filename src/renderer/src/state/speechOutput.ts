/**
 * Who speaks Read Aloud and Classic voice's replies, after the phone's
 * Assistant speech (Settings > Voice > Read Aloud > Voice, hermes-conduit#2876):
 * Hermes' speech providers, this computer's own voices, which need nothing
 * set up on Hermes, or the user's own speech server (speechServerSpeech.ts). Kept on this computer per profile. The live modes speak
 * with their own voices.
 */
import { language } from '../../../shared/i18n'

export type SpeechOutput = 'hermes' | 'computer' | 'server'
export const SPEECH_OUTPUTS: SpeechOutput[] = ['computer', 'hermes', 'server']

const KEY = 'conduit.speechOutput.v1'
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
const nameOf = (profile?: string) => (profile || 'default').toLowerCase()

function readAll(storage: Storage): Record<string, SpeechOutput> {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) ?? 'null')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** The profile's choice; Hermes' speech until one is made, as before there was a choice. */
export function speechOutput(profile?: string, storage: Storage = localStorage): SpeechOutput {
  const saved = readAll(storage)[nameOf(profile)]
  return saved === 'computer' || saved === 'server' ? saved : 'hermes'
}

export function setSpeechOutput(profile: string | undefined, output: SpeechOutput, storage: Storage = localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify({ ...readAll(storage), [nameOf(profile)]: output }))
  } catch {
    // Private storage: Hermes' speech stands.
  }
}

/** Whether this computer can speak at all (the system's voices, through Chromium). */
export const computerCanSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window

/** A voice for the app's language, else the system's default. */
function voiceFor(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const base = lang.toLowerCase().split('-')[0]!
  return (
    voices.find(v => v.lang.toLowerCase() === lang.toLowerCase() && v.default) ??
    voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find(v => v.lang.toLowerCase().split(/[-_]/)[0] === base) ??
    null
  )
}

/**
 * Speaks `text` with this computer's voices. `done` settles when it ends,
 * rejecting if the system couldn't speak; `stop` ends it at once (and `done`
 * settles as ended).
 */
export function speakOnComputer(text: string): { done: Promise<void>; stop: () => void } {
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const lang = language()
  utterance.lang = lang
  const voice = voiceFor(lang)
  if (voice) utterance.voice = voice
  let stopped = false
  const done = new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve()
    utterance.onerror = event => (stopped || event.error === 'interrupted' || event.error === 'canceled' ? resolve() : reject(new Error(event.error)))
  })
  synth.speak(utterance)
  return {
    done,
    stop: () => {
      stopped = true
      synth.cancel()
    }
  }
}
