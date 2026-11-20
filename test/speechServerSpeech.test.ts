import { describe, expect, it } from 'vitest'
import { SpeechServerReading, comparable, isReadingBack, speakSentences, speakSessionUpdate } from '../src/renderer/src/state/speechServerSpeech'

function reading(text: string) {
  const sent: Record<string, any>[] = []
  let closed = 0
  const pcm: number[] = []
  const r = new SpeechServerReading(text, { send: s => sent.push(JSON.parse(s)), close: () => closed++ }, samples => pcm.push(samples.length))
  return { r, sent, pcm, closed: () => closed }
}
const audio = (bytes = 4) => JSON.stringify({ type: 'response.output_audio.delta', delta: btoa('\0'.repeat(bytes)) })
const said = (delta: string) => JSON.stringify({ type: 'response.output_audio_transcript.delta', delta })
const done = JSON.stringify({ type: 'response.done' })

describe('Read Aloud on your speech server', () => {
  it('sends one sentence a response, keeping numbers whole and cutting long runs at a space', () => {
    expect(speakSentences('It is 3.5 degrees. Nice! Ok？Yes\nno')).toEqual(['It is 3.5 degrees.', 'Nice!', 'Ok？', 'Yes', 'no'])
    expect(speakSentences('… 🙂 . Hi')).toEqual(['Hi'])
    const long = speakSentences(`${'word '.repeat(70)}end`)
    expect(long.length).toBe(2)
    expect(long[0]!.length).toBeLessThanOrEqual(280)
  })

  it('compares letters and digits only, ignoring case and accents', () => {
    expect(comparable('Café, 3 Ölçü!')).toBe('cafe3olcu')
    expect(isReadingBack('hello, wor', 'Hello, world.')).toBe(true)
    expect(isReadingBack('Sure! Hello', 'Hello, world.')).toBe(false)
  })

  it('asks for audio only, with turn detection that never answers', () => {
    const session = speakSessionUpdate().session as any
    expect(session.output_modalities).toEqual(['audio'])
    expect(session.audio.input.turn_detection.create_response).toBe(false)
  })

  it('reads each sentence back in order and finishes when the last is spoken', async () => {
    const { r, sent, pcm, closed } = reading('First one. Second one.')
    r.opened()
    expect(sent.map(s => s.type)).toEqual(['session.update', 'conversation.item.create', 'response.create'])
    expect(sent[1]!.item.content[0].text).toBe('First one.')
    r.frame(audio())
    r.frame(said('First one.'))
    r.frame(done)
    expect(sent[3]!.item.content[0].text).toBe('Second one.')
    r.frame(audio())
    r.frame(said('Second one'))
    r.frame(done)
    await expect(r.done).resolves.toBeUndefined()
    expect(pcm).toEqual([2, 2])
    expect(closed()).toBe(1)
  })

  it('fails when the server answers instead of reading, cancelling its response', async () => {
    const { r, sent } = reading('Hello there.')
    r.opened()
    r.frame(audio())
    r.frame(said('Sure, I can help'))
    await expect(r.done).rejects.toThrow(/answered instead of reading/)
    expect(sent.at(-1)!.type).toBe('response.cancel')
  })

  it('fails on a silent response, a server error or a close before the end', async () => {
    const silent = reading('Hello.')
    silent.r.opened()
    silent.r.frame(done)
    await expect(silent.r.done).rejects.toThrow(/couldn't speak/)
    const error = reading('Hello.')
    error.r.opened()
    error.r.frame(JSON.stringify({ type: 'error', error: { message: 'pipeline busy' } }))
    await expect(error.r.done).rejects.toThrow('pipeline busy')
    const closed = reading('Hello.')
    closed.r.opened()
    closed.r.closed('')
    await expect(closed.r.done).rejects.toThrow(/stopped speaking/)
  })

  it('stops at once, settling as ended', async () => {
    const { r, sent } = reading('Hello.')
    r.opened()
    r.stop()
    await expect(r.done).resolves.toBeUndefined()
    expect(sent.at(-1)!.type).toBe('response.cancel')
  })

  it('takes binary frames as audio too', () => {
    const { r, pcm } = reading('Hello.')
    r.opened()
    r.audio(new Uint8Array(5))
    expect(pcm).toEqual([2])
  })
})
