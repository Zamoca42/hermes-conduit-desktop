/**
 * Rooms with people you've linked, from the invited side, after the phone's
 * RoomInvites.swift: someone you've linked invites this Hermes to a room
 * they host, over your Link. The invite shows in Group chats until it's
 * answered and after, and its join card brings your bots, each with its
 * choices for the room, joins with none of them (Just me), or declines. The
 * plugin keeps the invites for the whole installation and sends the answer
 * to the host over the rooms mailbox.
 */
import { locale, t } from '../../../shared/i18n'
import { roomHandle } from './groups'
import { MAILBOX_TIMEOUT_MS, ROOMS_PATH, type Http } from './roomLinks'

export const ROOM_INVITES_CAPABILITY = 'room-invites'
/** POST /rooms/invites/remove (plugin 0.177.23). */
export const ROOM_INVITES_REMOVE_CAPABILITY = 'room-invites-remove'
/** Use my data says when you're busy: offered only on a plugin that has it. */
export const FREE_BUSY_CAPABILITY = 'room-free-busy'
export const INVITES_PATH = `${ROOMS_PATH}/invites`
/** A room has 6 agents, the host's at least one of them. */
export const MAX_JOINING = 5
/** Invites removed on this computer, for a plugin before room-invites-remove. */
export const DISMISSED_KEY = 'conduit.roomInvites.dismissed'

/** What the plugin holds an agent to in one room (room_choices.py). */
export interface RoomChoices {
  /** `talk`, `look`, `data` or `custom`. */
  tools: string
  customTools: string[]
  /** `helps`, `ask` or `nothing`. */
  share: string
  searchChats: boolean
  /** `joins`, `asked` or `listens`. */
  takesPart: string
  dailyLimit: number
  note: string
  /** Run work, from a plugin that has it; null otherwise. */
  runWork: boolean | null
}

export interface InviteAgent {
  profile: string
  displayName: string
}

export interface RoomInvite {
  /** The Link and the room: the same room over another Link is another invite. */
  id: string
  link: string
  roomId: string
  /** Who invited you, by the name the Link shows them; empty for a Link without one. */
  from: string
  name: string
  people: string[]
  hostAgents: string[]
  /** How many of your agents it has places for. */
  places: number
  /** Unix seconds. */
  expiresAt: number | null
  /** `waiting`, `joined`, `declined`, `started`, `cancelled`, `left`, `ended` or `lapsed`; a newer one is kept as it is. */
  status: string
  reason: string | null
  joined: InviteAgent[]
  /** The profiles that can join, in the plugin's order. */
  profiles: string[]
  /** Each profile's choices: those of its last room with the same people, else its defaults. */
  choices: Record<string, RoomChoices>
  justMe: boolean
  justMeOffered: boolean
  removed: boolean
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])

/** Choices as the plugin shows them, or null without the three every plugin sends. */
export function parseChoices(value: unknown): RoomChoices | null {
  const o = obj(value)
  if (!o || typeof o.tools !== 'string' || typeof o.share !== 'string' || typeof o.search_chats !== 'boolean') return null
  return {
    tools: o.tools,
    customTools: strings(o.custom_tools),
    share: o.share,
    searchChats: o.search_chats,
    takesPart: str(o.takes_part) ?? 'joins',
    dailyLimit: typeof o.daily_limit === 'number' && Number.isInteger(o.daily_limit) ? o.daily_limit : 40,
    note: str(o.note) ?? '',
    runWork: typeof o.run_work === 'boolean' ? o.run_work : null
  }
}

/** Every choice, as the plugin takes them; Run work only from a plugin that sent it. */
export function choicesBody(choices: RoomChoices): Row {
  const body: Row = {
    tools: choices.tools,
    custom_tools: choices.customTools,
    share: choices.share,
    search_chats: choices.searchChats,
    takes_part: choices.takesPart,
    daily_limit: choices.dailyLimit,
    note: choices.note
  }
  if (choices.runWork !== null) body.run_work = choices.runWork
  return body
}

const agents = (value: unknown): InviteAgent[] =>
  (Array.isArray(value) ? value : []).flatMap(a => {
    const o = obj(a)
    const profile = str(o?.profile)
    const displayName = str(o?.display_name)
    return profile !== null && displayName !== null ? [{ profile, displayName }] : []
  })

/** An invite the list can't show (no room, Link, name or status) is left out. */
export function parseInvite(value: unknown): RoomInvite | null {
  const o = obj(value)
  const roomId = str(o?.room_id)
  const link = str(o?.link)
  const name = str(o?.name)
  const status = str(o?.status)
  if (!o || !roomId || !link || name === null || !status) return null
  const profiles: string[] = []
  const choices: Record<string, RoomChoices> = {}
  for (const entry of Array.isArray(o.profiles) ? o.profiles : []) {
    const profile = str(obj(entry)?.profile)
    const read = parseChoices(obj(entry)?.choices)
    if (!profile || !read || choices[profile]) continue
    profiles.push(profile)
    choices[profile] = read
  }
  const expires = o.expires_at
  return {
    id: `${link}/${roomId}`,
    link,
    roomId,
    from: str(o.from) ?? '',
    name,
    people: strings(o.people),
    hostAgents: (Array.isArray(o.agents) ? o.agents : []).flatMap(a => {
      const n = str(obj(a)?.display_name)
      return n === null ? [] : [n]
    }),
    places: typeof o.slots === 'number' && Number.isInteger(o.slots) ? o.slots : 0,
    expiresAt: typeof expires === 'number' && expires > 0 ? expires : null,
    status,
    reason: str(o.reason) || null,
    joined: agents(o.joined),
    profiles,
    choices,
    justMe: o.just_me === true,
    justMeOffered: o.just_me_offered === true,
    removed: o.removed === true
  }
}

export function parseInvites(body: unknown): RoomInvite[] {
  const o = obj(body)
  if (o?.ok !== true || !Array.isArray(o.invites)) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
  return o.invites.map(parseInvite).filter((i): i is RoomInvite => i !== null)
}

/** What Group chats lists: those waiting on you or the room, and those that ended, until removed. */
export function inviteRows(invites: readonly RoomInvite[], dismissed: ReadonlySet<string>): RoomInvite[] {
  return invites.filter(invite => {
    if (invite.status === 'waiting' || invite.status === 'joined') return true
    if (['started', 'cancelled', 'lapsed', 'ended'].includes(invite.status)) return !invite.removed && !dismissed.has(invite.id)
    return false
  })
}

/** One waiting on you or on the room stays. */
export const canRemove = (invite: RoomInvite) => invite.status !== 'waiting' && invite.status !== 'joined'

export const canPick = (picked: number, places: number) => picked < Math.min(places, MAX_JOINING)
export const canJoin = (picked: number, places: number) => picked >= 1 && picked <= Math.min(places, MAX_JOINING)

/** Your bots joining, with the handles a room of your own bots gives them; null when two would claim one handle or one has no choices. */
export function joiningAgents(bots: readonly { name: string; title: string }[], choices: Record<string, RoomChoices>): Row[] | null {
  const handles = bots.map(roomHandle)
  if (new Set(handles.map(h => h.toLowerCase())).size !== handles.length) return null
  const out: Row[] = []
  for (const [i, bot] of bots.entries()) {
    const chosen = choices[bot.name]
    if (!chosen) return null
    out.push({ profile: bot.name, handle: handles[i], display_name: bot.title, choices: choicesBody(chosen) })
  }
  return out
}

/** The turns a day the card offers, with `value` among them when it's another. */
export const dailyLimitSteps = (value: number): number[] => [...new Set([5, 10, 20, 40, 80, 150, 300, 500, value])].sort((a, b) => a - b)

export const names = (list: readonly string[]): string => {
  try {
    return new Intl.ListFormat(locale(), { type: 'conjunction' }).format(list)
  } catch {
    return list.join(', ')
  }
}

/** When invites run out: they run for a week, so the day comes with the time. */
export const until = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export const sender = (invite: RoomInvite) => invite.from || t("Someone you've linked with")

/** Who invited you, where the invite stands, or why it ended. */
export function inviteLine(invite: RoomInvite): string {
  const from = sender(invite)
  switch (invite.status) {
    case 'waiting':
      return t('{name} invited you', { name: from })
    case 'joined':
      return t('You joined, waiting for the room to start')
    case 'started':
      return invite.justMe ? t("Started, and you're in it without your agents") : t('Started with your agents in it')
    case 'lapsed':
      return t('The invite ran out')
    case 'declined':
      return t('You declined')
    case 'left':
      return invite.justMe ? t('You left') : t('Your agents left')
    case 'cancelled':
      switch (invite.reason) {
        case 'withdrawn':
          return t('{name} took it back', { name: from })
        case 'lapsed':
          return t('It ran out before the room started')
        case 'too_few':
          return t("Too few joined, so it didn't start")
        case 'start_failed':
          return t("Their Hermes couldn't start it")
        case 'refused':
          return t("It started, but your agents couldn't be added")
        case 'started_without_you':
          return t('It started without you')
        default:
          return t('It was called off')
      }
    case 'ended':
      if (invite.reason === 'removed') return t('{name} took your agents out', { name: from })
      if (invite.reason === 'disbanded') return t('{name} ended the room', { name: from })
      return t('It ended')
    default:
      return t('It ended')
  }
}

/** A row's line: one waiting on you says until when. */
export function inviteRowLine(invite: RoomInvite): string {
  if (invite.status !== 'waiting' || invite.expiresAt === null) return inviteLine(invite)
  return t('{name} invited you, answer by {date}', { name: sender(invite), date: until(invite.expiresAt) })
}

export const toolsLabel = (tools: string) =>
  ({ talk: t('Talk only'), look: t('Look things up'), data: t('Use my data'), custom: t('Custom') })[tools] ?? ''
export const shareLabel = (share: string) => ({ helps: t('What helps'), ask: t('Ask me first'), nothing: t('Nothing personal') })[share] ?? ''
export const takesPartLabel = (takesPart: string) => ({ joins: t('Joins in'), asked: t('When asked'), listens: t('Listens only') })[takesPart] ?? ''

/** The card's line under a bot brought: each choice, briefly. */
export function choicesSummary(choices: RoomChoices): string {
  return [toolsLabel(choices.tools), shareLabel(choices.share), takesPartLabel(choices.takesPart), t('Turns a day: {count}', { count: choices.dailyLimit })]
    .filter(Boolean)
    .join(' · ')
}

export function toolsDetail(choices: RoomChoices, freeBusy: boolean): string {
  switch (choices.tools) {
    case 'talk':
      return t('It answers from what it knows, without tools.')
    case 'data':
      if (freeBusy)
        return t(
          "It can search the web and X, read web pages and look at images, and say when you're busy from the calendar you share with Hermes: only the times, never what, where or with whom, as What it may share allows."
        )
      return t('It can search the web and X, read web pages and look at images.')
    case 'look':
      return t('It can search the web and X, read web pages and look at images.')
    case 'custom':
      return choices.customTools.length
        ? t('Only the tools picked on your Hermes: {tools}', { tools: choices.customTools.join(', ') })
        : t('No tools are picked for it on your Hermes.')
    default:
      return ''
  }
}

export function shareDetail(share: string): string {
  switch (share) {
    case 'helps':
      return t('What helps the room, but nothing sensitive: no health, money, passwords, or what others told you in private.')
    case 'ask':
      return t('Before it shares anything personal, it asks you in Conduit.')
    case 'nothing':
      return t('It shares nothing personal about you, even when asked.')
    default:
      return ''
  }
}

export function takesPartDetail(takesPart: string): string {
  switch (takesPart) {
    case 'joins':
      return t('It takes its turns in the room as the other agents do.')
    case 'asked':
      return t('It answers only when a new message @mentions it, or @all.')
    case 'listens':
      return t('It reads along but never answers.')
    default:
      return ''
  }
}

export type Answering = { kind: 'answered'; invite: RoomInvite } | { kind: 'refused'; message: string } | { kind: 'sending'; message: string }

/** The plugin's invites routes. They take no profile: the invites are the installation's. */
export function roomInvitesClient(http: Http) {
  return {
    list: async () => parseInvites(await http('GET', INVITES_PATH)),
    /** Joins with `agents`, joins with none (`justMe`), or declines. A 504 is an answer still on its way. */
    answer: async (invite: RoomInvite, joining: Row[], justMe = false): Promise<Answering> => {
      const body: Row = { link: invite.link, room_id: invite.roomId, agents: joining }
      if (justMe) body.just_me = true
      const going = joining.length > 0 || justMe
      try {
        const answered = parseInvite(obj(await http('POST', `${INVITES_PATH}/answer`, body, MAILBOX_TIMEOUT_MS))?.invite)
        if (!answered) throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
        return { kind: 'answered', invite: answered }
      } catch (error) {
        if ((error as { code?: unknown })?.code === 504)
          return { kind: 'sending', message: t('Your Hermes is still sending your answer. The invite shows it once it has.') }
        const words = error instanceof Error ? error.message : String(error)
        return { kind: 'refused', message: going ? t('Could not join: {error}', { error: words }) : t('Could not decline: {error}', { error: words }) }
      }
    },
    /** Takes a finished invite off Group chats on the Hermes, for every device. */
    remove: async (invite: RoomInvite) => parseInvite(obj(await http('POST', `${INVITES_PATH}/remove`, { link: invite.link, room_id: invite.roomId }))?.invite)
  }
}
