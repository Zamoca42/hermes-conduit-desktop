/**
 * Group chats: the rooms Hermes hosts (`groups.*`, the gateway's room API).
 * A room has 2 to 6 bots, an append-only log read in pages by `since_seq`,
 * and a driver that runs the bots' turns on the host, so a room keeps going
 * with no window open. Read the phone's GroupChatModels.swift for the rest.
 */
import type { Bot } from './bots'
import { locale, t } from '../../../shared/i18n'

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
    maxLogLimit: int(obj(result)?.max_log_limit)
  }
}

export function roomFromWire(value: unknown): Room | null {
  const row = obj(value)
  const roomId = str(row?.room_id)
  if (!row || !roomId) return null
  const members: RoomMember[] = []
  for (const raw of Array.isArray(row.members) ? row.members : []) {
    const m = obj(raw)
    const memberId = str(m?.member_id) ?? str(m?.profile)
    if (!m || !memberId) continue
    members.push({ memberId, profile: str(m.profile), handle: str(m.handle), displayName: str(m.display_name) })
  }
  return {
    roomId,
    name: str(row.name) ?? roomId,
    members,
    updatedAt: seconds(row.updated_at) ?? seconds(row.created_at),
    latestSeq: int(row.latest_seq),
    disbanded: typeof row.disbanded_at === 'number'
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
  | { kind: 'user'; key: string; text: string; at?: number; pending?: boolean; failed?: boolean }
  | { kind: 'member'; key: string; text: string; memberId: string; name: string; at?: number }
  | { kind: 'note'; key: string; text: string; tone?: 'error' }

function memberName(room: Room | null, memberId: string, fallback?: string): string {
  const member = room?.members.find(m => m.memberId === memberId)
  return member?.displayName ?? fallback ?? member?.profile ?? memberId
}

/** What a room's log shows: the user's and the bots' messages, and a line when a bot's turn failed. */
export function roomItems(room: Room | null, events: readonly RoomEvent[]): RoomItem[] {
  const items: RoomItem[] = []
  for (const event of events) {
    const text = typeof event.payload.text === 'string' ? event.payload.text : ''
    if (event.kind === 'message.user') {
      if (text.trim()) items.push({ kind: 'user', key: event.eventId, text, at: event.createdAt })
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
    }
  }
  return items
}

export interface DriverStatus {
  working: boolean
  /** The members taking a turn now. */
  busy: string[]
  disbanded: boolean
}

export function driverStatus(result: unknown): DriverStatus {
  const row = obj(result)
  const driver = obj(row?.driver_status)
  const busy: string[] = []
  for (const raw of Array.isArray(driver?.member_activity) ? (driver!.member_activity as unknown[]) : []) {
    const id = str(obj(raw)?.member_id)
    if (id && !busy.includes(id)) busy.push(id)
  }
  return { working: driver?.working === true || busy.length > 0, busy, disbanded: typeof obj(row?.room)?.disbanded_at === 'number' }
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
  return day.toLocaleDateString(locale(), { weekday: days < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Whether a day line goes above the message at `at`, after one at `previous`. */
export function startsNewDay(previous: number | undefined, at: number | undefined): boolean {
  if (at === undefined) return false
  if (previous === undefined) return true
  const a = new Date(previous)
  const b = new Date(at)
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate()
}
