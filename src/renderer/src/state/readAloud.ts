/**
 * Read Aloud: one reply at a time, spoken by Hermes' voice. Asking for
 * another stops the first; the message playing is told to whoever listens,
 * so its menu says Stop.
 */
import { useSyncExternalStore } from 'react'
import { speak, spokenText } from './voice'

let playing: { key: string; audio: HTMLAudioElement | null } | null = null
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
  playing?.audio?.pause()
  playing = null
  tell()
}

/** Reads `text` aloud; throws when Hermes can't speak it. */
export async function readAloud(key: string, text: string, profile?: string): Promise<void> {
  stopReading()
  const words = spokenText(text)
  if (!words) return
  const mine = { key, audio: null as HTMLAudioElement | null }
  playing = mine
  tell()
  try {
    const url = await speak(words, profile)
    if (playing !== mine) return
    const audio = new Audio(url)
    mine.audio = audio
    audio.onended = () => {
      if (playing === mine) stopReading()
    }
    await audio.play()
  } catch (e) {
    if (playing === mine) stopReading()
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
