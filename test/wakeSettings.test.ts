import { describe, expect, it } from 'vitest'
import { modelLangFor, setWakeProfile, wakeBindings, wakeChat, wakeProfiles } from '../src/renderer/src/state/wakeSettings'

function memory() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

describe('wake phrase settings', () => {
  it('keeps each dashboard’s profiles their own phrases, new conversation on by default', () => {
    const storage = memory()
    setWakeProfile('http://a', 'default', { phrases: [' Hey Hermes ', ''], fresh: true }, storage)
    setWakeProfile('http://a', 'coder', { phrases: ['hey coder'], fresh: false }, storage)
    expect(wakeProfiles('http://a', storage)).toEqual({ default: { phrases: ['Hey Hermes'], fresh: true }, coder: { phrases: ['hey coder'], fresh: false } })
    expect(wakeProfiles('http://b', storage)).toEqual({})
    setWakeProfile('http://a', 'coder', null, storage)
    expect(Object.keys(wakeProfiles('http://a', storage))).toEqual(['default'])
  })

  it('listens for usable phrases of profiles that still exist', () => {
    const bindings = wakeBindings(
      { gone: { phrases: ['hey gone'], fresh: true }, default: { phrases: ['hey hermes', 'hermes'], fresh: false } },
      ['default']
    )
    expect(bindings).toEqual([{ profile: 'default', phrase: 'hey hermes', fresh: false }])
  })

  it('picks the model language for Conduit’s language', () => {
    const choices = ['en-us', 'de', 'cn', 'pt', 'ja'].map(lang => ({ lang, name: `vosk-model-small-${lang}`, label: lang }))
    expect(modelLangFor('en', choices)).toBe('en-us')
    expect(modelLangFor('zh-Hant', choices)).toBe('cn')
    expect(modelLangFor('pt-BR', choices)).toBe('pt')
    expect(modelLangFor('de', choices)).toBe('de')
    expect(modelLangFor('id', choices)).toBeNull()
  })

  it('continues the open chat of that profile, else its newest', () => {
    const rows = [
      { id: 'old', profile: 'coder', activeAt: 1 },
      { id: 'new', profile: 'coder', activeAt: 5 },
      { id: 'main', activeAt: 9 }
    ]
    expect(wakeChat('coder', { id: 'old', profile: 'coder' }, rows)).toBe('old')
    expect(wakeChat('coder', { id: 'main' }, rows)).toBe('new')
    expect(wakeChat('default', { id: null }, rows)).toBe('main')
    expect(wakeChat('writer', { id: null }, rows)).toBeNull()
  })
})
