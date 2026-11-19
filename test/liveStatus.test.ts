import { describe, expect, it } from 'vitest'
import { liveStates, nextStep, POLL_STEPS_MS } from '../src/renderer/src/state/liveStatus'
import { filterRows, type ChatMarks } from '../src/renderer/src/state/chatMarks'

describe('Running and Needs approval on the rows', () => {
  it('reads the registry by both ids, waiting over working, starting and idle left out', () => {
    const states = liveStates({
      sessions: [
        { id: 'rt1', session_key: 'chat1', status: 'working' },
        { id: 'rt2', session_key: 'chat2', status: 'waiting' },
        { id: 'rt3', session_key: 'chat2', status: 'working' },
        { id: 'rt4', session_key: 'chat4', status: 'starting' },
        { id: 'rt5', status: 'idle' }
      ]
    })
    expect([...states]).toEqual([
      ['rt1', 'working'],
      ['chat1', 'working'],
      ['rt2', 'waiting'],
      ['chat2', 'waiting'],
      ['rt3', 'working']
    ])
    expect(liveStates({ nope: true }).size).toBe(0)
  })

  it('reads every 4 s while a chat runs, then slower up to a minute', () => {
    let step = 0
    for (let i = 0; i < 6; i++) step = nextStep(step, false)
    expect(POLL_STEPS_MS[step]).toBe(60_000)
    expect(POLL_STEPS_MS[nextStep(step, true)]).toBe(4_000)
  })

  it('filters Running without the waiting chats, and Needs approval', () => {
    const marks: ChatMarks = { stars: [], seen: {}, baseline: 0, unread: [] }
    const rows = ['a', 'b', 'c'].map(id => ({ id, title: id, pinned: false }))
    const running = new Set(['a', 'b'])
    const waiting = new Set(['b'])
    expect(filterRows(rows, 'running', marks, running, waiting).map(r => r.id)).toEqual(['a'])
    expect(filterRows(rows, 'waiting', marks, running, waiting).map(r => r.id)).toEqual(['b'])
  })
})
