import { beforeEach, describe, expect, it, vi } from 'vitest'
import { livePreview } from '../src/renderer/src/state/livePreview'
import { setLiveGreeting } from '../src/renderer/src/state/liveGreeting'
import { setLiveInstructions } from '../src/renderer/src/state/liveStyle'
import { setLiveAsksFirst } from '../src/renderer/src/state/askFirst'
import { lastGptLiveDialect, rememberGptLiveDialect, setGptLiveBilling } from '../src/renderer/src/state/gptLive'

describe("Live call style's What Conduit sends", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k)
    })
  })

  it('shows nothing for Classic', () => {
    expect(livePreview('classic')).toBeNull()
  })

  it("is the call's own instructions, with the user's style, asking first and the greeting turn", () => {
    setLiveInstructions('Call me Captain.')
    setLiveAsksFirst(true)
    setLiveGreeting('Ahoy')
    for (const mode of ['gpt', 'gemini', 'qwen', 'grok'] as const) {
      const preview = livePreview(mode)
      expect(preview?.instructions).toContain('Call me Captain.')
      expect(preview?.instructions).toContain('Asking first is on for this call')
      expect(preview?.openingTurn).toContain('Say: "Ahoy"')
      expect(preview?.isLocalLive).toBe(false)
    }
    expect(livePreview('gpt')?.mode).toBe('GPT-Live')
  })

  it("shows Conduit's own tools leading each mode's rules", () => {
    for (const mode of ['gpt', 'gemini', 'qwen', 'grok'] as const) {
      expect(livePreview(mode)?.instructions).toContain("Conduit's own tools")
    }
    localStorage.setItem('conduit.localLiveAgent', 'true')
    expect(livePreview('local', { fastModel: true })?.instructions).toContain("Conduit's own tools")
  })

  it("leaves the read rules out of an API-key GPT-Live call's preview, as the call does", () => {
    setGptLiveBilling('api')
    expect(livePreview('gpt')?.instructions).not.toContain("Conduit's own tools")
  })

  it("leaves the read rules out where the host last answered a ChatGPT-plan call with GA events (desktop#363)", () => {
    const host = 'https://home.example'
    expect(livePreview('gpt', { dialect: lastGptLiveDialect(host) })?.instructions).toContain("Conduit's own tools")
    rememberGptLiveDialect(host, 'subscription', 'ga')
    expect(lastGptLiveDialect(host)).toBe('ga')
    expect(livePreview('gpt', { dialect: lastGptLiveDialect(host) })?.instructions).not.toContain("Conduit's own tools")
    // Another host, and a host that answers with the frameless events again, get them.
    expect(lastGptLiveDialect('https://other.example')).toBeUndefined()
    rememberGptLiveDialect(host, 'subscription', 'frameless')
    expect(livePreview('gpt', { dialect: lastGptLiveDialect(host) })?.instructions).toContain("Conduit's own tools")
    // An API-key call is always GA and says nothing about the plan's events.
    rememberGptLiveDialect(host, 'api', 'ga')
    expect(lastGptLiveDialect(host)).toBe('frameless')
  })

  it('has no greeting turn with the greeting off', () => {
    expect(livePreview('gemini')?.openingTurn).toBeNull()
  })

  it("is Local Live's agent instructions only in agent mode with the host's fast model, and its greeting is what the server says", () => {
    // Hermes answering each turn: no instructions, but the greeting is still said (desktop#340).
    setLiveGreeting('Ahoy')
    expect(livePreview('local')).toMatchObject({ isLocalLive: true, instructions: null, openingTurn: 'Ahoy' })
    setLiveGreeting(null)
    expect(livePreview('local')).toMatchObject({ instructions: null, openingTurn: null })
    localStorage.setItem('conduit.localLiveAgent', 'true')
    expect(livePreview('local', { fastModel: false })).toMatchObject({ instructions: null })
    const preview = livePreview('local', { fastModel: true })
    expect(preview?.isLocalLive).toBe(true)
    expect(preview?.mode).toBe('Local Live')
    expect(preview?.openingTurn).toBeNull()
    setLiveGreeting('')
    expect(livePreview('local', { fastModel: true })?.openingTurn).toBe("Hi, I'm listening.")
  })

  it("follows the host: its web search, and memory recall when memory is sent", () => {
    localStorage.setItem('conduit.geminiLiveMemory', 'true')
    const without = livePreview('gemini')?.instructions ?? ''
    const withHost = livePreview('gemini', { recall: true, hostSearch: true })?.instructions ?? ''
    expect(without).not.toContain('recall_memory')
    expect(withHost).toContain('recall_memory')
    expect(withHost).not.toBe(without)
  })
})
