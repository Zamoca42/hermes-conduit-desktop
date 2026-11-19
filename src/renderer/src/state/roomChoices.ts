/**
 * Group Info's people in a room with other people's agents (the phone's
 * RoomChoices.swift, RoomLeave.swift and GroupRoomInfoView's members):
 * each of your agents' choices for the room, which the plugin keeps per
 * profile and holds it to (`/rooms/choices`, room-rules), and taking an
 * agent out: another person's from a room you host
 * (`/rooms/drafts/remove`), or yours from a room someone else hosts
 * (`/rooms/leave` with its profile), room-leave.
 */

import { t } from '../../../shared/i18n'
import { parseChoices, type RoomChoices } from './roomInvites'
import { MAILBOX_TIMEOUT_MS, ROOMS_PATH, type Http } from './roomLinks'
import type { RoomMember } from './groups'

export const ROOM_RULES_CAPABILITY = 'room-rules'
export const CHOICES_PATH = `${ROOMS_PATH}/choices`
export const REMOVE_PATH = `${ROOMS_PATH}/drafts/remove`
/** The plugin counts a note's code points. */
export const NOTE_LIMIT = 1000

/** Choices as Group Info shows them: `saved` false while the room has none of its own, only the agent's defaults. */
export type AgentChoices = RoomChoices & { saved: boolean }

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const withProfile = (path: string, profile: string) =>
  profile && profile !== 'default' ? `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}` : path

/** A read's or change's answer, for `roomId`; null for one that isn't ok, names another room, or lacks the three every plugin sends. */
export function parseAgentChoices(value: unknown, roomId: string): AgentChoices | null {
  const row = obj(value)
  if (row?.ok !== true || (row.room_id !== undefined && row.room_id !== roomId)) return null
  const choices = parseChoices(row.choices)
  // A change's answer has no `saved`: once a choice is set, the room has its own.
  return choices ? { ...choices, saved: row.saved === false ? false : true } : null
}

/** The note cut to the plugin's limit, after the last whole character that fits. */
export function clippedNote(text: string): string {
  const points = Array.from(text)
  return points.length > NOTE_LIMIT ? points.slice(0, NOTE_LIMIT).join('') : text
}

const unexpected = () => new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))

export function roomChoicesClient(http: Http) {
  return {
    read: async (roomId: string, profile: string): Promise<AgentChoices> => {
      const choices = parseAgentChoices(await http('GET', withProfile(`${CHOICES_PATH}?room_id=${encodeURIComponent(roomId)}`, profile)), roomId)
      if (!choices) throw unexpected()
      return choices
    },
    /** Sends only what changed; gives what the plugin kept. */
    set: async (roomId: string, profile: string, changes: Row): Promise<AgentChoices> => {
      const choices = parseAgentChoices(await http('PUT', withProfile(CHOICES_PATH, profile), { room_id: roomId, choices: changes }), roomId)
      if (!choices) throw unexpected()
      return choices
    },
    /** Another person's agent out of a room you host. A 504 is one still on its way, which may be made. */
    remove: async (roomId: string, memberId: string): Promise<'done' | 'sending'> => {
      try {
        if (obj(await http('POST', REMOVE_PATH, { room_id: roomId, member: memberId }, MAILBOX_TIMEOUT_MS))?.ok !== true) throw unexpected()
        return 'done'
      } catch (error) {
        if ((error as { code?: unknown })?.code === 504) return 'sending'
        throw error
      }
    }
  }
}

/** Who can be taken out: another person's agent still in a room you host, or your own still in a copy that goes on. */
export function canTakeOut(member: RoomMember, copy: { over: boolean } | null): boolean {
  if (member.out || !member.memberId) return false
  if (copy) return !copy.over && !member.peer && !!member.profile?.trim()
  return !!member.peer
}

export const takeOutTitle = (name: string) => t('Take {name} out of this room?', { name })

/** What a Take Out does: in a room you host, whose Hermes is told; in a copy, the host is. */
export function takeOutMessage(name: string, member: RoomMember, host: string | null): string {
  if (host !== null) {
    const who = host.trim()
    return who ? t('{name} stops taking part, and {host} is told.', { name, host: who }) : t('{name} stops taking part, and the host is told.', { name })
  }
  const owner = member.owner?.trim()
  return owner ? t("{name} stops taking part, and {owner}'s Hermes is told.", { name, owner }) : t('{name} stops taking part, and their Hermes is told.', { name })
}

export const toolsLabel = (tools: string) =>
  tools === 'talk' ? t('Talk only') : tools === 'look' ? t('Look things up') : tools === 'data' ? t('Use my data') : tools === 'custom' ? t('Custom') : ''

export interface RoomPerson {
  /** Whose agent it is, for another person's. */
  owner?: string
  /** It left (`left`) or was taken out (`removed`). */
  out?: string
}

/** Who's who in a room this Hermes hosts with linked people (`GET /rooms/people`): each member by id. */
export function parsePeople(value: unknown): Map<string, RoomPerson> {
  const people = new Map<string, RoomPerson>()
  const row = obj(value)
  if (row?.ok !== true || !Array.isArray(row.members)) return people
  for (const raw of row.members) {
    const member = obj(raw)
    const id = typeof member?.member_id === 'string' ? member.member_id : ''
    if (!member || !id) continue
    const owner = typeof member.owner === 'string' ? member.owner.trim() : ''
    const out = member.status === 'left' || member.status === 'removed' ? member.status : undefined
    people.set(id, { ...(owner ? { owner } : {}), ...(out ? { out } : {}) })
  }
  return people
}

/** The room's members with who's who folded in. */
export const withPeople = (members: readonly RoomMember[], people: Map<string, RoomPerson>): RoomMember[] =>
  people.size ? members.map(m => ({ ...m, ...(people.get(m.memberId) ?? {}) })) : [...members]
