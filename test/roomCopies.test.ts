import { describe, expect, it } from 'vitest'
import { eventFromWire, roomItems, unnamedPost } from '../src/renderer/src/state/groups'
import { approvalLine, canLeave, copyApprovals, leaveMessage, copyLine, copyRoom, copyStatus, isOver, parseCopies, parseCopyApproval, parsePost, postRow, roomCopiesClient, takesPosts } from '../src/renderer/src/state/roomCopies'

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

  it('posts while the room takes them, and says how each post stands', () => {
    const copy = parseCopies({ ok: true, copies: [wire] })![0]!
    expect(takesPosts(copy, true)).toBe(true)
    expect(takesPosts(copy, false)).toBe(false)
    expect(takesPosts({ ...copy, yours: [] }, true)).toBe(false)
    expect(takesPosts({ ...copy, yours: [], justMe: true }, true)).toBe(true)
    expect(takesPosts({ ...copy, status: 'left' }, true)).toBe(false)

    expect(parsePost({ event_id: 'p1', text: 'hi', status: 'posted', seq: 4 })).toEqual({ eventId: 'p1', text: 'hi', status: { kind: 'posted', seq: 4 } })
    expect(parsePost({ event_id: 'p1', status: 'posted' })).toBeNull()
    expect(parsePost({ event_id: 'p1', status: 'mystery' })).toBeNull()
    const refused = (error: string) => parsePost({ event_id: 'p1', text: 'hi', status: 'refused', error })!

    expect(postRow(undefined, true, copy, true)).toEqual({ state: 'sending' })
    expect(postRow(undefined, false, copy, true)).toEqual({ state: 'notDelivered' })
    expect(postRow(refused('too_many'), false, copy, true)).toEqual({ state: 'refused', why: 'Not posted: too many posts this hour. Try again later.', retry: true })
    expect(postRow(refused('too_long'), false, copy, true)).toMatchObject({ state: 'refused', retry: false })
    // A room that takes no more posts: the refusal stands, anything else can't go further.
    const ended = { ...copy, status: 'ended' }
    expect(postRow(refused('too_long'), false, ended, true)).toEqual({ state: 'closed', why: "Not posted: it's too long for this room." })
    expect(postRow(undefined, false, ended, true)).toEqual({ state: 'closed', why: 'Not posted: the room has ended.' })
    expect(postRow(undefined, false, { ...copy, status: 'left' }, true)).toEqual({ state: 'closed', why: "Not posted: your agents aren't in this room." })
  })

  it('sends a post under its retry key, over the mailbox’s wait', async () => {
    const calls: unknown[] = []
    const client = roomCopiesClient(async (method, path, body, timeoutMs) => {
      calls.push([method, path, body, timeoutMs])
      return (method === 'POST'
        ? { ok: true, message: { event_id: 'p1', text: 'hi', status: 'sending' } }
        : { ok: true, messages: [{ event_id: 'p1', text: 'hi', status: 'posted', seq: 7 }] }) as never
    })
    expect(await client.post('r1', 'p1', 'hi')).toEqual({ eventId: 'p1', text: 'hi', status: { kind: 'sending' } })
    expect((await client.posts('r1'))[0]!.status).toEqual({ kind: 'posted', seq: 7 })
    expect(calls).toEqual([
      ['POST', '/api/plugins/conduit_push/rooms/copies/messages', { room_id: 'r1', event_id: 'p1', text: 'hi' }, 55000],
      ['GET', '/api/plugins/conduit_push/rooms/copies/messages?room_id=r1', undefined, undefined]
    ])
  })

  it('finds your agents’ approvals in a copy and answers them', async () => {
    const copies = parseCopies({ ok: true, copies: [wire, { ...wire, link: 'L2' }] })!
    const approval = parseCopyApproval({
      run_id: 'run1', request_id: 'req1', room_id: 'conduit-1', room: 'Trip planning', link: 'L1', from: 'Ana',
      agent: { profile: 'default', handle: 'hermes', display_name: 'Kuro' }, command: 'rm -rf build', description: 'Clean up', choices: ['once', 'always', 'deny']
    })!
    expect(approval).toMatchObject({ id: 'run1/req1', memberId: 'default', choices: ['once', 'deny'], command: 'rm -rf build' })
    expect(parseCopyApproval({ run_id: 'run1' })).toBeNull()
    expect(approvalLine(approval)).toBe('Kuro in Trip planning, hosted by Ana')
    expect(approvalLine({ ...approval, agentName: undefined, agentHandle: undefined, agentProfile: undefined, room: undefined, from: undefined })).toBe('Your agent in a room hosted elsewhere')
    const linkless = { ...approval, id: 'x', link: undefined }
    // By Link and room; one without a Link only where no other copy has the room id.
    expect(copyApprovals([approval, linkless], copies[0]!, copies).map(a => a.id)).toEqual(['run1/req1'])
    expect(copyApprovals([linkless], copies[0]!, [copies[0]!]).map(a => a.id)).toEqual(['x'])

    const calls: unknown[] = []
    const client = roomCopiesClient(async (method, path, body, timeoutMs) => {
      calls.push([method, path, body, timeoutMs])
      return { ok: true, approvals: [] } as never
    })
    await client.answer(approval, 'deny')
    expect(await client.approvals()).toEqual([])
    expect(calls[0]).toEqual(['POST', '/api/plugins/conduit_push/rooms/approvals/answer', { run_id: 'run1', request_id: 'req1', choice: 'deny' }, 35000])
  })

  it('leaves a copy: everyone of yours, over the mailbox, a 504 still on its way', async () => {
    const copy = parseCopies({ ok: true, copies: [{ ...wire, out: { default: 'removed' } }] })![0]!
    expect(canLeave(copy, true)).toBe(true)
    expect(canLeave(copy, false)).toBe(false)
    expect(canLeave({ ...copy, status: 'left' }, true)).toBe(false)
    expect(leaveMessage(copy)).toContain('Ana is told')
    expect(copyRoom(copy).members[0]!.out).toBe('removed')
    const invite = { link: 'L1', room_id: 'conduit-1', name: 'Trip planning', status: 'left', joined: [], profiles: [], choices: {} }
    const calls: unknown[] = []
    const client = roomCopiesClient(async (method, path, body, timeoutMs) => {
      calls.push([method, path, body, timeoutMs])
      return { ok: true, invite } as never
    })
    expect((await client.leave(copy, null)).kind).toBe('left')
    expect(calls[0]).toEqual(['POST', '/api/plugins/conduit_push/rooms/leave', { link: 'L1', room_id: 'conduit-1', agents: null }, 55000])
    const slow = roomCopiesClient(async () => {
      throw Object.assign(new Error('timeout'), { code: 504 })
    })
    expect(await slow.leave(copy, null)).toEqual({ kind: 'sending' })
  })
})
