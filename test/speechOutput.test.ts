import { describe, expect, it } from 'vitest'
import { chooseVoice, computerVoicePick, setComputerVoicePick, setSpeechOutput, speechOutput, voicesFor } from '../src/renderer/src/state/speechOutput'

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

const voice = (name: string, lang: string, isDefault = false) => ({ voiceURI: `uri:${name}`, name, lang, default: isDefault })

describe("this computer's voice", () => {
  const voices = [voice('Thomas', 'fr-FR'), voice('Daniel', 'en-GB'), voice('Samantha', 'en-US', true), voice('Alex', 'en-US'), voice('Karen', 'en_AU')]

  it("lists the app language's voices, the exact region first, each by name", () => {
    expect(voicesFor(voices, 'en-US').map(v => v.name)).toEqual(['Alex', 'Samantha', 'Daniel', 'Karen'])
    expect(voicesFor(voices, 'de')).toEqual([])
  })

  it("speaks with the pick while it's installed, else the system's default for the language", () => {
    expect(chooseVoice(voices, 'en-US', 'uri:Daniel')?.name).toBe('Daniel')
    expect(chooseVoice(voices, 'en-US', 'uri:Gone')?.name).toBe('Samantha')
    expect(chooseVoice(voices, 'en-US', '')?.name).toBe('Samantha')
    expect(chooseVoice(voices, 'fr', '')?.name).toBe('Thomas')
    // A pick in another language is never used for this one.
    expect(chooseVoice(voices, 'fr', 'uri:Daniel')?.name).toBe('Thomas')
    expect(chooseVoice(voices, 'de', '')).toBeNull()
    // A region spelled with an underscore is still the exact one.
    expect(chooseVoice([voice('Lee', 'en_AU', true), voice('Daniel', 'en-GB', true)], 'en-AU', '')?.name).toBe('Lee')
  })

  it('keeps one pick per language on this computer, and automatic clears it', () => {
    const storage = memory()
    expect(computerVoicePick('en-US', storage)).toBe('')
    setComputerVoicePick('en-US', 'uri:Daniel', storage)
    setComputerVoicePick('fr', 'uri:Thomas', storage)
    expect(computerVoicePick('en-GB', storage)).toBe('uri:Daniel')
    expect(computerVoicePick('fr-CA', storage)).toBe('uri:Thomas')
    setComputerVoicePick('en', '', storage)
    expect(computerVoicePick('en', storage)).toBe('')
    expect(computerVoicePick('fr', storage)).toBe('uri:Thomas')
  })
})
