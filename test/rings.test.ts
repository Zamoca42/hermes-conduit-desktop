import { describe, expect, it } from 'vitest'
import { freshRings, ringsFrom } from '../src/renderer/src/state/rings'

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
})
