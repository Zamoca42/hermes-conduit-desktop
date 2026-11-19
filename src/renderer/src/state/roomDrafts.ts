/**
 * Rooms with people you've linked, before they start (the phone's
 * RoomDrafts.swift): New Group Chat with linked people makes a draft on this
 * Hermes, which sends each of them an invite over their Link and starts the
 * room once they've all answered, or with Start now. A started draft is its
 * room, which `groups.list` shows under the same id; until then the draft is
 * a tile in Group chats, and one that ended says why until it's removed.
 */

import { locale, t } from '../../../shared/i18n'
import { roomHandle } from './groups'
import { MAILBOX_TIMEOUT_MS, ROOMS_PATH, type Http } from './roomLinks'

/** The drafts routes are the invites' feature. */
export const ROOM_DRAFTS_CAPABILITY = 'room-invites'
export const DRAFTS_PATH = `${ROOMS_PATH}/drafts`
export const DISMISSED_DRAFTS_KEY = 'conduit.roomDrafts.dismissed'

/** New Group Chat's limits: 2 to 6 of your bots, or with people, at least one bot and a place for each person, up to 6 agents and 5 people. */
export const MAX_AGENTS = 6
export const MAX_PEOPLE = 5

export const canCreateGroup = (bots: number, people: number) =>
  people > 0 ? bots >= 1 && people <= MAX_PEOPLE && bots + people <= MAX_AGENTS : bots >= 2 && bots <= MAX_AGENTS
export const canPickBot = (bots: number, people: number) => bots + people < MAX_AGENTS
export const canPickPerson = (bots: number, people: number) => people < MAX_PEOPLE && bots + people < MAX_AGENTS

export interface DraftPerson {
  /** The Link's id. */
  link: string
  name: string
  /** `waiting`, `joined`, `declined` or `left`; a newer one is kept as it is and shown with none. */
  status: string
  /** The names of the agents they joined with. */
  agents: string[]
  /** In it with none of their agents ("Just me"). */
  justMe: boolean
}

export interface RoomDraft {
  /** The room's id, which the room keeps once it starts. */
  id: string
  name: string
  /** `waiting`, `starting`, `started` or `ended`. */
  status: string
  /** Why it ended: `withdrawn`, `lapsed`, `too_few`, `start_failed`, or `disbanded`. */
  reason: string | null
  /** Unix seconds: when the invites run out. */
  expiresAt: number | null
  /** The names of your agents in it. */
  agents: string[]
  people: DraftPerson[]
}

export interface RoomDraftsList {
  /** Newest first. */
  drafts: RoomDraft[]
  /** False on a Hermes the plugin can't start rooms with linked people on. */
  startsAvailable: boolean
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const names = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).flatMap(raw => (typeof obj(raw)?.display_name === 'string' ? [obj(raw)!.display_name as string] : []))

/** One draft; one without an id, name or status is left out rather than refusing the list. */
export function parseDraft(value: unknown): RoomDraft | null {
  const row = obj(value)
  const id = nonEmpty(row?.room_id)
  const status = nonEmpty(row?.status)
  if (!row || !id || typeof row.name !== 'string' || !status) return null
  const people = (Array.isArray(row.people) ? row.people : []).flatMap((raw): DraftPerson[] => {
    const p = obj(raw)
    const link = nonEmpty(p?.link)
    if (!p || !link || typeof p.name !== 'string' || typeof p.status !== 'string') return []
    return [{ link, name: p.name, status: p.status, agents: names(p.agents), justMe: p.just_me === true }]
  })
  return {
    id,
    name: row.name,
    status,
    reason: nonEmpty(row.reason),
    expiresAt: typeof row.expires_at === 'number' ? row.expires_at : null,
    agents: names(row.agents),
    people
  }
}

export function parseDrafts(value: unknown): RoomDraftsList | null {
  const row = obj(value)
  const starts = obj(row?.starts)
  if (row?.ok !== true || !Array.isArray(row.drafts) || !starts) return null
  return { drafts: row.drafts.map(parseDraft).filter((d): d is RoomDraft => d !== null), startsAvailable: starts.available === true }
}

/** Group chats' drafts: those waiting or starting, and those that ended until removed. A started one is its room's tile. */
export function draftRows(drafts: readonly RoomDraft[], dismissed: ReadonlySet<string>): RoomDraft[] {
  return drafts.filter(draft => {
    if (draft.status === 'waiting' || draft.status === 'starting') return true
    if (draft.status === 'ended') return draft.reason !== 'disbanded' && !dismissed.has(draft.id)
    return false
  })
}

export const waitingFor = (draft: RoomDraft) => draft.people.filter(p => p.status === 'waiting')
export const joinedBy = (draft: RoomDraft) => draft.people.filter(p => p.status === 'joined')

/** Start now makes a room: someone hasn't answered, and someone joined or two of your agents are in it. */
export const canStartNow = (draft: RoomDraft) =>
  draft.status === 'waiting' && waitingFor(draft).length > 0 && (joinedBy(draft).length > 0 || draft.agents.length >= 2)

/** "Mona and Kazuha", in the app's language. */
export function namesList(list: readonly string[]): string {
  try {
    return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(list)
  } catch {
    return list.join(', ')
  }
}

/** Who it waits for, that it's starting, or why it ended. */
export function draftLine(draft: RoomDraft): string {
  if (draft.status === 'ended') {
    switch (draft.reason) {
      case 'lapsed':
        return t('The invites ran out before everyone answered')
      case 'too_few':
        return t("Nobody else joined, so it didn't start")
      case 'start_failed':
        return t("Your Hermes couldn't start it")
      case 'withdrawn':
        return t('You took it back')
      default:
        return t('It ended before it started')
    }
  }
  if (draft.status === 'waiting') {
    const waiting = waitingFor(draft)
    // Everyone answered: the rooms loop starts it on its next pass.
    if (!waiting.length) return t('Starting…')
    const joined = joinedBy(draft)
    const who = namesList(waiting.map(p => p.name))
    return joined.length ? t('{joined} joined, waiting for {waiting}', { joined: namesList(joined.map(p => p.name)), waiting: who }) : t('Waiting for {waiting}', { waiting: who })
  }
  return t('Starting…')
}

/** How someone answered; null for a status a newer plugin adds. */
export function personStatus(person: DraftPerson): string | null {
  switch (person.status) {
    case 'joined':
      return person.justMe ? t('Joined without their bots') : t('Joined with {names}', { names: namesList(person.agents) })
    case 'left':
      return t('Left')
    case 'waiting':
      return t("Hasn't answered yet")
    case 'declined':
      return t('Declined')
    default:
      return null
  }
}

/** Your bots as a draft's agents, with the handles a room of your own bots gives them; null when two would claim one. Choices null: the plugin gives each those of its last room with the same people, else its defaults. */
export function draftAgents(bots: readonly { name: string; title: string }[]): Row[] | null {
  const handles = bots.map(roomHandle)
  if (new Set(handles.map(h => h.toLowerCase())).size !== handles.length) return null
  return bots.map((bot, i) => ({ profile: bot.name, handle: handles[i], display_name: bot.title, choices: null }))
}

export type DraftCreation = { kind: 'made'; draft: RoomDraft } | { kind: 'sending' }

const unexpected = () => new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))

/**
 * The plugin's drafts routes. They take no profile but a new draft's, whose
 * room service the room starts in (`?conduit_profile=` where the plugin
 * reports room-dashboard-profiles). Making one and taking one back wait on
 * the rooms mailbox.
 */
export function roomDraftsClient(http: Http) {
  const draftOf = (body: unknown) => {
    const draft = obj(body)?.ok === true ? parseDraft(obj(body)!.draft) : null
    if (!draft) throw unexpected()
    return draft
  }
  return {
    list: async (): Promise<RoomDraftsList> => {
      const list = parseDrafts(await http('GET', DRAFTS_PATH))
      if (!list) throw unexpected()
      return list
    },
    /** A room with the people of `links` and your `agents`; a 504 is a draft made with its invites still going out. */
    create: async (name: string, agents: Row[], links: string[], profile: string, conduitProfile: boolean): Promise<DraftCreation> => {
      const scoped = profile && profile !== 'default' ? `?${conduitProfile ? 'conduit_profile' : 'profile'}=${encodeURIComponent(profile)}` : ''
      try {
        return { kind: 'made', draft: draftOf(await http('POST', `${DRAFTS_PATH}${scoped}`, { name, agents, links }, MAILBOX_TIMEOUT_MS)) }
      } catch (error) {
        if ((error as { code?: unknown })?.code === 504) return { kind: 'sending' }
        throw error
      }
    },
    /** Start now: the room starts with whoever joined on the rooms loop's next pass. */
    start: async (roomId: string) => draftOf(await http('POST', `${DRAFTS_PATH}/start`, { room_id: roomId })),
    /** Take back: everyone invited who hasn't declined is told. */
    withdraw: async (roomId: string) => draftOf(await http('DELETE', `${DRAFTS_PATH}?room_id=${encodeURIComponent(roomId)}`, undefined, MAILBOX_TIMEOUT_MS))
  }
}
