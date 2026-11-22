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

const VOICE_KEY = 'conduit.computerVoice.v1'
const baseOf = (lang: string) => lang.toLowerCase().split(/[-_]/)[0]!

function readPicks(storage: Storage): Record<string, string> {
  try {
    const parsed = JSON.parse(storage.getItem(VOICE_KEY) ?? 'null')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The voice picked for a language on this computer, by its voiceURI; '' is
 * automatic. Per language and per computer, not per profile, as the
 * phone's iPhone voice pick: voices are installed per computer.
 */
export function computerVoicePick(lang: string, storage: Storage = localStorage): string {
  const pick = readPicks(storage)[baseOf(lang)]
  return typeof pick === 'string' ? pick : ''
}

export function setComputerVoicePick(lang: string, voiceURI: string, storage: Storage = localStorage): void {
  const picks = readPicks(storage)
  if (voiceURI) picks[baseOf(lang)] = voiceURI
  else delete picks[baseOf(lang)]
  try {
    storage.setItem(VOICE_KEY, JSON.stringify(picks))
  } catch {
    // Private storage: automatic stands.
  }
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'voiceURI' | 'name' | 'lang' | 'default'>

/** The system's voices for a language: the exact language first, then its other regions, each by name. */
export function voicesFor<V extends VoiceLike>(voices: V[], lang: string): V[] {
  const exact = lang.toLowerCase()
  const base = baseOf(lang)
  const rank = (v: V) => (v.lang.toLowerCase().replace('_', '-') === exact ? 0 : 1)
  return voices.filter(v => baseOf(v.lang) === base).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** The voice to speak `lang` with: the one picked, while it's installed; else the system's default for it, else the first. */
export function chooseVoice<V extends VoiceLike>(voices: V[], lang: string, pick: string): V | null {
  const listed = voicesFor(voices, lang)
  const exact = lang.toLowerCase()
  return (
    (pick ? listed.find(v => v.voiceURI === pick) : undefined) ??
    listed.find(v => v.lang.toLowerCase() === exact && v.default) ??
    listed.find(v => v.default) ??
    listed[0] ??
    null
  )
}

/**
 * Speaks `text` with this computer's voice for the app's language (the one
 * picked in Settings, or `voiceURI` for a preview). `done` settles when it ends,
 * rejecting if the system couldn't speak; `stop` ends it at once (and `done`
 * settles as ended).
 */
export function speakOnComputer(text: string, voiceURI?: string): { done: Promise<void>; stop: () => void } {
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const lang = language()
  utterance.lang = lang
  const voice = chooseVoice(synth.getVoices(), lang, voiceURI ?? computerVoicePick(lang))
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
