/**
 * The steps of the last Grok Live, Qwen Live, Local Live or GPT-Live call,
 * after the phone's LiveCallTrace (#1424): setup, the microphone, the
 * server's turn detection and the user's turns, and each tool call, so the
 * user can copy them into an issue. Event kinds, function names, routes and
 * levels only: never what the user or the model said, a call's arguments or
 * a tool's answer. A long call keeps its first 20 steps and its newest ones,
 * up to 200 in all.
 */

export interface TraceStep {
  /** Milliseconds since the call started. */
  at: number
  text: string
}

export const HEAD_STEPS = 20
export const MAX_STEPS = 200
/** The user's turn levels are measured over 100 ms windows. */
export const LEVEL_WINDOW_MS = 100
/** Audio this long with no start, or no end, of speech is said once. */
export const SILENT_TURN_MS = 15_000

const dbfs = (rms: number) => (rms > 0 ? `${Math.max(-120, Math.round(20 * Math.log10(rms)))} dBFS` : '-inf dBFS')

export class CallTrace {
  readonly name: string
  /** What the trace follows: a call, or a Read Aloud reading. */
  readonly noun: string
  readonly startedAt: number
  private head: TraceStep[] = []
  private tail: TraceStep[] = []
  private dropped = 0
  private ended = false
  // The user's turn: speaking since, the loudest and quietest window, and the audio heard meanwhile.
  private speakingSince: number | null = null
  private loudest = 0
  private quietest = Infinity
  private window = { sum: 0, count: 0, ms: 0 }
  private audioSinceEdge = 0
  private toldSilence = false

  constructor(name: string, now = Date.now(), noun = 'call') {
    this.name = name
    this.noun = noun
    this.startedAt = now
  }

  get steps(): TraceStep[] {
    return this.dropped ? [...this.head, { at: this.tail[0]?.at ?? 0, text: `… ${this.dropped} steps left out …` }, ...this.tail] : [...this.head, ...this.tail]
  }

  get isEnded() {
    return this.ended
  }

  step(text: string, now = Date.now()) {
    if (this.ended) return
    const step = { at: now - this.startedAt, text }
    if (this.head.length < HEAD_STEPS) this.head.push(step)
    else {
      this.tail.push(step)
      if (this.head.length + this.tail.length > MAX_STEPS) {
        this.tail.shift()
        this.dropped += 1
      }
    }
    changed()
  }

  /** The server heard the user start speaking. */
  speechStarted(now = Date.now()) {
    this.speakingSince = now
    this.loudest = 0
    this.quietest = Infinity
    this.audioSinceEdge = 0
    this.toldSilence = false
    this.step('Speech started (server)', now)
  }

  /** The server heard the user stop: with the microphone's loudest and quietest 100 ms between. */
  speechStopped(now = Date.now()) {
    const since = this.speakingSince
    this.speakingSince = null
    this.audioSinceEdge = 0
    this.toldSilence = false
    const levels = since !== null && this.loudest > 0 ? `, mic ${dbfs(this.loudest)} loudest, ${dbfs(this.quietest)} quietest` : ''
    const length = since !== null ? ` after ${((now - since) / 1000).toFixed(1)} s` : ''
    this.step(`Speech stopped (server)${length}${levels}`, now)
  }

  /** Microphone audio as it's sent: levels for the turn, and a note once 15 s pass with no start or no end. */
  audio(samples: ArrayLike<number>, sampleRate: number, now = Date.now()) {
    if (this.ended || !samples.length) return
    const ms = (samples.length / sampleRate) * 1000
    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!
    this.window.sum += sum
    this.window.count += samples.length
    this.window.ms += ms
    if (this.window.ms >= LEVEL_WINDOW_MS) {
      const rms = Math.sqrt(this.window.sum / this.window.count)
      this.window = { sum: 0, count: 0, ms: 0 }
      if (this.speakingSince !== null) {
        this.loudest = Math.max(this.loudest, rms)
        this.quietest = Math.min(this.quietest, rms)
      }
    }
    this.audioSinceEdge += ms
    if (!this.toldSilence && this.audioSinceEdge >= SILENT_TURN_MS) {
      this.toldSilence = true
      this.step(this.speakingSince !== null ? 'No end of speech after 15 s of audio' : 'No start of speech after 15 s of audio', now)
    }
  }

  end(reason: string, now = Date.now()) {
    if (this.ended) return
    this.step(`Ended: ${reason}`, now)
    this.ended = true
    changed()
  }

  /** The trace as text to paste into an issue. */
  report(): string {
    const started = new Date(this.startedAt)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC')
    const lines = this.steps.map(step => `+${(step.at / 1000).toFixed(1)}s ${step.text}`)
    return [`${this.name} ${this.noun}, started ${started}`, ...lines].join('\n')
  }
}

let last: CallTrace | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(listener => listener())

/** Starts the trace of a new call; it replaces the last one. */
export function startCallTrace(name: string): CallTrace {
  last?.end('another call started')
  last = new CallTrace(name)
  changed()
  return last
}

export const lastCallTrace = () => last

let lastReading: CallTrace | null = null

/**
 * Starts the trace of a Read Aloud reading, after the phone's (issue 1641):
 * how Hermes' voice answered and how playback went, never the reply's words.
 * It replaces the last reading's and stays apart from the calls'.
 */
export function startReadingTrace(first: string): CallTrace {
  lastReading?.end('another reading started')
  lastReading = new CallTrace('Read Aloud', Date.now(), 'reading')
  lastReading.step(first)
  return lastReading
}

export const lastReadingTrace = () => lastReading

export function subscribeCallTrace(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The microphone a call opened, by its route and processing: no audio. */
export function micStep(stream: MediaStream): string {
  const track = stream.getAudioTracks()[0]
  if (!track) return 'Microphone opened (no audio track)'
  const settings = track.getSettings()
  const on = (value: unknown) => (typeof value !== 'boolean' ? '?' : value ? 'on' : 'off')
  return `Microphone opened: ${track.label || 'default'} (echo cancellation ${on(settings.echoCancellation)}, noise suppression ${on(settings.noiseSuppression)}${settings.sampleRate ? `, ${settings.sampleRate} Hz` : ''})`
}
