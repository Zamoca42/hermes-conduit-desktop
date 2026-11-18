import { beforeEach, describe, expect, it, vi } from 'vitest'
import { company, consentKey, consented, setConsented } from '../src/renderer/src/state/consent'

describe('provider consent', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    })
  })

  it('asks once per provider, under the phone keys, and takes it back', () => {
    expect(consented('classic')).toBe(true)
    expect(consented('local')).toBe(true)
    expect(consented('gemini')).toBe(false)
    setConsented('gemini', true)
    expect(consented('gemini')).toBe(true)
    expect(consented('qwen')).toBe(false)
    expect(consentKey('qwen')).toBe('conduit.liveVoiceProviderConsent.qwen-live')
    setConsented('gemini', false)
    expect(consented('gemini')).toBe(false)
    expect([company('gemini'), company('qwen'), company('gpt'), company('grok')]).toEqual(['Google', 'Alibaba Cloud', 'OpenAI', 'xAI'])
  })
})
