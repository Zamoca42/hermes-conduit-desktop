/**
 * Group chats: the rooms Hermes hosts (`groups.*`, the gateway's room API).
 * A room has 2 to 6 bots, an append-only log read in pages by `since_seq`,
 * and a driver that runs the bots' turns on the host, so a room keeps going
 * with no window open. Read the phone's GroupChatModels.swift for the rest.
 */
import type { Bot } from './bots'
import { formatDate, locale, t } from '../../../shared/i18n'

export const ROOM_MIN_MEMBERS = 2
export const ROOM_MAX_MEMBERS = 6
/** The phone polls an open room every 3 s; there's no stream for room logs. */
export const ROOM_POLL_MS = 2500
export const REQUIRED_ROOM_METHODS = ['groups.list', 'groups.create', 'groups.state', 'groups.send', 'groups.log']

export interface RoomMember {
  memberId: string
  profile?: string
  handle?: string
  displayName?: string
}

export interface Room {
  roomId: string
  name: string
  members: RoomMember[]
  updatedAt?: number
  latestSeq?: number
  disbanded: boolean
  /** Another person's agent is in it: Hermes' peer route carries no files. */
  linked: boolean
}

export interface RoomEvent {
  seq: number
  eventId: string
  kind: string
  actor: { kind: string; id: string; profile?: string; displayName?: string }
  payload: Record<string, unknown>
  createdAt?: number
}

export interface RoomCapabilities {
  supported: boolean
  canStop: boolean
  /** Hermes keeps a message's files as its own attachments (`groups.attachment.upload`). */
  attachments: boolean
  /** Group Settings: purpose, shared notes and (where it routes) who answers. */
  context?: boolean
  /** Continue on a discussion paused at its turn limit. */
  canContinue?: boolean
  /** Run or Reject on a member's tool call the room holds (`groups.approve`). */
  canApprove?: boolean
  maxLogLimit?: number
}

const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const int = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)
const seconds = (value: unknown): number | undefined => (typeof value === 'number' && value > 0 ? Math.round(value * 1000) : undefined)

export function roomCapabilities(result: unknown): RoomCapabilities {
  const methods = new Set((Array.isArray(obj(result)?.methods) ? (obj(result)!.methods as unknown[]) : []).filter((m): m is string => typeof m === 'string'))
  return {
    supported: REQUIRED_ROOM_METHODS.every(m => methods.has(m)),
    canStop: methods.has('groups.stop'),
    attachments: methods.has('groups.attachment.upload'),
    context: methods.has('groups.context'),
    canContinue: methods.has('groups.continue'),
    canApprove: methods.has('groups.approve'),
    maxLogLimit: int(obj(result)?.max_log_limit)
  }
}

export function roomFromWire(value: unknown): Room | null {
  const row = obj(value)
  const roomId = str(row?.room_id)
  if (!row || !roomId) return null
  const members: RoomMember[] = []
  let linked = false
  for (const raw of Array.isArray(row.members) ? row.members : []) {
    const m = obj(raw)
    const memberId = str(m?.member_id) ?? str(m?.profile)
    if (!m || !memberId) continue
    if (obj(m.target)?.kind === 'peer') linked = true
    members.push({ memberId, profile: str(m.profile), handle: str(m.handle), displayName: str(m.display_name) })
  }
  return {
    roomId,
    name: str(row.name) ?? roomId,
    members,
    updatedAt: seconds(row.updated_at) ?? seconds(row.created_at),
    latestSeq: int(row.latest_seq),
    disbanded: typeof row.disbanded_at === 'number',
    linked
  }
}

/** `groups.list`'s rooms, the ones still open, most recently changed first. */
export function roomsFromList(result: unknown): Room[] {
  const rows = obj(result)?.rooms
  if (!Array.isArray(rows)) return []
  return rows
    .map(roomFromWire)
    .filter((room): room is Room => room !== null && !room.disbanded)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function eventFromWire(value: unknown): RoomEvent | null {
  const row = obj(value)
  const seq = int(row?.seq)
  if (!row || seq === undefined || seq < 1) return null
  const actor = obj(row.actor) ?? {}
  return {
    seq,
    eventId: str(row.event_id) ?? `seq-${seq}`,
    kind: str(row.kind) ?? 'unknown',
    actor: { kind: str(actor.kind) ?? 'unknown', id: str(actor.id) ?? '', profile: str(actor.profile), displayName: str(actor.display_name) },
    payload: obj(row.payload) ?? {},
    createdAt: seconds(row.created_at)
  }
}

export interface LogPage {
  events: RoomEvent[]
  cursor: number
  latestSeq: number
  hasMore: boolean
}

export function logPage(result: unknown): LogPage | null {
  const row = obj(result)
  const latestSeq = int(row?.latest_seq)
  if (!row || latestSeq === undefined) return null
  const events = (Array.isArray(row.events) ? row.events : []).map(eventFromWire).filter((e): e is RoomEvent => e !== null)
  return { events, cursor: int(row.cursor) ?? events[events.length - 1]?.seq ?? 0, latestSeq, hasMore: row.has_more === true }
}

/** The log so far with a page's events added: in order, each seq once. */
export function mergeEvents(existing: readonly RoomEvent[], incoming: readonly RoomEvent[]): RoomEvent[] {
  if (!incoming.length) return existing as RoomEvent[]
  const bySeq = new Map(existing.map(e => [e.seq, e]))
  for (const event of incoming) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export type RoomItem =
  | { kind: 'user'; key: string; text: string; files?: RoomFile[]; at?: number; pending?: boolean; failed?: boolean }
  | { kind: 'member'; key: string; text: string; memberId: string; name: string; at?: number }
  | { kind: 'note'; key: string; text: string; tone?: 'error'; /** A discussion paused at its turn limit: Continue may reopen it. */ paused?: string }

function memberName(room: Room | null, memberId: string, fallback?: string): string {
  const member = room?.members.find(m => m.memberId === memberId)
  return member?.displayName ?? fallback ?? member?.profile ?? memberId
}

/** What a room's log shows: the user's and the bots' messages, and a line when a bot's turn failed. */
/** A file a room message carries, from its `attachments` manifest. */
export interface RoomFile {
  attachmentId: string
  kind: string
  name: string
  mime?: string
}

export function roomFiles(payload: Record<string, unknown>): RoomFile[] {
  const files: RoomFile[] = []
  for (const raw of Array.isArray(payload.attachments) ? payload.attachments : []) {
    const a = obj(raw)
    const attachmentId = str(a?.attachment_id)
    if (!a || !attachmentId) continue
    files.push({ attachmentId, kind: str(a.kind) ?? 'file', name: str(a.name) ?? attachmentId, mime: str(a.mime) })
  }
  return files
}

export function roomItems(room: Room | null, events: readonly RoomEvent[]): RoomItem[] {
  const items: RoomItem[] = []
  for (const event of events) {
    const text = typeof event.payload.text === 'string' ? event.payload.text : ''
    if (event.kind === 'message.user') {
      const files = roomFiles(event.payload)
      if (text.trim() || files.length) items.push({ kind: 'user', key: event.eventId, text, ...(files.length ? { files } : {}), at: event.createdAt })
    } else if (event.kind === 'message.member') {
      const memberId = str(event.payload.member_id) ?? event.actor.id
      if (text.trim()) items.push({ kind: 'member', key: event.eventId, text, memberId, name: memberName(room, memberId, event.actor.displayName), at: event.createdAt })
    } else if (event.kind === 'turn.failed') {
      const memberId = str(event.payload.member_id) ?? ''
      const reason = str(event.payload.error) ?? str(event.payload.reason)
      items.push({
        kind: 'note',
        key: event.eventId,
        tone: 'error',
        text: reason
          ? t('{bot} couldn’t answer: {reason}', { bot: memberName(room, memberId, t('A bot')), reason })
          : t('{bot} couldn’t answer.', { bot: memberName(room, memberId, t('A bot')) })
      })
    } else if (event.kind === 'room.renamed') {
      const name = str(event.payload.name)
      if (name) items.push({ kind: 'note', key: event.eventId, text: t('Renamed to {name}', { name }) })
    } else if (event.kind === 'room.context_set') {
      items.push({ kind: 'note', key: event.eventId, text: t("The room's settings changed.") })
    } else if (event.kind === 'room.continued') {
      items.push({ kind: 'note', key: event.eventId, text: t('The conversation continued.') })
    } else if (event.kind === 'room.assignment' || event.kind === 'room.routed') {
      items.push({ kind: 'note', key: event.eventId, text: routingCaption(room, event) })
    } else if (event.kind === 'room.activity' && event.payload.status === 'bounded') {
      items.push({ kind: 'note', key: event.eventId, text: t('The conversation reached its turn limit.'), paused: str(event.payload.discussion_event_id) })
    }
  }
  return items
}

/** "Ada and Linus", in the app's language. */
function namesList(names: string[]): string {
  try {
    return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
}

const memberIds = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && !!id) : [])

/** What the routing decided for a message that named nobody, in Desktop's words. */
export function routingCaption(room: Room | null, event: RoomEvent): string {
  const picked = memberIds(event.payload.member_ids)
  if (event.kind === 'room.assignment') {
    const leadId = str(event.payload.lead_member_id)
    const lead = leadId ? memberName(room, leadId) : t('The lead')
    const keptIt = picked.length === 1 && picked[0]!.toLowerCase() === leadId?.toLowerCase()
    if (event.payload.fallback === true || !picked.length || keptIt) return t('{lead} is taking this.', { lead })
    return t('{lead} gave this to {names}.', { lead, names: namesList(picked.map(id => memberName(room, id))) })
  }
  if (event.payload.fallback === true) return t("Couldn't choose who answers, so everyone will.")
  if (event.payload.everyone === true || !picked.length) return t('Assigned to everyone.')
  return t('Assigned to {names}.', { names: namesList(picked.map(id => memberName(room, id))) })
}

export type Routing = 'everyone' | 'lead' | 'auto'
const ROUTINGS: Routing[] = ['everyone', 'lead', 'auto']

/** A room's settings, from `groups.state`'s `context` or a `room.context_set` payload. */
export interface RoomContext {
  purpose: string
  notes: string
  routing: Routing
  /** The lead's member id; empty unless routing is `lead`. */
  leadMemberId: string
  /** A routing mode this app predates, as the host named it; routing reads `everyone` meanwhile. */
  newerRouting: string
}

export const MAX_PURPOSE_CHARACTERS = 500
export const MAX_NOTES_BYTES = 4 * 1024

export function contextFrom(value: unknown): RoomContext | undefined {
  const row = obj(value)
  if (!row) return undefined
  const raw = typeof row.routing === 'string' ? row.routing.trim() : ''
  const routing = (ROUTINGS as string[]).includes(raw) ? (raw as Routing) : 'everyone'
  return {
    purpose: typeof row.purpose === 'string' ? row.purpose : '',
    notes: typeof row.notes === 'string' ? row.notes : '',
    routing,
    leadMemberId: routing === 'lead' && typeof row.lead_member_id === 'string' ? row.lead_member_id : '',
    newerRouting: raw && !(ROUTINGS as string[]).includes(raw) ? raw : ''
  }
}

/** The Who answers choices this host offers: none on a host before routing, Everyone at least on a room running a newer mode. */
export function routingChoices(status: Pick<DriverStatus, 'routingModes' | 'context'>): Routing[] {
  const listed = (status.routingModes ?? []).filter((mode): mode is Routing => (ROUTINGS as string[]).includes(mode))
  if (listed.length) return ROUTINGS.filter(mode => listed.includes(mode))
  return status.context?.newerRouting ? ['everyone'] : []
}

/**
 * The `groups.context` a save sends: purpose and notes always, routing only
 * when it changes who answers from what the settings opened with, so a
 * change another client made meanwhile stays.
 */
export function contextSave(draft: RoomContext, opened: RoomContext): Record<string, unknown> {
  const save: Record<string, unknown> = { purpose: draft.purpose.trim(), notes: draft.notes }
  const changed = draft.newerRouting
    ? false
    : draft.routing !== opened.routing || !!opened.newerRouting || (draft.routing === 'lead' && draft.leadMemberId !== opened.leadMemberId)
  if (changed) {
    save.routing = draft.routing
    save.lead_member_id = draft.routing === 'lead' ? draft.leadMemberId : ''
  }
  return save
}

/** Whether these events start at the room's beginning, so they show everything about a discussion. */
const reachesStart = (events: readonly RoomEvent[]) => events[0]?.seq === 1

/**
 * Whether Continue can reopen this discussion, as the host decides it: its
 * latest outcome is the turn limit, no Stop and no newer message in its
 * thread came after its message, and it has had fewer Continues than the
 * host allows. Only claimed where the events show its message (so every
 * Continue after it is counted) or reach the room's start.
 */
export function canContinue(events: readonly RoomEvent[], discussionEventId: string, maxContinues: number | undefined): boolean {
  if (maxContinues === undefined) return false
  const source = events.find(event => event.eventId === discussionEventId)
  if (!source && !reachesStart(events)) return false
  let bounded: RoomEvent | null = null
  let grants = 0
  for (const event of events) {
    if (event.payload.discussion_event_id !== discussionEventId) continue
    if (event.kind === 'room.continued') {
      grants += 1
      bounded = null
    } else if (event.kind === 'room.activity') bounded = event.payload.status === 'bounded' ? event : null
  }
  if (!bounded || grants >= maxContinues) return false
  const thread = bounded.payload.thread_id
  const after = source?.seq ?? bounded.seq
  return !events.some(
    event => event.seq > after && (event.kind === 'room.stop_requested' || (event.kind === 'message.user' && event.payload.thread_id === thread))
  )
}

/** The settings a discussion opened under: the latest change before it, the defaults from the room's start, or the current ones with no change after it. */
function contextAt(events: readonly RoomEvent[], seq: number, current: RoomContext | undefined): RoomContext | undefined {
  const before = [...events].reverse().find(event => event.kind === 'room.context_set' && event.seq < seq)
  if (before) return contextFrom(before.payload)
  if (!events.some(event => event.kind === 'room.context_set' && event.seq > seq)) return current
  return reachesStart(events) ? contextFrom({}) : undefined
}

/**
 * Who is choosing who answers right now, for the title line: the oldest
 * discussion still open, opened by a message that named nobody in a lead or
 * automatic room, with no pick and no answer yet. Null when the events
 * can't say so.
 */
export function choosingWhoAnswers(room: Room | null, events: readonly RoomEvent[], current: RoomContext | undefined): { lead?: string } | null {
  const continued = new Map<string, number>()
  const closed = new Set<string>()
  for (const event of events) {
    const id = str(event.payload.discussion_event_id)
    if (!id) continue
    if (event.kind === 'room.continued') {
      continued.set(id, event.seq)
      closed.delete(id)
    } else if (event.kind === 'room.activity' && (event.payload.status === 'settled' || event.payload.status === 'bounded')) closed.add(id)
  }
  const lastStop = Math.max(0, ...events.filter(event => event.kind === 'room.stop_requested').map(event => event.seq))
  // The host works one discussion at a time, the oldest still open.
  const open = events.find(
    event =>
      event.kind === 'message.user' &&
      event.payload.thread_id === event.eventId &&
      event.seq > lastStop &&
      !closed.has(event.eventId) &&
      !continued.has(event.eventId)
  )
  if (!open) return null
  const text = typeof open.payload.text === 'string' ? open.payload.text : ''
  // A message naming members goes straight to them.
  if (/(^|\s)@[\w-]/.test(text)) return null
  const context = contextAt(events, open.seq, current)
  if (!context || (context.routing !== 'lead' && context.routing !== 'auto')) return null
  const answered = events.some(
    event =>
      event.seq > open.seq &&
      (((event.kind === 'room.assignment' || event.kind === 'room.routed') && event.payload.discussion_event_id === open.eventId) ||
        ((event.kind === 'message.member' || event.kind.startsWith('turn.')) && event.payload.thread_id === open.payload.thread_id))
  )
  if (answered) return null
  return context.routing === 'lead' && context.leadMemberId ? { lead: memberName(room, context.leadMemberId) } : {}
}

export interface DriverStatus {
  working: boolean
  /** The members taking a turn now. */
  busy: string[]
  disbanded: boolean
  /** The room's settings, where the host keeps them. */
  context?: RoomContext
  /** The Who answers modes the host routes by; absent on a host before routing. */
  routingModes?: string[]
  /** How many times one discussion can be continued past its turn limit. */
  maxContinues?: number
  /** The live member turns (`member_activity`), in admission order; absent on a host before 0.22.5. */
  activity?: { memberId: string; status: string }[]
  /** The members waiting on an approval (`pending_actions`). */
  approvals: string[]
  /** The approvals themselves, each answered on its card above the composer. */
  pendingApprovals?: RoomApproval[]
}

/**
 * A member's tool call the room holds for the user, after the phone's
 * GroupPendingApproval: driver state, not a log event, so it shows until
 * it's answered or the gateway drops it. Rooms answer once or deny only.
 */
export interface RoomApproval {
  /** Member, task, generation and request together: one card per request. */
  id: string
  memberId: string
  taskId: string
  executionGeneration: number
  requestId: string
  command: string
  description: string
  choices: ('once' | 'deny')[]
}

export function roomApproval(value: unknown): RoomApproval | null {
  const action = obj(value)
  if (action?.kind !== 'approval') return null
  const memberId = str(action.member_id)
  const taskId = str(action.task_id)
  const executionGeneration = int(action.execution_generation)
  const approval = obj(action.approval) ?? {}
  // The driver copies the queue id to the row; the approval keeps its own.
  const requestId = str(action.request_id) ?? str(approval.request_id)
  if (!memberId || !taskId || executionGeneration === undefined || !requestId) return null
  const offered = (Array.isArray(approval.choices) ? approval.choices : []).filter((c): c is 'once' | 'deny' => c === 'once' || c === 'deny')
  return {
    id: `${memberId}|${taskId}|${executionGeneration}|${requestId}`,
    memberId,
    taskId,
    executionGeneration,
    requestId,
    command: typeof approval.command === 'string' ? approval.command : '',
    description: typeof approval.description === 'string' ? approval.description.trim() : '',
    choices: offered.length ? offered : ['once', 'deny']
  }
}

/** `groups.approve`'s params for answering `approval` with `choice`. */
export function approveParams(roomId: string, approval: RoomApproval, choice: 'once' | 'deny') {
  return {
    room_id: roomId,
    member_id: approval.memberId,
    task_id: approval.taskId,
    execution_generation: approval.executionGeneration,
    choice,
    request_id: approval.requestId
  }
}

/** Whether `groups.approve` reached the request: a receipt resolving none means it was no longer active. */
export function approveResolved(result: unknown): boolean {
  const resolved = obj(result)?.resolved
  if (typeof resolved === 'number') return resolved > 0
  if (typeof resolved === 'boolean') return resolved
  return true
}

export function driverStatus(result: unknown): DriverStatus {
  const row = obj(result)
  const driver = obj(row?.driver_status)
  const busy: string[] = []
  for (const raw of Array.isArray(driver?.member_activity) ? (driver!.member_activity as unknown[]) : []) {
    const id = str(obj(raw)?.member_id)
    if (id && !busy.includes(id)) busy.push(id)
  }
  const activity = Array.isArray(driver?.member_activity)
    ? (driver!.member_activity as unknown[]).flatMap(raw => {
        const memberId = str(obj(raw)?.member_id)
        return memberId ? [{ memberId, status: str(obj(raw)?.status) ?? '' }] : []
      })
    : undefined
  const approvals: string[] = []
  const pendingApprovals: RoomApproval[] = []
  for (const raw of Array.isArray(driver?.pending_actions) ? (driver!.pending_actions as unknown[]) : []) {
    const action = obj(raw)
    const memberId = str(action?.member_id)
    if (action?.kind === 'approval' && memberId && !approvals.includes(memberId)) approvals.push(memberId)
    const approval = roomApproval(raw)
    if (approval && !pendingApprovals.some(a => a.id === approval.id)) pendingApprovals.push(approval)
  }
  const modes = Array.isArray(driver?.routing_modes) ? (driver!.routing_modes as unknown[]).filter((m): m is string => typeof m === 'string') : undefined
  return {
    working: driver?.working === true || busy.length > 0,
    busy,
    disbanded: typeof obj(row?.room)?.disbanded_at === 'number',
    context: contextFrom(row?.context),
    routingModes: modes,
    maxContinues: int(driver?.max_continues),
    activity,
    approvals,
    pendingApprovals
  }
}

// MARK: Member statuses

/** How each member did with the latest message, for the pills under the room's title (the phone's GroupMemberStatus). */
export type MemberStatus = 'needsApproval' | 'responding' | 'waiting' | 'replied' | 'passed' | 'failed' | 'stopped' | 'unavailable'

/** The words after the member's name, with the dot between them, as the phone shows them. */
export function memberStatusLabel(status: MemberStatus): string {
  switch (status) {
    case 'needsApproval':
      return t('· needs approval')
    case 'responding':
      return t('· responding…')
    case 'waiting':
      return t('· waiting')
    case 'replied':
      return t('· replied')
    case 'passed':
      return t('· passed')
    case 'failed':
      return t('· failed')
    case 'stopped':
      return t('· stopped')
    case 'unavailable':
      return t('· unavailable')
  }
}

/** The member a driver id names: its member id first, then its profile. */
export function roomMember(room: Pick<Room, 'members'>, id: string): RoomMember | undefined {
  const key = id.trim().toLowerCase()
  return room.members.find(m => m.memberId.toLowerCase() === key) ?? room.members.find(m => m.profile?.toLowerCase() === key)
}

const threadOf = (event: RoomEvent) => str(event.payload.thread_id) ?? ''
const discussionOf = (event: RoomEvent) => str(event.payload.discussion_event_id)

/**
 * Each thread's current discussion: its newest message's event id. A thread
 * whose message the kept events no longer hold takes the newest discussion
 * its events name, so a long discussion keeps its outcomes.
 */
export function currentDiscussions(events: readonly RoomEvent[]): Map<string, string> {
  const named = new Map<string, string>()
  const fromMessages = new Map<string, string>()
  for (const event of events) {
    if (event.kind === 'message.user' && event.eventId) fromMessages.set(threadOf(event), event.eventId)
    else {
      const id = discussionOf(event)
      if (id) named.set(threadOf(event), id)
    }
  }
  for (const [thread, id] of fromMessages) named.set(thread, id)
  return named
}

/**
 * Each member's status, by member id, as the phone (and Hermes Desktop's
 * group header) reads it: a pending approval, then a live turn (running or
 * stopping before queued), else the member's last outcome in its thread's
 * current discussion, later turns winning. A driver that reports idle has no
 * live turns, whatever rows it still lists; a host without `member_activity`
 * names its busy members as responding. A lead's routing turn (the task a
 * `room.assignment` names) is no reply or pass. A member with nothing to
 * show is absent.
 */
export function memberStatuses(room: Pick<Room, 'members'>, events: readonly RoomEvent[], status: Pick<DriverStatus, 'working' | 'busy' | 'activity' | 'approvals'>): Map<string, MemberStatus> {
  const statuses = new Map<string, MemberStatus>()
  const discussions = currentDiscussions(events)
  const routingTasks = new Set(events.flatMap(e => (e.kind === 'room.assignment' && str(e.payload.task_id) ? [str(e.payload.task_id)!] : [])))
  for (const event of events) {
    const task = str(event.payload.task_id)
    if (event.kind.startsWith('turn.') && task && routingTasks.has(task)) continue
    const memberId = str(event.payload.member_id)
    const discussion = discussionOf(event)
    if (!memberId || !discussion || discussion !== discussions.get(threadOf(event))) continue
    const member = roomMember(room, memberId)
    if (!member) continue
    let outcome: MemberStatus | null = null
    if (event.kind === 'turn.settled') outcome = event.payload.passed === true ? 'passed' : 'replied'
    else if (event.kind === 'turn.failed') outcome = 'failed'
    else if (event.kind === 'turn.cancelled') outcome = 'stopped'
    // The driver parks a member it can't reach; it runs again later.
    else if (event.kind === 'turn.deferred' && event.payload.reason === 'member_unavailable') outcome = 'unavailable'
    if (outcome) statuses.set(member.memberId, outcome)
  }
  if (status.working) {
    if (status.activity) {
      for (const row of status.activity) {
        const member = row.status === 'queued' ? roomMember(room, row.memberId) : undefined
        if (member) statuses.set(member.memberId, 'waiting')
      }
      for (const row of status.activity) {
        const member = row.status === 'running' || row.status === 'stopping' ? roomMember(room, row.memberId) : undefined
        if (member) statuses.set(member.memberId, 'responding')
      }
    } else {
      for (const id of status.busy) {
        const member = roomMember(room, id)
        if (member) statuses.set(member.memberId, 'responding')
      }
    }
  }
  for (const id of status.approvals) {
    const member = roomMember(room, id)
    if (member) statuses.set(member.memberId, 'needsApproval')
  }
  return statuses
}

/** The member whose pill carries the lead's crown: Who answers' lead, while it is Lead. */
export function leadMemberId(room: Pick<Room, 'members'>, context: RoomContext | undefined): string | undefined {
  if (!context || context.routing !== 'lead' || !context.leadMemberId.trim()) return undefined
  return roomMember(room, context.leadMemberId)?.memberId
}

/**
 * Whether the newest message's discussion settled, nobody having more to say
 * (its last `room.activity` is `settled`, with no Continue or Stop after it).
 * A message being sent starts the next one.
 */
export function latestDiscussionSettled(events: readonly RoomEvent[], sending = false): boolean {
  if (sending) return false
  let index = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.kind === 'message.user') {
      index = i
      break
    }
  }
  let discussion: string | undefined
  let start = 0
  if (index >= 0) {
    discussion = events[index]!.eventId
    start = index + 1
  } else {
    for (let i = events.length - 1; i >= 0 && !discussion; i--) discussion = discussionOf(events[i]!)
  }
  if (!discussion) return false
  let settled = false
  for (const event of events.slice(start)) {
    const ofIt = discussionOf(event) === discussion
    if (event.kind === 'room.activity' && ofIt) settled = event.payload.status === 'settled'
    else if ((event.kind === 'room.continued' && ofIt) || event.kind === 'room.stop_requested') settled = false
  }
  return settled
}

/** A bot's @handle in a room, as the phone gives it: its profile name, the default profile's "hermes". */
export function roomHandle(bot: Pick<Bot, 'name'>): string {
  const name = bot.name.trim()
  return name.toLowerCase() === 'default' ? 'hermes' : name
}

/** `groups.create`'s members, or null when two bots would claim the same handle. */
export function roomMembers(bots: readonly Pick<Bot, 'name' | 'title'>[]): Record<string, string>[] | null {
  const handles = bots.map(roomHandle)
  if (new Set(handles.map(h => h.toLowerCase())).size !== handles.length) return null
  return bots.map((bot, i) => ({ member_id: bot.name, profile: bot.name, handle: handles[i]!, display_name: bot.title }))
}

/** The name a room gets when none is typed: its bots' names. */
export function defaultRoomName(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? t('New room')
  if (titles.length === 2) return t('{a} & {b}', { a: titles[0]!, b: titles[1]! })
  return t('{a} & {b}', { a: titles.slice(0, -1).join(', '), b: titles[titles.length - 1]! })
}

/** The draft's members after a bot is dropped on another (or added by a click): in, once, up to six. */
export function addToDraft(draft: readonly string[], ...names: string[]): string[] {
  const next = [...draft]
  for (const name of names) {
    if (!next.includes(name) && next.length < ROOM_MAX_MEMBERS) next.push(name)
  }
  return next
}

/** The day line above a message whose day differs from the one before it (Today, Yesterday, else the date). */
export function dayLabel(at: number, now = Date.now()): string {
  const day = new Date(at)
  const today = new Date(now)
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(today) - start(day)) / 86_400_000)
  if (days === 0) return t('Today')
  if (days === 1) return t('Yesterday')
  return formatDate(day, { weekday: days < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Whether a day line goes above the message at `at`, after one at `previous`. */
export function startsNewDay(previous: number | undefined, at: number | undefined): boolean {
  if (at === undefined) return false
  if (previous === undefined) return true
  const a = new Date(previous)
  const b = new Date(at)
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate()
}
