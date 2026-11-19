import { describe, expect, it } from 'vitest'
import {
  addToDraft,
  addressing,
  pickableMembers,
  approveParams,
  approveResolved,
  roomApproval,
  defaultRoomName,
  driverStatus,
  latestDiscussionSettled,
  leadMemberId,
  memberStatuses,
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
      context: false,
      canContinue: false,
      canApprove: false,
      maxLogLimit: 500
    })
    expect(roomCapabilities({ methods: ['groups.list', 'groups.attachment.upload'] }).attachments).toBe(true)
    expect(roomCapabilities({ methods: ['groups.context', 'groups.continue'] })).toMatchObject({ context: true, canContinue: true })
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
      disbanded: false,
      activity: [
        { memberId: 'furina', status: '' },
        { memberId: 'furina', status: '' }
      ],
      approvals: [],
      pendingApprovals: []
    })
    expect(driverStatus({ room: { disbanded_at: 5 }, driver_status: { running: true } })).toEqual({ working: false, busy: [], disbanded: true, approvals: [], pendingApprovals: [] })
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

describe('member statuses', () => {
  const room = { members: [{ memberId: 'm-ada', profile: 'ada' }, { memberId: 'm-lin', profile: 'linus' }, { memberId: 'm-bo', profile: 'bo' }] }
  let seq = 0
  const ev = (kind: string, payload: Record<string, unknown> = {}, eventId = `e${++seq}`) => ({ seq, eventId, kind, actor: { kind: 'system', id: 'x' }, payload })
  const idle = { working: false, busy: [], approvals: [] as string[] }

  it('shows each member’s last outcome in its thread’s current discussion, later turns winning', () => {
    const events = [
      ev('message.user', {}, 'old'),
      ev('turn.failed', { member_id: 'm-bo', discussion_event_id: 'old' }),
      ev('message.user', {}, 'new'),
      ev('turn.failed', { member_id: 'm-ada', discussion_event_id: 'new' }),
      ev('turn.settled', { member_id: 'm-ada', discussion_event_id: 'new' }),
      ev('turn.settled', { member_id: 'linus', discussion_event_id: 'new', passed: true })
    ]
    const statuses = memberStatuses(room, events, idle)
    expect(Object.fromEntries(statuses)).toEqual({ 'm-ada': 'replied', 'm-lin': 'passed' })
  })

  it('puts live turns over outcomes, approvals over both, and nothing live when the driver is idle', () => {
    const events = [ev('message.user', {}, 'd'), ev('turn.settled', { member_id: 'm-ada', discussion_event_id: 'd' })]
    const activity = [
      { memberId: 'm-ada', status: 'queued' },
      { memberId: 'm-lin', status: 'running' }
    ]
    expect(Object.fromEntries(memberStatuses(room, events, { working: true, busy: [], activity, approvals: ['m-bo'] }))).toEqual({
      'm-ada': 'waiting',
      'm-lin': 'responding',
      'm-bo': 'needsApproval'
    })
    expect(Object.fromEntries(memberStatuses(room, events, { working: false, busy: [], activity, approvals: [] }))).toEqual({ 'm-ada': 'replied' })
    // A host without member_activity names its busy members.
    expect(memberStatuses(room, [], { working: true, busy: ['m-bo'], approvals: [] }).get('m-bo')).toBe('responding')
  })

  it('leaves a lead’s routing turn out, and marks a member the driver parked as unavailable', () => {
    const events = [
      ev('message.user', {}, 'd'),
      ev('room.assignment', { task_id: 't-route' }),
      ev('turn.settled', { member_id: 'm-ada', discussion_event_id: 'd', task_id: 't-route' }),
      ev('turn.deferred', { member_id: 'm-bo', discussion_event_id: 'd', reason: 'member_unavailable' })
    ]
    expect(Object.fromEntries(memberStatuses(room, events, idle))).toEqual({ 'm-bo': 'unavailable' })
  })

  it('crowns the lead only while Who answers is Lead', () => {
    expect(leadMemberId(room, { purpose: '', notes: '', routing: 'lead', leadMemberId: 'ada', newerRouting: '' })).toBe('m-ada')
    expect(leadMemberId(room, { purpose: '', notes: '', routing: 'everyone', leadMemberId: '', newerRouting: '' })).toBeUndefined()
  })

  it('says the room settled until a new message, a Continue or a Stop', () => {
    const settled = [ev('message.user', {}, 'd'), ev('room.activity', { discussion_event_id: 'd', status: 'settled' })]
    expect(latestDiscussionSettled(settled)).toBe(true)
    expect(latestDiscussionSettled(settled, true)).toBe(false)
    expect(latestDiscussionSettled([...settled, ev('room.continued', { discussion_event_id: 'd' })])).toBe(false)
    expect(latestDiscussionSettled([...settled, ev('room.stop_requested')])).toBe(false)
    expect(latestDiscussionSettled([...settled, ev('message.user', {}, 'd2')])).toBe(false)
  })

  it('reads the live turns and approvals from the driver', () => {
    const status = driverStatus({
      driver_status: {
        working: true,
        member_activity: [{ member_id: 'm-ada', status: 'running' }],
        pending_actions: [{ kind: 'approval', member_id: 'm-bo' }, { kind: 'clarify', member_id: 'm-lin' }]
      }
    })
    expect(status.activity).toEqual([{ memberId: 'm-ada', status: 'running' }])
    expect(status.approvals).toEqual(['m-bo'])
    expect(driverStatus({ driver_status: {} }).activity).toBeUndefined()
  })
})

describe('room approvals', () => {
  const action = {
    kind: 'approval',
    member_id: 'atlas',
    task_id: 't1',
    execution_generation: 2,
    request_id: 'r9',
    approval: { command: 'rm -rf build', description: 'Deletes files', choices: ['once', 'session', 'deny'] }
  }

  it('reads a held tool call from pending_actions, once or deny only', () => {
    const approval = roomApproval(action)!
    expect(approval).toMatchObject({ id: 'atlas|t1|2|r9', memberId: 'atlas', command: 'rm -rf build', description: 'Deletes files', choices: ['once', 'deny'] })
    // The approval keeps its own request id when the row has none; nothing offered means both.
    expect(roomApproval({ ...action, request_id: undefined, approval: { request_id: 'q1' } })).toMatchObject({ requestId: 'q1', choices: ['once', 'deny'] })
    expect(roomApproval({ ...action, execution_generation: undefined })).toBeNull()
    expect(roomApproval({ ...action, kind: 'question' })).toBeNull()
    const status = driverStatus({ driver_status: { pending_actions: [action, action, { kind: 'approval', member_id: 'iris' }] } })
    expect(status.approvals).toEqual(['atlas', 'iris'])
    expect(status.pendingApprovals!.map(a => a.id)).toEqual(['atlas|t1|2|r9'])
  })

  it('answers through groups.approve and reads its receipt', () => {
    expect(approveParams('room', roomApproval(action)!, 'deny')).toEqual({
      room_id: 'room',
      member_id: 'atlas',
      task_id: 't1',
      execution_generation: 2,
      choice: 'deny',
      request_id: 'r9'
    })
    expect(approveResolved({ resolved: 0 })).toBe(false)
    expect(approveResolved({ resolved: 1 })).toBe(true)
    expect(approveResolved(null)).toBe(true)
    expect(roomCapabilities({ methods: ['groups.approve'] }).canApprove).toBe(true)
  })
})

describe('the To row', () => {
  const members = [
    { memberId: 'furina', profile: 'furina', handle: 'furina', displayName: 'Furina' },
    { memberId: 'zhongli', profile: 'zhongli', handle: 'Zhongli', displayName: 'Zhongli' },
    { memberId: 'twin', profile: 'twin', handle: 'furina' },
    { memberId: 'nobody', profile: 'nobody' },
    { memberId: 'all', handle: 'all' }
  ]

  it('offers each routable handle once', () => {
    expect(pickableMembers(members).map(m => m.memberId)).toEqual(['furina', 'zhongli'])
  })

  it('puts the picks the text doesn’t tag in front, in the order picked', () => {
    expect(addressing('what now?', ['Zhongli', 'furina'], members)).toBe('@Zhongli @furina what now?')
    expect(addressing('@furina what now?', ['zhongli', 'furina'], members)).toBe('@zhongli @furina what now?')
  })

  it('tags files sent alone and leaves out a pick that left', () => {
    expect(addressing('', ['furina'], members)).toBe('@furina')
    expect(addressing('hi', ['gone'], members)).toBe('hi')
  })

  it('leaves an @all message as it is', () => {
    expect(addressing('@all hi', ['furina'], members)).toBe('@all hi')
  })
})
