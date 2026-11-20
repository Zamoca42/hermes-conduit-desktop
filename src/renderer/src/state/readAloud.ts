/**
 * Read Aloud: one reply at a time, spoken by Hermes' voice, this
 * computer's or the speech server's, as Settings > Voice picks (speechOutput.ts). Asking for
 * another stops the first; the message playing is told to whoever listens,
 * so its menu says Stop. Each reading keeps a trace of how it went
 * (Settings > Last Read Aloud), without the reply's words.
 */
import { useSyncExternalStore } from 'react'
import { startReadingTrace, type CallTrace } from './callTrace'
import { speak, spokenText } from './voice'
import { speechOutput } from './speechOutput'
import { speakHere } from './speechServerSpeech'

let playing: { key: string; audio: HTMLAudioElement | null; trace: CallTrace; stop?: () => void } | null = null
const listeners = new Set<() => void>()
const tell = () => listeners.forEach(listener => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The message being read or fetched, by its key. */
export function useReadingKey(): string | null {
  return useSyncExternalStore(subscribe, () => playing?.key ?? null)
}

export function stopReading() {
  if (playing) {
    playing.trace.end('stopped')
  }
  playing?.audio?.pause()
  playing?.stop?.()
  playing = null
  tell()
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
/** A data URL's size and kind, for the trace: never its audio. */
function clipSize(url: string): string {
  const comma = url.indexOf(',')
  const kind = url.slice(5, comma).split(';')[0] || 'audio'
  return `${Math.round(((url.length - comma - 1) * 3) / 4 / 1024)} KB of ${kind}`
}

/** Reads `text` aloud; throws when Hermes can't speak it. */
export async function readAloud(key: string, text: string, profile?: string): Promise<void> {
  stopReading()
  const words = spokenText(text)
  if (!words) return
  const trace = startReadingTrace(`Reading a reply: ${words.length} of its ${text.length} characters to speak`)
  const mine: NonNullable<typeof playing> = { key, audio: null, trace }
  playing = mine
  tell()
  const asked = Date.now()
  const output = speechOutput(profile)
  if (output !== 'hermes') {
    trace.step(output === 'computer' ? 'Speaking with this computer’s voice' : 'Speaking with your speech server')
    const spoken = speakHere(words, output, profile, step => trace.step(step))
    mine.stop = spoken.stop
    trace.step('Playing')
    try {
      await spoken.done
      if (playing === mine) {
        trace.end('finished playing')
        playing = null
        tell()
      }
    } catch (e) {
      trace.step(`Failed: ${e instanceof Error ? e.message : 'error'}`)
      if (playing === mine) {
        trace.end('error')
        playing = null
        tell()
      }
      throw e
    }
    return
  }
  try {
    trace.step('Speaking with Hermes speech')
    const url = await speak(words, profile)
    trace.step(`Hermes speech answered after ${seconds(Date.now() - asked)}: ${clipSize(url)}`)
    if (playing !== mine) return
    const audio = new Audio(url)
    mine.audio = audio
    audio.onloadedmetadata = () => Number.isFinite(audio.duration) && trace.step(`Audio is ${audio.duration.toFixed(1)} s long`)
    let started = false
    audio.onplaying = () => {
      trace.step(started ? 'Playing again' : 'Playing')
      started = true
    }
    // Before the first audio, waiting is only the clip loading.
    audio.onwaiting = () => started && trace.step('Playback waiting for audio')
    audio.onerror = () => {
      trace.step(`Playback failed (${audio.error?.code ?? '?'})`)
      if (playing === mine) {
        trace.end('error')
        playing = null
        tell()
      }
    }
    audio.onended = () => {
      if (playing !== mine) return
      trace.end('finished playing')
      playing = null
      tell()
    }
    await audio.play()
  } catch (e) {
    trace.step(`Failed: ${e instanceof Error ? e.name : 'error'}`)
    if (playing === mine) {
      trace.end('error')
      playing = null
      tell()
    }
    throw e
  }
}

const AUTO_KEY = 'conduit.readRepliesAloud'

/** Settings > Read replies aloud: each reply in the open chat is read as its turn ends. Off by default, as on the phone. */
export function readsRepliesAloud(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === 'on'
  } catch {
    return false
  }
}

export function setReadsRepliesAloud(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off')
  } catch {
    // Private storage: off stands.
  }
  if (!on) stopReading()
}
