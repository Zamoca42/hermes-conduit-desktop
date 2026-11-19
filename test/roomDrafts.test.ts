import { describe, expect, it } from 'vitest'
import {
  canCreateGroup,
  canPickBot,
  canPickPerson,
  canStartNow,
  draftAgents,
  draftLine,
  draftRows,
  parseDrafts,
  personStatus,
  roomDraftsClient
} from '../src/renderer/src/state/roomDrafts'

const wire = {
  room_id: 'conduit-1',
  name: 'Weekend hike',
  status: 'waiting',
  reason: null,
  expires_at: 1795703316,
  agents: [{ profile: 'default', handle: 'hermes', display_name: 'Hermes' }],
  people: [
    { link: 'L1', name: 'Bo', status: 'waiting', just_me: false, agents: [] },
    { link: 'L2', name: 'Cy', status: 'joined', just_me: false, agents: [{ display_name: 'Kuro' }] }
  ]
}

describe('rooms with people you’ve linked, before they start', () => {
  it('reads the drafts, leaving out a broken one', () => {
    const list = parseDrafts({ ok: true, drafts: [wire, { name: 'no id', status: 'waiting' }], starts: { available: true } })!
    expect(list.startsAvailable).toBe(true)
    expect(list.drafts).toHaveLength(1)
    expect(list.drafts[0]!.people.map(p => [p.name, p.status, p.agents])).toEqual([
      ['Bo', 'waiting', []],
      ['Cy', 'joined', ['Kuro']]
    ])
    expect(parseDrafts({ ok: true, drafts: [] })).toBeNull()
  })

  it('lists the waiting ones and the ended ones until removed', () => {
    const draft = parseDrafts({ ok: true, drafts: [wire], starts: {} })!.drafts[0]!
    const ended = { ...draft, id: 'e', status: 'ended', reason: 'lapsed' }
    const disbanded = { ...draft, id: 'd', status: 'ended', reason: 'disbanded' }
    const started = { ...draft, id: 's', status: 'started' }
    expect(draftRows([draft, ended, disbanded, started], new Set()).map(d => d.id)).toEqual(['conduit-1', 'e'])
    expect(draftRows([ended], new Set(['e']))).toEqual([])
  })

  it('says who it waits for and how each person answered', () => {
    const draft = parseDrafts({ ok: true, drafts: [wire], starts: {} })!.drafts[0]!
    expect(draftLine(draft)).toBe('Cy joined, waiting for Bo')
    expect(draftLine({ ...draft, people: [draft.people[0]!] })).toBe('Waiting for Bo')
    expect(draftLine({ ...draft, people: [draft.people[1]!] })).toBe('Starting…')
    expect(draftLine({ ...draft, status: 'ended', reason: 'too_few' })).toBe("Nobody else joined, so it didn't start")
    expect(personStatus(draft.people[1]!)).toBe('Joined with Kuro')
    expect(personStatus({ ...draft.people[1]!, justMe: true })).toBe('Joined without their bots')
    expect(personStatus(draft.people[0]!)).toBe("Hasn't answered yet")
    expect(personStatus({ ...draft.people[0]!, status: 'mystery' })).toBeNull()
    expect(canStartNow(draft)).toBe(true)
    expect(canStartNow({ ...draft, people: [draft.people[0]!] })).toBe(false)
    expect(canStartNow({ ...draft, people: [draft.people[0]!], agents: ['A', 'B'] })).toBe(true)
  })

  it('keeps New Group Chat within its limits', () => {
    expect(canCreateGroup(1, 0)).toBe(false)
    expect(canCreateGroup(2, 0)).toBe(true)
    expect(canCreateGroup(7, 0)).toBe(false)
    expect(canCreateGroup(1, 1)).toBe(true)
    expect(canCreateGroup(0, 1)).toBe(false)
    expect(canCreateGroup(1, 5)).toBe(true)
    expect(canCreateGroup(2, 5)).toBe(false)
    expect(canPickBot(5, 0)).toBe(true)
    expect(canPickBot(4, 2)).toBe(false)
    expect(canPickPerson(1, 4)).toBe(true)
    expect(canPickPerson(1, 5)).toBe(false)
    expect(draftAgents([{ name: 'default', title: 'Hermes' }])).toEqual([{ profile: 'default', handle: 'hermes', display_name: 'Hermes', choices: null }])
    expect(draftAgents([{ name: 'hermes', title: 'A' }, { name: 'default', title: 'B' }])).toBeNull()
  })

  it('makes, starts and takes back drafts', async () => {
    const calls: unknown[] = []
    const client = roomDraftsClient(async (method, path, body, timeoutMs) => {
      calls.push([method, path, body, timeoutMs])
      return { ok: true, draft: wire } as never
    })
    expect((await client.create('Weekend hike', [{ profile: 'work' }], ['L1'], 'work', true)).kind).toBe('made')
    await client.create('Weekend hike', [], ['L1'], 'default', true)
    await client.create('Weekend hike', [], ['L1'], 'work', false)
    await client.start('conduit-1')
    await client.withdraw('conduit-1')
    expect(calls).toEqual([
      ['POST', '/api/plugins/conduit_push/rooms/drafts?conduit_profile=work', { name: 'Weekend hike', agents: [{ profile: 'work' }], links: ['L1'] }, 55000],
      ['POST', '/api/plugins/conduit_push/rooms/drafts', { name: 'Weekend hike', agents: [], links: ['L1'] }, 55000],
      ['POST', '/api/plugins/conduit_push/rooms/drafts?profile=work', { name: 'Weekend hike', agents: [], links: ['L1'] }, 55000],
      ['POST', '/api/plugins/conduit_push/rooms/drafts/start', { room_id: 'conduit-1' }, undefined],
      ['DELETE', '/api/plugins/conduit_push/rooms/drafts?room_id=conduit-1', undefined, 55000]
    ])
    const slow = roomDraftsClient(async () => {
      throw Object.assign(new Error('timeout'), { code: 504 })
    })
    expect(await slow.create('x', [], ['L1'], 'default', false)).toEqual({ kind: 'sending' })
  })
})
