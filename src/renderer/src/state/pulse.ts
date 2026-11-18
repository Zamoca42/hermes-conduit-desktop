/**
 * The Pulse screen, after the phone's (PulseFeed.swift): the cards Pulse
 * brought (follow-ups, report items, reports, morning briefs) from the
 * Conduit plugin's `/pulse/feed`, and what a tap on one tells Pulse: a
 * thumbs up or down (with why), Done, Not now, Do it. Pulse is one per
 * host, so nothing here names a profile.
 */
import { t } from '../../../shared/i18n'

export const PULSE = '/api/plugins/conduit_push/pulse'

export interface PulseCard {
  id: number
  /** "followup", "noticed" (one of a report's items), "report" or "brief". */
  kind: string
  /** "push", "screen" or "brief". */
  level: string
  title: string
  quote: string
  news: string
  why: string
  profile: string
  chatId: string
  chatTitle: string
  /** The Kanban task whose worker's session the chat is; "" for one not named. */
  kanbanTask?: string
  itemId?: number
  /** A report item's topic ("date", "promise", "deadline"…). */
  topic: string
  createdAt?: number
  seenAt?: number
  briefedAt?: number
  dismissedAt?: number
  restUntil?: number
  doneAt?: number
  doneBy: string
  /** "up", "down" or "". */
  rating: string
  reason: string
  ratedAt?: number
  /** Why it came back after a Do it that stalled: "unsent", "not_done" or "". */
  back: string
  backActedAt?: number
  /** What its turn looked at first: "calendar", "phone", "contacts", "maps", "web", "location". */
  looked: string[]
}

export type QuietReason = 'until' | 'day'

export interface PulseFeed {
  cards: PulseCard[]
  unseen: number
  homeChatId: string
  /** The profile Pulse runs in: a card from no chat gets a new chat there. */
  profile: string
  quietNow: QuietReason | null
  quietEndsAt?: number
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const int = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)
/** The plugin's epoch seconds as milliseconds. */
const when = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : undefined)

export function parseCard(raw: unknown): PulseCard | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = int(row.id)
  if (id === undefined) return null
  return {
    id,
    kind: str(row.kind),
    level: str(row.level),
    title: str(row.title),
    quote: str(row.quote),
    news: str(row.news),
    why: str(row.why),
    profile: str(row.profile),
    chatId: str(row.chat_id),
    chatTitle: str(row.chat_title),
    kanbanTask: typeof row.kanban_task === 'string' ? row.kanban_task : undefined,
    itemId: int(row.item_id),
    topic: str(row.topic),
    createdAt: when(row.created_at),
    seenAt: when(row.seen_at),
    briefedAt: when(row.briefed_at),
    dismissedAt: when(row.dismissed_at),
    restUntil: when(row.rest_until),
    doneAt: when(row.done_at),
    doneBy: str(row.done_by),
    rating: str(row.rating),
    reason: str(row.reason),
    ratedAt: when(row.rated_at),
    back: str(row.back),
    backActedAt: when(row.back_acted_at),
    looked: Array.isArray(row.looked) ? row.looked.filter((s): s is string => typeof s === 'string') : []
  }
}

export function parseFeed(raw: unknown): PulseFeed {
  const object = (raw ?? {}) as Record<string, unknown>
  const quiet = object.quiet_now === 'until' || object.quiet_now === 'day' ? object.quiet_now : null
  return {
    cards: (Array.isArray(object.cards) ? object.cards : []).map(parseCard).filter((card): card is PulseCard => card !== null),
    unseen: int(object.unseen) ?? 0,
    homeChatId: str(object.home_chat_id),
    profile: str(object.profile) || 'default',
    quietNow: quiet,
    quietEndsAt: quiet ? when(object.quiet_ends_at) : undefined
  }
}

const isNoticed = (card: PulseCard) => card.kind === 'noticed'
/** A report item Pulse found on its own: nothing remembered is behind it. */
const isFound = (card: PulseCard) => isNoticed(card) && card.itemId === undefined

/** Done or swiped away: under Done and cleared. */
export const isCleared = (card: PulseCard) => card.doneAt !== undefined || card.dismissedAt !== undefined

/** Put away by Not now or Wrong time, and not done meanwhile. */
export const isResting = (card: PulseCard) => card.dismissedAt !== undefined && card.doneAt === undefined

/** Held for the morning brief and not in one yet. */
export const isHeld = (card: PulseCard) => card.level === 'brief' && card.briefedAt === undefined

/** Follow-ups and report items take thumbs; a whole report or brief is Hermes' own reply. */
export const isRatable = (card: PulseCard) => card.kind === 'followup' || isNoticed(card)

/** Done: a follow-up or report item, one Pulse found on its own too. */
export const canBeDone = (card: PulseCard) => (card.kind === 'followup' || isNoticed(card)) && (card.itemId !== undefined || isFound(card))

const hasReminder = (card: PulseCard) => !!(card.news || card.title)

/** Do it: in the chat it came from, or a new chat for one from no chat. */
export const canAct = (card: PulseCard) => (card.kind === 'followup' || isNoticed(card)) && hasReminder(card) && !isCleared(card)

/** Not now's "Don't bring it back": only a card without Done (a whole report). */
export const canPutAwayForGood = (card: PulseCard) => !canBeDone(card)

/** Opens its own chat: one it came from that isn't a Kanban worker's. */
export const hasChat = (card: PulseCard) => !!card.chatId && card.kanbanTask === undefined

/** The card's heading: a report item's topic, else its kind. */
export function heading(card: PulseCard): string {
  if (isNoticed(card)) return topicTitle(card.topic)
  switch (card.kind) {
    case 'followup':
      return t('Follow-ups')
    case 'report':
      return t('Reports')
    case 'brief':
      return t('Morning brief')
    default:
      return t('Pulse')
  }
}

export function topicTitle(topic: string): string {
  switch (topic) {
    case 'commitment':
      return t('Commitment')
    case 'promise':
      return t('Promise')
    case 'date':
      return t('Date')
    case 'follow-up':
      return t('Follow-up')
    case 'reminder':
      return t('Reminder')
    case 'watch':
      return t('Watching')
    case 'intention':
      return t('Plan')
    case 'interest':
      return t('Interest')
    case 'fact':
      return t('Worth knowing')
    case 'deadline':
      return t('Deadline')
    case 'next':
      return t('Next step')
    default:
      return t('Noticed')
  }
}

/** A card's colour by what it's about, as the phone tints it. */
export function tint(card: PulseCard): string {
  if (!isNoticed(card)) return 'var(--accent)'
  switch (card.topic) {
    case 'commitment':
    case 'promise':
    case 'follow-up':
      return 'var(--accent)'
    case 'date':
    case 'reminder':
      return '#3b82f6'
    case 'watch':
      return '#a855f7'
    case 'intention':
    case 'interest':
      return '#14b8a6'
    case 'fact':
      return '#22c55e'
    case 'deadline':
      return '#f97316'
    case 'next':
      return '#6366f1'
    default:
      return 'var(--text-3)'
  }
}

/**
 * What Do it leaves in the chat's composer: the reminder, and an ask that
 * fits what the card is about, for the user to send or change.
 */
export function actionMessage(card: PulseCard): string {
  const reminder = card.news || card.title
  if (card.kanbanTask !== undefined) {
    return card.kanbanTask
      ? t("Pulse reminded me: {reminder}\n\nIt came up in the work on Kanban task {task}. Check the task on the board, and if it's stuck, get it going again.", { reminder, task: card.kanbanTask })
      : t("Pulse reminded me: {reminder}\n\nIt came up in the work on a Kanban task. Find the task on the board, and if it's stuck, get it going again.", { reminder })
  }
  switch (card.kind === 'followup' ? 'promise' : card.topic) {
    case 'promise':
      return t('Pulse reminded me: {reminder}\n\nGo ahead with it now.', { reminder })
    case 'commitment':
    case 'reminder':
    case 'intention':
    case 'follow-up':
    case 'next':
      return t("Pulse reminded me: {reminder}\n\nLet's take care of it now.", { reminder })
    case 'date':
      return t('Pulse brought this up: {reminder}\n\nHelp me get ready for it.', { reminder })
    case 'deadline':
      return t('Pulse brought this up: {reminder}\n\nHelp me take care of it before then.', { reminder })
    case 'watch':
      return t('Pulse brought this up: {reminder}\n\nWhere does that stand now?', { reminder })
    case 'interest':
      return t('Pulse brought this up: {reminder}\n\nTell me more.', { reminder })
    default:
      return t("Pulse brought this up: {reminder}\n\nLet's look into it.", { reminder })
  }
}

export type DownReason = 'not_relevant' | 'already_knew' | 'too_late' | 'too_often' | 'wrong_time'
export const DOWN_REASONS: DownReason[] = ['not_relevant', 'already_knew', 'too_late', 'too_often', 'wrong_time']

export function reasonTitle(reason: string): string {
  switch (reason) {
    case 'not_relevant':
      return t('Not relevant')
    case 'already_knew':
      return t('I already knew')
    case 'too_late':
      return t('Too late')
    case 'too_often':
      return t('Too often')
    case 'wrong_time':
      return t('Wrong time')
    default:
      return ''
  }
}

export type Rest = 'later_today' | 'tomorrow' | 'next_week'
export const RESTS: Rest[] = ['later_today', 'tomorrow', 'next_week']

export function restTitle(rest: Rest): string {
  return rest === 'later_today' ? t('Later today') : rest === 'tomorrow' ? t('Tomorrow') : t('Next week')
}

const dayStart = (ms: number) => {
  const day = new Date(ms)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** When a card put off comes back, or Pulse's quiet ends, as the phone says it. */
export function backText(at: number, now = Date.now(), language?: string): string {
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000)
  if (days <= 0) return t('Back later today')
  if (days === 1) return t('Back tomorrow')
  if (days < 7) return t('Back on {day}', { day: new Date(at).toLocaleDateString(language, { weekday: 'long' }) })
  return t('Back next week')
}

/** A put-away or done card's label: what put it away and when it comes back, or who saw it done. */
export function clearedTitle(card: PulseCard, now = Date.now(), language?: string): string {
  if (!isResting(card)) return card.doneBy === 'pulse' ? t('Done, seen in the chat') : t('Done')
  const wrongTime = card.reason === 'wrong_time' && card.ratedAt !== undefined && Math.abs((card.dismissedAt ?? 0) - card.ratedAt) < 1000
  const away = wrongTime ? t('Wrong time') : t('Not now')
  return card.restUntil ? `${away} · ${backText(card.restUntil, now, language)}` : away
}

/** Why a card came back after a Do it that stalled, in the app's words. */
export function backReason(card: PulseCard, now = Date.now(), language?: string): string | null {
  if (!card.backActedAt) return null
  const when = relativeTime(card.backActedAt, now, language)
  if (card.back === 'unsent') return t("You tapped Do it {when} but didn't send it.", { when })
  if (card.back === 'not_done') return t("You tapped Do it {when}, and it isn't done yet.", { when })
  return null
}

function relativeTime(at: number, now: number, language?: string): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const minutes = Math.round((at - now) / 60_000)
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return format.format(hours, 'hour')
  return format.format(Math.round(hours / 24), 'day')
}

/** "Before writing this, Pulse looked at your calendar and the web." */
export function lookedText(card: PulseCard, language?: string): string | null {
  const names = card.looked.map(lookedSource).filter((name): name is string => !!name)
  if (!names.length) return null
  const list = new Intl.ListFormat(language, { type: 'conjunction' }).format(names)
  return t('Before writing this, Pulse looked at {list}.', { list })
}

function lookedSource(label: string): string | null {
  switch (label) {
    case 'calendar':
      return t('your calendar')
    case 'phone':
      return t('your phone')
    case 'contacts':
      return t('your contacts')
    case 'maps':
      return t('Maps')
    case 'web':
      return t('the web')
    case 'location':
      return t('where you are')
    default:
      return null
  }
}

/** The time for today's card, else the weekday and time. */
export function stamp(at: number, now = Date.now(), language?: string): string {
  const date = new Date(at)
  return dayStart(at) === dayStart(now)
    ? date.toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString(language, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export interface PulseLayout {
  fresh: PulseCard[]
  earlier: PulseCard[]
  cleared: PulseCard[]
}

/**
 * The screen's sections: what's new since the last look (the cards unseen
 * when the screen opened), earlier ones, and Done and cleared. `keep`: cards
 * just acted on, kept where they were until the screen is left.
 */
export function layout(cards: PulseCard[], fresh: ReadonlySet<number>, keep: ReadonlySet<number> = new Set()): PulseLayout {
  const open = cards.filter(card => !isCleared(card) || keep.has(card.id))
  return {
    fresh: open.filter(card => fresh.has(card.id)),
    earlier: open.filter(card => !fresh.has(card.id)),
    cleared: cards.filter(card => isCleared(card) && !keep.has(card.id))
  }
}

/** Pulse refuses with {"code": …}: its words for the codes a tap meets. */
export function refusalText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/not_found/.test(text)) return t('Pulse no longer has that one.')
  return text
}
