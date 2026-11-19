import { describe, expect, it } from 'vitest'
import { eventFromWire, roomItems, unnamedPost } from '../src/renderer/src/state/groups'
import { copyLine, copyRoom, copyStatus, isOver, parseCopies, roomCopiesClient } from '../src/renderer/src/state/roomCopies'

const wire = {
  room_id: 'conduit-1',
  name: 'Trip planning',
  link: 'L1',
  from: 'Ana',
  members: [
    { member_id: 'default', handle: 'hermes', display_name: 'Hermes', owner: null },
    { member_id: 'l4-1', handle: 'hermes-2', display_name: 'Hermes', owner: 'Bo' }
  ],
  yours: [{ member_id: 'l4-1', profile: 'default', handle: 'hermes' }],
  out: {},
  just_me: false,
  status: 'started',
  reason: null,
  state: { working: false, activity: [], routes: [{ member_id: 'l4-1', status: 'ready' }] },
  last_seq: 3,
  updated_at: 1795096880.2
}

describe('rooms other people host', () => {
  it('reads the copies, newest first, leaving out a broken one', () => {
    const copies = parseCopies({ ok: true, copies: [wire, { ...wire, room_id: 'conduit-2', updated_at: 1795096990 }, { name: 'no id' }] })!
    expect(copies.map(c => c.id)).toEqual(['L1/conduit-2', 'L1/conduit-1'])
    expect(copies[1]!.yours).toEqual([{ memberId: 'l4-1', profile: 'default', handle: 'hermes' }])
    expect(parseCopies({ ok: false })).toBeNull()
  })

  it('draws your agents as your bots and the host’s as theirs, whatever their ids', () => {
    const room = copyRoom(parseCopies({ ok: true, copies: [wire] })![0]!)
    expect(room.members).toEqual([
      { memberId: 'default', handle: 'hermes', displayName: 'Hermes', profile: undefined, peer: true, owner: 'Ana' },
      { memberId: 'l4-1', handle: 'hermes-2', displayName: 'Hermes', profile: 'default' }
    ])
    expect(room.linked).toBe(true)
    expect(room.disbanded).toBe(false)
  })

  it('says who hosts it and how it stands', () => {
    const copy = parseCopies({ ok: true, copies: [wire] })![0]!
    expect(copyLine(copy)).toBe('Hosted by Ana · 2 members')
    expect(copyLine({ ...copy, working: true })).toBe('Hosted by Ana · working…')
    expect(copyLine({ ...copy, from: '', working: true })).toBe('Hosted elsewhere · working…')
    expect(copyLine({ ...copy, status: 'ended', reason: 'removed' })).toBe('Ana took your agents out')
    expect(copyLine({ ...copy, status: 'ended' })).toBe('Ended')
    expect(copyLine({ ...copy, status: 'left' })).toBe('Your agents left')
    expect(copyLine({ ...copy, status: 'left', justMe: true })).toBe('You left')
    expect(isOver({ ...copy, status: 'left' })).toBe(true)
    expect(isOver(copy)).toBe(false)
    expect(copyStatus({ ...copy, activity: [{ memberId: 'l4-1', status: 'running' }] })).toMatchObject({ working: true, busy: ['l4-1'], approvals: [] })
  })

  it('shows the people’s messages under their names, and yours without your name', () => {
    const copy = parseCopies({ ok: true, copies: [wire] })![0]!
    const message = (seq: number, text: string, post?: unknown) =>
      eventFromWire({ seq, event_id: `e${seq}`, kind: 'message.user', actor: { kind: 'user', id: 'u' }, payload: { text }, ...(post ? { post } : {}) })!
    const events = [message(1, 'Where to?'), message(2, 'Bo: Lisbon\nBo: in May', {}), message(3, 'Cy: Porto', { by: 'Cy' })]
    const items = roomItems(copyRoom(copy), events, { host: 'Ana', you: 'Bo' })
    expect(items.map(i => [i.kind, 'name' in i ? i.name : null, i.text])).toEqual([
      ['person', 'Ana', 'Where to?'],
      ['user', null, 'Lisbon\nin May'],
      ['person', 'Cy', 'Porto']
    ])
    // A room this Hermes hosts keeps the user's own messages as they are.
    expect(roomItems(null, events).every(i => i.kind === 'user')).toBe(true)
    expect(unnamedPost('Bo: one\ntwo', 'Bo')).toBe('Bo: one\ntwo')
  })

  it('reads the log and deletes an ended copy with your agents’ chats', async () => {
    const calls: string[] = []
    const client = roomCopiesClient(async (method, path) => {
      calls.push(`${method} ${path}`)
      if (path.includes('/copies/log')) return { ok: true, events: [{ seq: 1, event_id: 'e1', kind: 'message.user', payload: { text: 'hi' } }], cursor: 1, latest_seq: 1, has_more: false } as never
      if (path.includes('/people')) return { ok: true, you: 'Bo' } as never
      return { ok: true } as never
    })
    expect((await client.log('room 1', 0, 9999)).events).toHaveLength(1)
    expect(await client.you('room 1')).toBe('Bo')
    await client.forgetSessions('room 1', 'default')
    await client.forgetSessions('room 1', 'work')
    await client.forget('room 1')
    expect(calls).toEqual([
      'GET /api/plugins/conduit_push/rooms/copies/log?room_id=room%201&since_seq=0&limit=500',
      'GET /api/plugins/conduit_push/rooms/people?room_id=room%201',
      'DELETE /api/plugins/conduit_push/rooms/sessions?room_id=room%201',
      'DELETE /api/plugins/conduit_push/rooms/sessions?room_id=room%201&profile=work',
      'DELETE /api/plugins/conduit_push/rooms/copies?room_id=room%201'
    ])
  })
})
