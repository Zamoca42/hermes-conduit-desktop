import { describe, expect, it } from 'vitest'
import { declineBody, freshRings, ringChanges, ringsFrom } from '../src/renderer/src/state/rings'

describe('calls from Hermes on this computer', () => {
  const body = {
    ok: true,
    now: 1000,
    rings: [
      { id: 'watch_old', kind: 'done', name: 'Atlas', heading: 'Atlas wants to talk', body: 'Old', session_ids: ['s0'], at: 900 },
      {
        id: 'watch_new',
        kind: 'done',
        name: 'Atlas',
        heading: 'Atlas wants to talk',
        body: 'It shipped.',
        reason: '',
        title: 'Deploy',
        session_ids: ['rt', 'st'],
        at: 990
      },
      { id: '', at: 999 },
      { id: 'watch_noat' }
    ]
  }

  it('reads the host’s rings and its clock', () => {
    const { rings, now } = ringsFrom(body, 'work')
    expect(now).toBe(1000)
    expect(rings.map(r => r.id)).toEqual(['watch_old', 'watch_new'])
    expect(rings[1]).toMatchObject({ profile: 'work', name: 'Atlas', body: 'It shipped.', sessionIds: ['rt', 'st'], title: 'Deploy' })
  })

  it('rings only for calls that just went out when it first asks', () => {
    const { rings, now } = ringsFrom(body)
    expect(freshRings(rings, now).map(r => r.id)).toEqual(['watch_new'])
    expect(freshRings(rings, null)).toEqual([])
  })

  it('stops a ring settled on another device and starts only new ringing ones', () => {
    const { rings } = ringsFrom({
      now: 1000,
      rings: [
        { id: 'watch_a', session_ids: ['s1'], at: 990, state: 'answered' },
        { id: 'watch_b', session_ids: ['s2'], at: 995, state: 'ringing' },
        { id: 'watch_c', session_ids: ['s3'], at: 996, state: 'declined' },
        { id: 'watch_d', session_ids: ['s4'], at: 997 }
      ]
    })
    expect(rings.map(r => r.state)).toEqual(['answered', 'ringing', 'declined', 'ringing'])
    expect(ringChanges(rings, new Set(['watch_d']))).toEqual({ added: [rings[1]], settled: ['watch_a', 'watch_c'] })
    expect(freshRings(rings, 1000).map(r => r.id)).toEqual(['watch_b', 'watch_d'])
  })

  it('declines as the iPhone reports a decline', () => {
    const [ring] = ringsFrom({ now: 1, rings: [{ id: 'watch_a', kind: 'done', title: 'Deploy', reason: 'Shipped', session_ids: ['s1'], at: 1 }] }).rings
    expect(declineBody(ring)).toEqual({
      call_id: 'watch_a',
      session_ids: ['s1'],
      outcome: 'declined',
      kind: 'done',
      title: 'Deploy',
      reason: 'Shipped',
      age_s: 0
    })
  })

  it('reports a miss itself only when no iPhone is paired', () => {
    const raw = [{ id: 'watch_a', session_ids: ['s1'], at: 1 }]
    const [alone] = ringsFrom({ now: 1, paired: false, rings: raw }).rings
    expect(alone.reportsMiss).toBe(true)
    expect(declineBody(alone, 'missed')).toMatchObject({ call_id: 'watch_a', outcome: 'missed' })
    expect(ringsFrom({ now: 1, paired: true, rings: raw }).rings[0].reportsMiss).toBe(false)
    // An older plugin says nothing: its calls rang an iPhone.
    expect(ringsFrom({ now: 1, rings: raw }).rings[0].reportsMiss).toBe(false)
  })
})
