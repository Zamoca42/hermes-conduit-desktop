/**
 * Rooms other people host, as this Hermes keeps a copy of each one its
 * agents joined (the phone's RoomCopies.swift): Group chats lists them in
 * their invites' place, and the room screen reads a copy's log as it reads
 * a room's own. The copies are the installation's: no profile goes with
 * these routes, except deleting an agent's chats for one.
 */

import { t } from '../../../shared/i18n'
import { logPage, type DriverStatus, type LogPage, type Room } from './groups'
import { MAILBOX_TIMEOUT_MS, ROOMS_PATH, type Http } from './roomLinks'

export const ROOM_COPIES_CAPABILITY = 'room-copies'
/** `DELETE /rooms/copies` and `DELETE /rooms/sessions`: an ended copy can be deleted. */
export const ROOM_FORGET_CAPABILITY = 'room-forget'
export const COPIES_PATH = `${ROOMS_PATH}/copies`
export const ROOM_SESSIONS_PATH = `${ROOMS_PATH}/sessions`
export const ROOM_PEOPLE_PATH = `${ROOMS_PATH}/people`
/** Posting in rooms other people host: `POST`/`GET /rooms/copies/messages`. */
export const ROOM_POSTS_CAPABILITY = 'room-posts'
export const POSTS_PATH = `${COPIES_PATH}/messages`
/** room_copies.MAX_LOG_LIMIT. */
export const MAX_COPY_LOG_LIMIT = 500

export interface RoomCopyMember {
  memberId: string
  handle?: string
  displayName?: string
  /** Whose agent it is, by the name the host's Link gives them; absent for the host's own. */
  owner?: string
}

export interface RoomCopy {
  /** The Link and the room, as its invite is keyed. */
  id: string
  roomId: string
  name: string
  link: string
  /** Who hosts it, by the name your Link shows them; empty for a Link without one. */
  from: string
  members: RoomCopyMember[]
  /** Your agents in it, while they are. */
  yours: { memberId: string; profile: string; handle?: string }[]
  /** You're in it with none of your agents. */
  justMe: boolean
  /** `started`, `left` (your agents left) or `ended`; a newer one is kept as it is. */
  status: string
  /** Why it ended: `disbanded`, `removed`, `left`. */
  reason: string | null
  working: boolean
  /** Each member's live turn. */
  activity: { memberId: string; status: string }[]
  lastSeq: number
  /** Unix seconds. */
  updatedAt: number
  /** Who left or was taken out, by member id. */
  out: Record<string, string>
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
/** A string with something in it. */
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function pairs(value: unknown): { memberId: string; status: string }[] {
  return (Array.isArray(value) ? value : []).flatMap(raw => {
    const memberId = text(obj(raw)?.member_id)
    const status = text(obj(raw)?.status)
    return memberId && status ? [{ memberId, status }] : []
  })
}

/** One copy; one without a room id, Link, name or status is left out rather than refusing the list. */
export function parseCopy(value: unknown): RoomCopy | null {
  const row = obj(value)
  const roomId = text(row?.room_id)
  const link = text(row?.link)
  const name = text(row?.name)
  const status = text(row?.status)
  if (!row || !roomId || !link || !name || !status) return null
  const members = (Array.isArray(row.members) ? row.members : []).flatMap((raw): RoomCopyMember[] => {
    const m = obj(raw)
    const memberId = text(m?.member_id)
    return m && memberId ? [{ memberId, handle: text(m.handle), displayName: text(m.display_name), owner: text(m.owner) }] : []
  })
  const yours = (Array.isArray(row.yours) ? row.yours : []).flatMap(raw => {
    const a = obj(raw)
    const memberId = text(a?.member_id)
    const profile = text(a?.profile)
    return a && memberId && profile ? [{ memberId, profile, handle: text(a.handle) }] : []
  })
  const out: Record<string, string> = {}
  for (const [id, how] of Object.entries(obj(row.out) ?? {})) if (typeof how === 'string') out[id] = how
  const state = obj(row.state) ?? {}
  return {
    id: `${link}/${roomId}`,
    roomId,
    name,
    link,
    from: typeof row.from === 'string' ? row.from : '',
    members,
    yours,
    justMe: row.just_me === true,
    status,
    reason: text(row.reason) ?? null,
    working: state.working === true,
    activity: pairs(state.activity),
    lastSeq: num(row.last_seq),
    updatedAt: num(row.updated_at),
    out
  }
}

/** `GET /rooms/copies`, the one that changed last first. */
export function parseCopies(value: unknown): RoomCopy[] | null {
  const row = obj(value)
  if (row?.ok !== true || !Array.isArray(row.copies)) return null
  return row.copies
    .map(parseCopy)
    .filter((c): c is RoomCopy => c !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** It ended, or your agents left: nothing more comes, and it can be deleted. */
export const isOver = (copy: RoomCopy) => copy.status === 'ended' || copy.status === 'left'

const hostOf = (copy: RoomCopy) => copy.from.trim()

/**
 * The room screen's room: your agents by their profiles, so they draw as
 * your bots; everyone else's on another Hermes, each with its owner, the
 * host for the host's own.
 */
export function copyRoom(copy: RoomCopy): Room {
  const host = hostOf(copy)
  return {
    roomId: copy.roomId,
    name: copy.name,
    members: copy.members.map(member => {
      const agent = copy.yours.find(a => a.memberId === member.memberId)
      return {
        memberId: member.memberId,
        profile: agent?.profile,
        handle: member.handle,
        displayName: member.displayName,
        ...(agent ? {} : { peer: true, owner: member.owner ?? (host || undefined) })
      }
    }),
    updatedAt: copy.updatedAt || undefined,
    latestSeq: copy.lastSeq,
    disbanded: isOver(copy),
    linked: true
  }
}

/** The copy's state as a room's driver status: working and each member's turn. Never approvals: those are the host's. */
export function copyStatus(copy: RoomCopy): DriverStatus {
  const busy = [...new Set(copy.activity.map(a => a.memberId))]
  return { working: copy.working || busy.length > 0, busy, disbanded: isOver(copy), activity: copy.activity, approvals: [] }
}

/** Group chats' line under its name: who hosts it and how it stands. */
export function copyLine(copy: RoomCopy): string {
  const host = hostOf(copy)
  if (copy.status === 'ended' && copy.reason === 'removed') {
    // The room goes on without your agents: it didn't end.
    return host ? t('{host} took your agents out', { host }) : t('Your agents were taken out')
  }
  if (copy.status === 'ended') return t('Ended')
  if (copy.status === 'left') return copy.justMe ? t('You left') : t('Your agents left')
  if (copy.working) return host ? t('Hosted by {host} · working…', { host }) : t('Hosted elsewhere · working…')
  return `${copyHost(copy)} · ${t('{count} members', { count: String(copy.members.length) })}`
}

/** "Hosted by Ana", the room screen's first line about it. */
export function copyHost(copy: RoomCopy): string {
  const host = hostOf(copy)
  return host ? t('Hosted by {host}', { host }) : t('Hosted elsewhere')
}

/** In the composer's place while it can't be posted in from here. */
export function copyReadOnly(copy: RoomCopy): string {
  const host = hostOf(copy)
  return host ? t('Hosted by {host}. You can read it here.', { host }) : t('Hosted elsewhere. You can read it here.')
}

/** A post as this Hermes keeps it: on its way to the host, in the room at its seq, or refused and why. */
export type RoomPostStatus = { kind: 'sending' } | { kind: 'posted'; seq: number } | { kind: 'refused'; error?: string }

export interface RoomPost {
  eventId: string
  text: string
  status: RoomPostStatus
}

/** One post; one without an event id or with a status this app can't place is left out. */
export function parsePost(value: unknown): RoomPost | null {
  const row = obj(value)
  const eventId = text(row?.event_id)
  if (!row || !eventId) return null
  const value_ = typeof row.text === 'string' ? row.text : ''
  if (row.status === 'sending') return { eventId, text: value_, status: { kind: 'sending' } }
  if (row.status === 'posted' && typeof row.seq === 'number') return { eventId, text: value_, status: { kind: 'posted', seq: row.seq } }
  if (row.status === 'refused') return { eventId, text: value_, status: { kind: 'refused', error: text(row.error) } }
  return null
}

/** Whether the copy takes your posts: still going, with an agent of yours in it or you in it with Just me. */
export const takesPosts = (copy: RoomCopy, canPost: boolean) => canPost && copy.status === 'started' && (copy.yours.length > 0 || copy.justMe)

/** Why a post wasn't posted. */
export function postRefusal(error?: string): string {
  switch (error) {
    case 'ended':
      return t('Not posted: the room has ended.')
    case 'not_in':
      return t("Not posted: your agents aren't in this room.")
    case 'too_long':
      return t("Not posted: it's too long for this room.")
    case 'too_many':
      return t('Not posted: too many posts this hour. Try again later.')
    case 'unavailable':
      return t("Not posted: the host's Hermes couldn't take it. Try again.")
    case 'bad_post':
      return t("Not posted: the host's Hermes couldn't read it.")
    default:
      return t('Not posted.')
  }
}

/** Whether posting it again could go differently. */
export const postRetries = (error?: string) => !['ended', 'not_in', 'too_long', 'bad_post'].includes(error ?? '')

/**
 * A post of yours not yet in the room's log, as its row shows it: on its
 * way, not delivered (the request failed, so it may not have reached your
 * Hermes), refused with why, or closed: the room takes no more posts, so
 * it can only be copied and dismissed.
 */
export type PostRow =
  | { state: 'sending' }
  | { state: 'notDelivered' }
  | { state: 'refused'; why: string; retry: boolean }
  | { state: 'closed'; why: string }

export function postRow(post: RoomPost | undefined, inFlight: boolean, copy: RoomCopy, canPost: boolean): PostRow {
  if (inFlight) return { state: 'sending' }
  if (!takesPosts(copy, canPost)) {
    // A refusal's reason stands, whatever the room does now.
    if (post?.status.kind === 'refused') return { state: 'closed', why: postRefusal(post.status.error) }
    if (post?.status.kind === 'sending' && canPost) return { state: 'sending' }
    return { state: 'closed', why: postRefusal(isOver(copy) && copy.status === 'ended' ? 'ended' : 'not_in') }
  }
  if (!post) return { state: 'notDelivered' }
  if (post.status.kind === 'refused') return { state: 'refused', why: postRefusal(post.status.error), retry: postRetries(post.status.error) }
  return { state: 'sending' }
}

const query = (value: string) => encodeURIComponent(value)

/** The plugin's copies routes over the dashboard. */
export function roomCopiesClient(http: Http) {
  return {
    list: async (): Promise<RoomCopy[]> => {
      const copies = parseCopies(await http('GET', COPIES_PATH))
      if (!copies) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
      return copies
    },
    /** The copy's events after `sinceSeq`, as a `groups.log` page. */
    log: async (roomId: string, sinceSeq: number, limit = 200): Promise<LogPage> => {
      const bounded = Math.min(Math.max(1, limit), MAX_COPY_LOG_LIMIT)
      const body = await http('GET', `${COPIES_PATH}/log?room_id=${query(roomId)}&since_seq=${Math.max(0, sinceSeq)}&limit=${bounded}`)
      const page = obj(body)?.ok === true ? logPage(body) : null
      if (!page) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
      return page
    },
    /** What the host calls you, to take your name off your own posts. */
    you: async (roomId: string): Promise<string | undefined> => text(obj(await http('GET', `${ROOM_PEOPLE_PATH}?room_id=${query(roomId)}`))?.you),
    /** Deletes `profile`'s hidden chats for the room. */
    forgetSessions: async (roomId: string, profile: string): Promise<void> => {
      const path = `${ROOM_SESSIONS_PATH}?room_id=${query(roomId)}${profile && profile !== 'default' ? `&profile=${query(profile)}` : ''}`
      if (obj(await http('DELETE', path))?.ok !== true) throw new Error(t('Could not delete this room'))
    },
    /** Posts `text` under `eventId`, the retry key: the same id again is the same post. */
    post: async (roomId: string, eventId: string, value: string): Promise<RoomPost> => {
      const body = obj(await http('POST', POSTS_PATH, { room_id: roomId, event_id: eventId, text: value }, MAILBOX_TIMEOUT_MS))
      const post = body?.ok === true ? parsePost(body.message) : null
      if (!post) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
      return post
    },
    /** What you posted in the room, oldest first. */
    posts: async (roomId: string): Promise<RoomPost[]> => {
      const body = obj(await http('GET', `${POSTS_PATH}?room_id=${query(roomId)}`))
      if (body?.ok !== true || !Array.isArray(body.messages)) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
      return body.messages.map(parsePost).filter((p): p is RoomPost => p !== null)
    },
    /** Deletes the copy. */
    forget: async (roomId: string): Promise<void> => {
      if (obj(await http('DELETE', `${COPIES_PATH}?room_id=${query(roomId)}`))?.ok !== true) throw new Error(t('Could not delete this room'))
    }
  }
}

export type RoomCopiesClient = ReturnType<typeof roomCopiesClient>
