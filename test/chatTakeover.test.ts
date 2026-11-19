import { describe, expect, it } from 'vitest'
import {
  isSessionNotOwned,
  owner,
  refusalDetails,
  runTakeover,
  stillReplyingMessage,
  takeoverAnswer,
  heldHereMessage
} from '../src/renderer/src/state/chatTakeover'

const clock = () => {
  let at = 0
  return { now: () => at, sleep: async (ms: number) => void (at += ms) }
}
const failure = (code?: number, message = 'failed') => Object.assign(new Error(message), { code })

describe('chat takeover', () => {
  it('reads who holds the chat from the refusal', () => {
    expect(refusalDetails('Session is open elsewhere. Details: session 20261119_x opened by desktop 5m ago.')).toEqual({
      sessionId: '20261119_x',
      surface: 'desktop'
    })
    expect(refusalDetails('Details: session abc')).toEqual({ sessionId: 'abc' })
    expect(refusalDetails('no details')).toEqual({})
    expect([owner('desktop'), owner('cli'), owner('tui'), owner('bot'), owner('gateway'), owner(undefined)]).toEqual([
      'desktop',
      'terminal',
      'terminal',
      'otherBot',
      'otherWindow',
      'otherWindow'
    ])
    expect(isSessionNotOwned({ reason: 'SESSION_NOT_OWNED' })).toBe(true)
    expect(isSessionNotOwned(failure(4090))).toBe(false)
  })

  it("maps the route's answers", () => {
    expect(takeoverAnswer({ ok: true, status: 'taken_over', surface: 'desktop' })).toEqual({ kind: 'ready' })
    expect(takeoverAnswer({ status: 'free' })).toEqual({ kind: 'ready' })
    expect(takeoverAnswer({ status: 'busy', surface: 'bot' })).toEqual({ kind: 'busy', surface: 'bot' })
    expect(takeoverAnswer({ status: 'same_host' })).toEqual({ kind: 'sameHost' })
    expect(() => takeoverAnswer({ status: 'what' })).toThrow()
  })

  it('asks again while the other app replies, then sends', async () => {
    const answers = [{ status: 'busy', surface: 'cli' }, { status: 'busy' }, { status: 'taken_over' }]
    const owners: string[] = []
    const c = clock()
    const end = await runTakeover(async () => answers.shift(), { ...c, onOwner: s => owners.push(s) })
    expect(end).toEqual({ kind: 'ready' })
    expect(owners).toEqual(['cli'])
    expect(c.now()).toBe(6000)
  })

  it('says the other app is still replying past the wait, naming it', async () => {
    const c = clock()
    const end = await runTakeover(async () => ({ status: 'busy' }), { ...c, surface: 'desktop', waitMs: 20_000 })
    expect(end).toEqual({ kind: 'failed', message: stillReplyingMessage('desktop') })
  })

  it("says this dashboard's own claim holds it, and gives up on a missing route at once", async () => {
    expect(await runTakeover(async () => ({ status: 'same_host' }), clock())).toEqual({ kind: 'failed', message: heldHereMessage() })
    let asked = 0
    const end = await runTakeover(async () => {
      asked++
      throw failure(404)
    }, clock())
    expect(asked).toBe(1)
    expect(end?.kind).toBe('failed')
  })

  it('rides out a few dropped connections, and stops when the chat changes', async () => {
    let asked = 0
    const end = await runTakeover(async () => (++asked < 3 ? Promise.reject(failure(502)) : { status: 'free' }), clock())
    expect(end).toEqual({ kind: 'ready' })
    let open = true
    const left = await runTakeover(
      async () => {
        open = false
        return { status: 'busy' }
      },
      { ...clock(), keepWaiting: () => open }
    )
    expect(left).toBeNull()
  })
})

describe('a refused message taken back', () => {
  it('leaves the transcript, since its words went back to the composer', async () => {
    const { addPendingUser, withdrawPendingUser, emptyTranscript } = await import('../src/renderer/src/state/transcript')
    const state = addPendingUser(addPendingUser(emptyTranscript, 'first', []), 'second', [])
    const kept = withdrawPendingUser(state)
    expect(kept.items.length).toBe(state.items.length - 1)
    expect(JSON.stringify(kept.items)).toContain('first')
    expect(JSON.stringify(kept.items)).not.toContain('second')
  })
})
