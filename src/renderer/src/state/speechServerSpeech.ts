/**
 * Read Aloud and Classic voice's replies spoken by the user's own speech
 * server (Hugging Face speech-to-speech, the one Local Live talks to), after
 * the phone's SpeechServerSpeechStream. Conduit reaches it only through the
 * plugin's relay (`/local-live/socket?mode=speak`).
 *
 * A speech-to-speech server only speaks what its model address answers.
 * With that address set to the plugin's Local Live route, a speak socket's
 * turns are read back unchanged: each sentence goes out as a user item plus
 * `response.create`, and the server says exactly those words in its own
 * voice, one response at a time, in order. Turn detection stays on with
 * `create_response: false`, and no audio is ever sent, so the server never
 * answers on its own.
 *
 * A server still pointed at another model would answer the reply instead of
 * reading it, so each response's transcript is checked against the words
 * sent. The first mismatch fails the reading, and it goes to this computer's
 * voice instead.
 */
import { t } from '../../../shared/i18n'
import { dashboardProfileQuery } from './dashboardProfile'
import { computerCanSpeak, speakOnComputer } from './speechOutput'

export const SPEAK_SOCKET_PATH = '/api/plugins/conduit_push/local-live/socket'
/** The OpenAI Realtime output rate. */
export const SPEAK_SAMPLE_RATE = 24_000
/** A sentence this long is sent without waiting for its end. */
export const MAX_CHUNK = 280
const IDLE_MS = 20_000

type Row = Record<string, unknown>

/** Audio out only; the input side keeps the server's turn detector quiet. */
export function speakSessionUpdate(): Row {
  const format = { type: 'audio/pcm', rate: SPEAK_SAMPLE_RATE }
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: ['audio'],
      audio: {
        input: { format, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false } },
        output: { format }
      }
    }
  }
}

export function speakUserItem(text: string): Row {
  return { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }
}

/**
 * The reply as the sentences to send, one a response: a sentence ends at
 * 。！？ or a line break, or at . ! ? … followed by whitespace (so "3.5"
 * stays whole); a very long one is cut at its last space, or anywhere in text
 * without spaces.
 */
export function speakSentences(text: string): string[] {
  const out: string[] = []
  let rest = text
  while (rest) {
    let cut = -1
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i]!
      if (c === '\n' || c === '\r' || '。！？'.includes(c)) {
        cut = i + 1
        break
      }
      if ('.!?…'.includes(c) && i + 1 < rest.length && /\s/.test(rest[i + 1]!)) {
        cut = i + 1
        break
      }
    }
    if (cut < 0 && rest.length > MAX_CHUNK) {
      const space = rest.lastIndexOf(' ', MAX_CHUNK - 1)
      cut = space > 0 ? space : MAX_CHUNK
    }
    if (cut < 0) cut = rest.length
    const sentence = rest.slice(0, cut).trim()
    // Punctuation or emoji alone has nothing to read back or check.
    if (comparable(sentence)) out.push(sentence)
    rest = rest.slice(cut)
  }
  return out
}

/** Letters and digits only, lowercased and without accents: how the server's transcript is compared with the words sent. */
export function comparable(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** Whether `transcript`, so far, is the server reading `words`: the start of them, with nothing of its own added. */
export function isReadingBack(transcript: string, words: string): boolean {
  return comparable(words).startsWith(comparable(transcript))
}

export interface SpeakSocket {
  send(text: string): void
  close(): void
}

/**
 * One reply's reading over a speak socket: `opened` once the socket is up,
 * `frame` for each text frame and `audio` for each binary one. `done`
 * settles when the last sentence has been spoken, rejecting with why the
 * server couldn't.
 */
export class SpeechServerReading {
  readonly done: Promise<void>
  private resolve!: () => void
  private reject!: (e: Error) => void
  private queued: string[]
  private speaking: string | null = null
  private transcript = ''
  private hadAudio = false
  private over = false
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(
    text: string,
    private socket: SpeakSocket,
    private onPcm: (pcm: Int16Array) => void
  ) {
    this.queued = speakSentences(text)
    this.done = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    // The rejection is the caller's to read; never an unhandled one.
    this.done.catch(() => undefined)
    if (!this.queued.length) this.finish()
  }

  opened(): void {
    if (this.over) return
    this.send(speakSessionUpdate())
    this.next()
    this.armIdle()
  }

  frame(text: string): void {
    if (this.over) return
    let o: Row
    try {
      o = JSON.parse(text) as Row
    } catch {
      return
    }
    this.armIdle()
    switch (o.type) {
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        if (typeof o.delta === 'string') this.pcm(decodePcm(o.delta))
        return
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (typeof o.delta !== 'string' || this.speaking === null) return
        this.transcript += o.delta
        if (!isReadingBack(this.transcript, this.speaking)) this.notReadingBack()
        return
      case 'response.done':
        return this.responseDone()
      case 'error': {
        const e = (o.error ?? {}) as Row
        const message = typeof e.message === 'string' ? e.message : typeof o.message === 'string' ? o.message : ''
        return this.fail(message || t("Your speech server couldn't speak the reply."))
      }
    }
  }

  audio(bytes: Uint8Array): void {
    if (this.over || bytes.byteLength < 2) return
    this.armIdle()
    const copy = bytes.slice(0, bytes.byteLength - (bytes.byteLength % 2))
    this.pcm(new Int16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2))
  }

  /** The socket closed: fine once everything was spoken, a failure before. */
  closed(reason: string): void {
    if (this.over) return
    this.fail(reason || t('Your speech server stopped speaking.'))
  }

  stop(): void {
    if (this.over) return
    if (this.speaking !== null) this.send({ type: 'response.cancel' })
    this.end()
    this.resolve()
  }

  private pcm(samples: Int16Array): void {
    if (!samples.length) return
    this.hadAudio = true
    this.onPcm(samples)
  }

  private next(): void {
    if (this.over || this.speaking !== null) return
    const words = this.queued.shift()
    if (words === undefined) return this.finish()
    this.speaking = words
    this.transcript = ''
    this.hadAudio = false
    this.send(speakUserItem(words))
    this.send({ type: 'response.create' })
  }

  /** Each response must voice its whole sentence: a silent one fails, and so does one whose transcript isn't exactly the words sent. */
  private responseDone(): void {
    if (this.speaking !== null) {
      if (!this.hadAudio) return this.fail(t("Your speech server couldn't speak the reply."))
      if (comparable(this.transcript) !== comparable(this.speaking)) return this.notReadingBack()
    }
    this.speaking = null
    this.next()
  }

  private notReadingBack(): void {
    this.send({ type: 'response.cancel' })
    this.fail(t('Your speech server answered instead of reading the reply. Set its model address to the one in Local Live’s settings.'))
  }

  private finish(): void {
    if (this.over) return
    this.end()
    this.resolve()
  }

  private fail(message: string): void {
    if (this.over) return
    this.end()
    this.reject(new Error(message))
  }

  private end(): void {
    this.over = true
    clearTimeout(this.idle)
    // One socket per reply: the relay frees the server's pipeline.
    this.socket.close()
  }

  private armIdle(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.fail(t('Your speech server stopped speaking.')), IDLE_MS)
  }

  private send(row: Row): void {
    this.socket.send(JSON.stringify(row))
  }
}

function decodePcm(base64: string): Int16Array {
  try {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length - (raw.length % 2))
    for (let i = 0; i < bytes.length; i++) bytes[i] = raw.charCodeAt(i)
    return new Int16Array(bytes.buffer)
  } catch {
    return new Int16Array(0)
  }
}

/**
 * Speaks `text` through the profile's speech server, as speakOnComputer
 * speaks with this computer's: `done` settles when it ends, rejecting with
 * why the server couldn't; `stop` ends it at once.
 */
export function speakWithSpeechServer(text: string, profile?: string): { done: Promise<void>; stop: () => void } {
  const ctx = new AudioContext({ sampleRate: SPEAK_SAMPLE_RATE })
  let playUntil = 0
  let lastEnds: Promise<void> = Promise.resolve()
  let id: string | null = null
  let closing = false
  const reading = new SpeechServerReading(
    text,
    {
      send: data => id && window.conduit.liveSend(id, data),
      close: () => {
        closing = true
        if (id) window.conduit.liveClose(id)
      }
    },
    samples => {
      const floats = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i++) floats[i] = samples[i]! / 32768
      const buffer = ctx.createBuffer(1, floats.length, SPEAK_SAMPLE_RATE)
      buffer.copyToChannel(floats, 0)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      const at = Math.max(ctx.currentTime + 0.02, playUntil)
      source.start(at)
      playUntil = at + buffer.duration
      lastEnds = new Promise(resolve => (source.onended = () => resolve()))
    }
  )
  // The open may come before liveOpen answers with the socket's id.
  let openedEarly: string | null = null
  const stopListening = window.conduit.onLive(event => {
    if (id === null && event.type === 'open') openedEarly = event.id
    if (event.id !== id) return
    if (event.type === 'open') reading.opened()
    else if (event.type === 'message') reading.frame(event.data)
    else if (event.type === 'binary') reading.audio(event.data)
    else if (event.type === 'close' && !closing) reading.closed(event.reason.trim())
  })
  void window.conduit.liveOpen(SPEAK_SOCKET_PATH, { ...dashboardProfileQuery(profile), mode: 'speak' }).then(opened => {
    if (!opened.ok) return reading.closed(/\b404\b/.test(opened.error) ? t('Your speech server isn’t set up on Hermes.') : t('Could not open the speech stream.'))
    if (closing) return window.conduit.liveClose(opened.id)
    id = opened.id
    if (openedEarly === id) reading.opened()
  })
  let stopped = false
  // Spoken once the server is done and the last of its audio has played.
  const done = reading.done
    .then(() => (stopped ? undefined : lastEnds))
    .finally(() => {
      stopListening()
      void ctx.close().catch(() => undefined)
    })
  return {
    done,
    stop: () => {
      stopped = true
      reading.stop()
      void ctx.close().catch(() => undefined)
    }
  }
}

/**
 * Speaks with this computer's voice or the speech server, as the profile
 * picked. A speech server that can't speak the reply hands it to this
 * computer's voice, as the phone hands it to the iPhone's; `note` hears why.
 */
export function speakHere(
  text: string,
  output: 'computer' | 'server',
  profile?: string,
  note: (step: string) => void = () => undefined
): { done: Promise<void>; stop: () => void } {
  if (output === 'computer') return speakOnComputer(text)
  let stopped = false
  let current = speakWithSpeechServer(text, profile)
  const done = current.done.catch((e: unknown) => {
    if (stopped || !computerCanSpeak()) throw e
    note(`Speech server failed (${e instanceof Error ? e.message : 'error'}); speaking with this computer’s voice`)
    current = speakOnComputer(text)
    return current.done
  })
  return {
    done,
    stop: () => {
      stopped = true
      current.stop()
    }
  }
}
