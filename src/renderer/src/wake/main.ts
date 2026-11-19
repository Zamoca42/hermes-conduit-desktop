/**
 * The wake listener (hidden window): Vosk, offline, on the microphone,
 * matching what it hears against the phrases with the phone's rules.
 * Audio goes only to the recognizer in this window; nothing is kept.
 */
import { createModel } from 'vosk-browser'
import { matchWakePhrase } from '../../../shared/wakePhrase'

type Report = { kind: 'heard'; index: number } | { kind: 'listening' } | { kind: 'failed'; error: string }
declare global {
  interface Window {
    wakeHost: {
      model(): Promise<ArrayBuffer>
      onPhrases(listener: (phrases: string[]) => void): () => void
      report(report: Report): void
    }
  }
}

/** After a phrase is heard, the same words aren't heard again for a moment. */
const QUIET_MS = 3000

let phrases: string[] = []
window.wakeHost.onPhrases(next => {
  phrases = next
})

async function start() {
  const bytes = await window.wakeHost.model()
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }))
  const model = await createModel(url, -1)
  URL.revokeObjectURL(url)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
  const context = new AudioContext()
  const recognizer = new model.KaldiRecognizer(context.sampleRate)
  let quietUntil = 0
  const hear = (text: string) => {
    if (!text || Date.now() < quietUntil) return
    const index = matchWakePhrase(text, phrases)
    if (index < 0) return
    quietUntil = Date.now() + QUIET_MS
    recognizer.retrieveFinalResult()
    window.wakeHost.report({ kind: 'heard', index })
  }
  recognizer.on('partialresult', message => hear((message as { result: { partial: string } }).result.partial))
  recognizer.on('result', message => hear((message as { result: { text: string } }).result.text))
  const source = context.createMediaStreamSource(stream)
  // A ScriptProcessor runs only when connected to the output: through a silent gain, so nothing plays.
  const processor = context.createScriptProcessor(4096, 1, 1)
  const silent = context.createGain()
  silent.gain.value = 0
  processor.onaudioprocess = event => {
    try {
      recognizer.acceptWaveform(event.inputBuffer)
    } catch {
      // A dropped buffer: the next one goes on.
    }
  }
  source.connect(processor)
  processor.connect(silent)
  silent.connect(context.destination)
  window.wakeHost.report({ kind: 'listening' })
}

start().catch(e => window.wakeHost.report({ kind: 'failed', error: e instanceof Error ? e.message : String(e) }))
