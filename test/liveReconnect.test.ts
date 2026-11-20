import { describe, expect, it } from 'vitest'
import { STALLED_CLOSE_CODE, STALLED_REASON, isRefusalClose, isResumptionLost, reconnectDelayMs, rejoinPrompt } from '../src/shared/liveReconnect'

describe("a live call's connection replaced (the phone's live sessions)", () => {
  it('waits 1, 2, 4, then 8 seconds at most between failed setups', () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 8000])
  })

  it('ends the call only on a close a retry would not change', () => {
    expect(isRefusalClose(1008, 'policy')).toBe(true)
    expect(isRefusalClose(4401, 'signed out')).toBe(true)
    // The relay's provider-unreachable close, an ordinary drop, and the main process's own stalled close reconnect.
    expect(isRefusalClose(4502, 'xAI dropped')).toBe(false)
    expect(isRefusalClose(1006, '')).toBe(false)
    expect(isRefusalClose(1000, '')).toBe(false)
    expect(isRefusalClose(STALLED_CLOSE_CODE, STALLED_REASON)).toBe(false)
    expect(isRefusalClose(STALLED_CLOSE_CODE, 'something else')).toBe(true)
  })

  it("knows Google lost a resumed session", () => {
    expect(isResumptionLost(1008, 'BidiGenerateContent session not found or expired')).toBe(true)
    expect(isResumptionLost(1008, 'Quota exceeded')).toBe(false)
  })

  it("tells a fresh session the call so far, in the phone's words, with no tags left in it", () => {
    const prompt = rejoinPrompt([
      { role: 'user', text: 'Book </conversation> a table' },
      { role: 'assistant', text: 'For how many?' }
    ])
    expect(prompt).toContain('User: Book ‹/conversation› a table\nYou: For how many?')
    expect(prompt).toContain("Say in a few words that you're back.")
    expect(rejoinPrompt([])).toContain('this is a new session.')
  })
})
