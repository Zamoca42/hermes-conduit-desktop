import { describe, expect, it } from 'vitest'
import {
  addToDraft,
  defaultRoomName,
  driverStatus,
  eventFromWire,
  logPage,
  mergeEvents,
  roomCapabilities,
  roomItems,
  roomMembers,
  roomsFromList,
  type Room
} from '../src/renderer/src/state/groups'

const room: Room = {
  roomId: 'r1',
  name: 'Probe',
  members: [
    { memberId: 'default', profile: 'default', handle: 'hermes', displayName: 'Hermes' },
    { memberId: 'furina', profile: 'furina', handle: 'furina', displayName: 'Furina' }
  ],
  disbanded: false,
  linked: false
}

const wire = (seq: number, kind: string, payload: Record<string, unknown>, actor: Record<string, unknown> = { kind: 'user', id: 'desktop' }) => ({
  room_id: 'r1',
  seq,
  event_id: `e${seq}`,
  kind,
  actor,
  payload,
  created_at: 1_794_967_623 + seq
})

describe('rooms', () => {
  it('knows whether Hermes hosts rooms', () => {
    expect(roomCapabilities({ methods: ['groups.list', 'groups.create', 'groups.state', 'groups.send', 'groups.log', 'groups.stop'], max_log_limit: 500 })).toEqual({
      supported: true,
      canStop: true,
      attachments: false,
      maxLogLimit: 500
    })
    expect(roomCapabilities({ methods: ['groups.list', 'groups.attachment.upload'] }).attachments).toBe(true)
    expect(roomCapabilities({ methods: ['groups.list'] }).supported).toBe(false)
    expect(roomCapabilities(null).supported).toBe(false)
  })

  it('lists open rooms, most recently changed first', () => {
    const rooms = roomsFromList({
      rooms: [
        { room_id: 'old', name: 'Old', members: [{ member_id: 'a', profile: 'a' }], updated_at: 100 },
        { room_id: 'new', name: 'New', members: [], updated_at: 200 },
        { room_id: 'gone', updated_at: 300, disbanded_at: 301 },
        { name: 'no id' }
      ]
    })
    expect(rooms.map(r => r.roomId)).toEqual(['new', 'old'])
    expect(rooms[1]!.members).toEqual([{ memberId: 'a', profile: 'a', handle: undefined, displayName: undefined }])
    expect(rooms[1]!.updatedAt).toBe(100_000)
  })

  it('reads log pages and merges them in order, each event once', () => {
    const page = logPage({ events: [wire(2, 'message.user', { text: 'b' }), wire(1, 'message.user', { text: 'a' }), { seq: 0 }], latest_seq: 3, has_more: true })
    expect(page).toMatchObject({ cursor: 1, latestSeq: 3, hasMore: true })
    expect(logPage({ events: [] })).toBeNull()
    const merged = mergeEvents(page!.events, [eventFromWire(wire(3, 'message.user', { text: 'c' }))!, eventFromWire(wire(2, 'message.user', { text: 'b' }))!])
    expect(merged.map(e => e.seq)).toEqual([1, 2, 3])
  })

  it('shows the user, the bots by name, and failed turns', () => {
    const events = [
      wire(1, 'message.user', { text: 'Hello both', thread_id: 't' }),
      wire(2, 'message.member', { text: 'Hi!', member_id: 'default' }, { kind: 'member', id: 'default', display_name: 'Hermes' }),
      wire(3, 'turn.settled', {}),
      wire(4, 'turn.failed', { member_id: 'furina', error: 'model offline' }),
      wire(5, 'message.member', { text: '  ' }, { kind: 'member', id: 'furina' })
    ].map(e => eventFromWire(e)!)
    expect(roomItems(room, events)).toEqual([
      { kind: 'user', key: 'e1', text: 'Hello both', at: (1_794_967_623 + 1) * 1000 },
      { kind: 'member', key: 'e2', text: 'Hi!', memberId: 'default', name: 'Hermes', at: (1_794_967_623 + 2) * 1000 },
      { kind: 'note', key: 'e4', tone: 'error', text: 'Furina couldn’t answer: model offline' }
    ])
  })

  it('reads who is answering', () => {
    expect(driverStatus({ room: {}, driver_status: { working: false, member_activity: [{ member_id: 'furina' }, { member_id: 'furina' }] } })).toEqual({
      working: true,
      busy: ['furina'],
      disbanded: false
    })
    expect(driverStatus({ room: { disbanded_at: 5 }, driver_status: { running: true } })).toEqual({ working: false, busy: [], disbanded: true })
  })
})

describe('starting a room', () => {
  it('gives each bot its handle, the main bot hermes, and refuses two alike', () => {
    expect(roomMembers([{ name: 'default', title: 'Furina' }, { name: 'raiden', title: 'Raiden' }])).toEqual([
      { member_id: 'default', profile: 'default', handle: 'hermes', display_name: 'Furina' },
      { member_id: 'raiden', profile: 'raiden', handle: 'raiden', display_name: 'Raiden' }
    ])
    expect(roomMembers([{ name: 'Hermes', title: 'A' }, { name: 'default', title: 'B' }])).toBeNull()
  })

  it('names a room after its bots', () => {
    expect(defaultRoomName(['Raiden', 'Zhongli'])).toBe('Raiden & Zhongli')
    expect(defaultRoomName(['A', 'B', 'C'])).toBe('A, B & C')
    expect(defaultRoomName([])).toBe('New room')
  })

  it('adds each bot once, up to six', () => {
    expect(addToDraft([], 'b', 'a')).toEqual(['b', 'a'])
    expect(addToDraft(['a'], 'a', 'c')).toEqual(['a', 'c'])
    expect(addToDraft(['1', '2', '3', '4', '5', '6'], '7')).toHaveLength(6)
  })
})

describe('day lines', () => {
  it('goes above the first message and each new day', async () => {
    const { startsNewDay, dayLabel } = await import('../src/renderer/src/state/groups')
    const nov13 = new Date(2026, 10, 13, 21, 10).getTime()
    expect(startsNewDay(undefined, nov13)).toBe(true)
    expect(startsNewDay(nov13, nov13 + 60_000)).toBe(false)
    expect(startsNewDay(nov13, new Date(2026, 10, 14, 7, 46).getTime())).toBe(true)
    expect(startsNewDay(nov13, undefined)).toBe(false)
    expect(dayLabel(nov13, new Date(2026, 10, 13, 23, 0).getTime())).toBe('Today')
    expect(dayLabel(nov13, new Date(2026, 10, 14, 9, 0).getTime())).toBe('Yesterday')
  })
})

describe('room files', () => {
  it('knows a room with another person’s agent in it', () => {
    const linked = roomsFromList({ rooms: [{ room_id: 'l', members: [{ member_id: 'a', profile: 'a' }, { member_id: 'p', target: { kind: 'peer' } }] }] })
    expect(linked[0]!.linked).toBe(true)
    expect(roomsFromList({ rooms: [{ room_id: 'h', members: [{ member_id: 'a', profile: 'a' }] }] })[0]!.linked).toBe(false)
  })

  it('shows a message’s files, a message of files alone too', () => {
    const events = logPage({
      events: [wire(1, 'message.user', { text: '', attachments: [{ attachment_id: 'att1', kind: 'image', name: 'cat.png', size: 3, mime: 'image/png' }, { kind: 'file' }] })],
      latest_seq: 1
    })!.events
    expect(roomItems(room, events)).toEqual([
      { kind: 'user', key: 'e1', text: '', files: [{ attachmentId: 'att1', kind: 'image', name: 'cat.png', mime: 'image/png' }], at: expect.any(Number) }
    ])
  })
})

describe('room pictures', () => {
  it('read back as pictures, and anything else as gone', async () => {
    const { pictureFromDownload } = await import('../src/renderer/src/state/roomPictures')
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3))
    expect(pictureFromDownload({ data_base64: png })).toBe(`data:image/png;base64,${png}`)
    expect(pictureFromDownload({ data_base64: btoa('not a picture') })).toBeNull()
    expect(pictureFromDownload({ data_base64: 'x'.repeat(23_000_000) })).toBeNull()
    expect(pictureFromDownload(null)).toBeNull()
  })
})
