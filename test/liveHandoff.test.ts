import { describe, expect, it } from 'vitest'
import { LiveHandoff } from '../src/shared/liveHandoff'

const setup = () => {
  const closed: string[] = []
  return { closed, handoff: new LiveHandoff(id => closed.push(id)) }
}

describe("a Gemini Live GoAway's next connection (the phone's dropHandoff)", () => {
  it('closes a handoff still in setup when the call ends', () => {
    const { closed, handoff } = setup()
    expect(handoff.claim()).toBe(true)
    expect(handoff.accept('live-2', handoff.token())).toBe(true)
    handoff.drop()
    expect(closed).toEqual(['live-2'])
    expect(handoff.id).toBeNull()
    expect(handoff.active).toBe(false)
  })

  it('starts one handoff for two GoAways while the first one opens', () => {
    const { handoff } = setup()
    expect(handoff.claim()).toBe(true)
    expect(handoff.claim()).toBe(false)
  })

  it('closes a connection that opens after the handoff was given up', () => {
    const { closed, handoff } = setup()
    handoff.claim()
    const token = handoff.token()
    // The call hangs up, or a spent Search quota opens a connection without the handoff, while it opens.
    handoff.drop()
    expect(handoff.accept('live-4', token)).toBe(false)
    expect(closed).toEqual(['live-4'])
    expect(handoff.id).toBeNull()
  })

  it('closes a connection that opens for an older handoff after a newer one started', () => {
    const { closed, handoff } = setup()
    handoff.claim()
    const old = handoff.token()
    handoff.drop()
    handoff.claim()
    expect(handoff.accept('live-5', old)).toBe(false)
    expect(handoff.accept('live-6', handoff.token())).toBe(true)
    expect(closed).toEqual(['live-5'])
    expect(handoff.id).toBe('live-6')
  })

  it('closes the previous connection before a retry replaces it', () => {
    const { closed, handoff } = setup()
    handoff.claim()
    handoff.accept('live-7', handoff.token())
    handoff.accept('live-8', handoff.token())
    expect(closed).toEqual(['live-7'])
    expect(handoff.id).toBe('live-8')
  })

  it('hands its connection over on takeover, and the next GoAway starts a new handoff', () => {
    const { closed, handoff } = setup()
    handoff.claim()
    handoff.accept('live-9', handoff.token())
    expect(handoff.take()).toBe('live-9')
    // The call owns it now: ending the call closes it as its live connection, not as a handoff.
    handoff.drop()
    expect(closed).toEqual([])
    expect(handoff.claim()).toBe(true)
  })

  it('keeps handing off after its connection closes on its own, until it retries or is dropped', () => {
    const { closed, handoff } = setup()
    handoff.claim()
    handoff.accept('live-10', handoff.token())
    handoff.closed()
    expect(handoff.active).toBe(true)
    expect(handoff.claim()).toBe(false)
    expect(handoff.accept('live-11', handoff.token())).toBe(true)
    handoff.drop()
    expect(closed).toEqual(['live-11'])
  })
})
