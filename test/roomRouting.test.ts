import { describe, expect, it } from 'vitest'
import {
  canContinue,
  choosingWhoAnswers,
  contextFrom,
  contextSave,
  driverStatus,
  roomItems,
  routingCaption,
  routingChoices,
  type Room,
  type RoomEvent
} from '../src/renderer/src/state/groups'

const room: Room = {
  roomId: 'r',
  name: 'Team',
  members: [
    { memberId: 'm-ada', profile: 'ada', displayName: 'Ada' },
    { memberId: 'm-linus', profile: 'linus', displayName: 'Linus' }
  ],
  disbanded: false,
  linked: false
}
let seq = 0
const ev = (kind: string, payload: Record<string, unknown>, eventId = `e${seq + 1}`): RoomEvent => ({
  seq: ++seq,
  eventId,
  kind,
  actor: { kind: 'gateway', id: 'g' },
  payload
})
const user = (id: string, text = 'hi', thread = id) => ev('message.user', { text, thread_id: thread }, id)

describe('room routing', () => {
  it('reads settings, keeping a newer mode apart', () => {
    expect(contextFrom({ purpose: 'Ship', notes: 'n', routing: 'lead', lead_member_id: 'm-ada' })).toEqual({
      purpose: 'Ship',
      notes: 'n',
      routing: 'lead',
      leadMemberId: 'm-ada',
      newerRouting: ''
    })
    expect(contextFrom({ routing: 'vote', lead_member_id: 'm-ada' })).toMatchObject({ routing: 'everyone', leadMemberId: '', newerRouting: 'vote' })
  })

  it('offers Who answers only where the host routes', () => {
    const status = driverStatus({ context: { routing: 'everyone' }, driver_status: { routing_modes: ['everyone', 'lead'], max_continues: 3 } })
    expect(routingChoices(status)).toEqual(['everyone', 'lead'])
    expect(status.maxContinues).toBe(3)
    expect(routingChoices(driverStatus({ context: { purpose: '' }, driver_status: {} }))).toEqual([])
    expect(routingChoices(driverStatus({ context: { routing: 'vote' }, driver_status: {} }))).toEqual(['everyone'])
  })

  it('sends routing only when who answers changed', () => {
    const opened = contextFrom({ routing: 'lead', lead_member_id: 'm-ada' })!
    expect(contextSave({ ...opened, purpose: ' New ' }, opened)).toEqual({ purpose: 'New', notes: '' })
    expect(contextSave({ ...opened, leadMemberId: 'm-linus' }, opened)).toEqual({ purpose: '', notes: '', routing: 'lead', lead_member_id: 'm-linus' })
    expect(contextSave({ ...opened, routing: 'everyone', leadMemberId: '' }, opened)).toMatchObject({ routing: 'everyone', lead_member_id: '' })
    const newer = contextFrom({ routing: 'vote' })!
    expect(contextSave(newer, newer)).toEqual({ purpose: '', notes: '' })
    expect(contextSave({ ...newer, newerRouting: '' }, newer)).toMatchObject({ routing: 'everyone' })
  })

  it('says what the routing decided', () => {
    seq = 0
    const gave = ev('room.assignment', { lead_member_id: 'm-ada', member_ids: ['m-linus'], fallback: false })
    const kept = ev('room.assignment', { lead_member_id: 'm-ada', member_ids: ['m-ada'], fallback: false })
    expect(routingCaption(room, gave)).toBe('Ada gave this to Linus.')
    expect(routingCaption(room, kept)).toBe('Ada is taking this.')
    expect(routingCaption(room, ev('room.routed', { member_ids: [], everyone: true, fallback: true }))).toBe("Couldn't choose who answers, so everyone will.")
    expect(routingCaption(room, ev('room.routed', { member_ids: [], everyone: true, fallback: false }))).toBe('Assigned to everyone.')
    expect(routingCaption(room, ev('room.routed', { member_ids: ['m-ada', 'm-linus'], everyone: false, fallback: false }))).toBe('Assigned to Ada and Linus.')
  })

  it('offers Continue under a turn limit only while the host can reopen it', () => {
    seq = 0
    const events = [user('d1', 'go', 't1'), ev('room.activity', { status: 'bounded', discussion_event_id: 'd1', thread_id: 't1' })]
    const items = roomItems(room, events)
    expect(items.at(-1)).toMatchObject({ kind: 'note', paused: 'd1' })
    expect(canContinue(events, 'd1', 2)).toBe(true)
    expect(canContinue(events, 'd1', undefined)).toBe(false)
    // Continued once, capped again: one Continue left of two.
    const again = [
      ...events,
      ev('room.continued', { discussion_event_id: 'd1', thread_id: 't1', grant: 1 }),
      ev('room.activity', { status: 'bounded', discussion_event_id: 'd1', thread_id: 't1' })
    ]
    expect(canContinue(again, 'd1', 2)).toBe(true)
    expect(canContinue(again, 'd1', 1)).toBe(false)
    // A Stop or a newer message in its thread fences it.
    expect(canContinue([...events, ev('room.stop_requested', {})], 'd1', 2)).toBe(false)
    expect(canContinue([...events, user('d2', 'more', 't1')], 'd1', 2)).toBe(false)
  })

  it('says who is choosing who answers, and only what the events show', () => {
    seq = 0
    const lead = contextFrom({ routing: 'lead', lead_member_id: 'm-ada' })
    const auto = contextFrom({ routing: 'auto' })
    const events = [user('d1', 'plan the trip')]
    expect(choosingWhoAnswers(room, events, lead)).toEqual({ lead: 'Ada' })
    expect(choosingWhoAnswers(room, events, auto)).toEqual({})
    expect(choosingWhoAnswers(room, events, contextFrom({ routing: 'everyone' }))).toBeNull()
    expect(choosingWhoAnswers(room, [user('d9', '@ada plan it')], lead)).toBeNull()
    expect(
      choosingWhoAnswers(
        room,
        [...events, ev('room.assignment', { discussion_event_id: 'd1', lead_member_id: 'm-ada', member_ids: ['m-ada'], fallback: false })],
        lead
      )
    ).toBeNull()
    expect(choosingWhoAnswers(room, [...events, ev('room.activity', { status: 'settled', discussion_event_id: 'd1' })], lead)).toBeNull()
    // Opened under Everyone, before a change to lead: not routed.
    seq = 0
    const before = [ev('room.context_set', { routing: 'everyone' }), user('d1'), ev('room.context_set', { routing: 'lead', lead_member_id: 'm-ada' })]
    expect(choosingWhoAnswers(room, before, lead)).toBeNull()
  })
})
