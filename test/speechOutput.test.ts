import { describe, expect, it } from 'vitest'
import { setSpeechOutput, speechOutput } from '../src/renderer/src/state/speechOutput'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

describe('the Read Aloud voice', () => {
  it("is Hermes' speech until one is picked, as before there was a choice", () => {
    expect(speechOutput(undefined, memory())).toBe('hermes')
  })

  it('is kept per profile, the default one under any spelling', () => {
    const storage = memory()
    setSpeechOutput(undefined, 'computer', storage)
    expect(speechOutput('default', storage)).toBe('computer')
    expect(speechOutput('Atlas', storage)).toBe('hermes')
    setSpeechOutput('Atlas', 'computer', storage)
    setSpeechOutput('default', 'hermes', storage)
    expect(speechOutput('atlas', storage)).toBe('computer')
    expect(speechOutput(undefined, storage)).toBe('hermes')
  })

  it('keeps the speech server, and reads anything unknown as Hermes', () => {
    const storage = memory()
    setSpeechOutput('Atlas', 'server', storage)
    expect(speechOutput('atlas', storage)).toBe('server')
    storage.setItem('conduit.speechOutput.v1', JSON.stringify({ atlas: 'robot' }))
    expect(speechOutput('atlas', storage)).toBe('hermes')
  })
})
