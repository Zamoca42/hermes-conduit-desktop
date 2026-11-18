/**
 * What Pulse learned and What Pulse left out, after the phone's sheets:
 * GET /pulse/learned (each kind's loudness, what learning holds, the
 * lessons with Undo) and GET /pulse/left_out (what the latest reports and
 * look ahead didn't bring up, with Bring it up).
 */
import { t } from '../../../shared/i18n'
import { topicTitle } from './pulse'

export type Level = 'push' | 'screen' | 'brief' | 'off'
export const LEVELS: Level[] = ['push', 'screen', 'brief', 'off']

export function levelTitle(level: string): string {
  switch (level) {
    case 'push':
      return t('Right away, with a notification')
    case 'screen':
      return t('In Pulse, no notification')
    case 'brief':
      return t('In the morning brief')
    case 'off':
      return t('Off')
    default:
      return level
  }
}

/** What a lesson or level is about: a card kind's heading, else a report item's topic. */
export function kindName(kind: string): string {
  switch (kind) {
    case 'followup':
      return t('Follow-ups')
    case 'report':
      return t('Reports')
    case 'brief':
      return t('Morning brief')
    case 'noticed':
      return t('Noticed')
    case 'deadline':
      return t('Deadlines')
    case 'next':
      return t('Next steps')
    default:
      return topicTitle(kind)
  }
}

export interface Lesson {
  id: number
  kind: string
  what: string
  value: string
  cause: string
  chatTitle: string
}

export interface Preference {
  scope: string
  value: string
  effect: number
  useful: number
  votes: number
  pushes: number
  chatTitle: string
}

export interface Learned {
  lessons: Lesson[]
  levels: Record<string, Level>
  preferences: Preference[]
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const rows = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [])
const SCOPES = new Set(['all', 'kind', 'place', 'timely', 'loud'])

export function parsePreference(raw: unknown, chatPlace = '', chatTitle = ''): Preference | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const effect = num(o.effect)
  if (!SCOPES.has(str(o.scope)) || effect === undefined) return null
  const value = str(o.value)
  const named = str(o.chat_title)
  return {
    scope: str(o.scope),
    value,
    effect,
    useful: Math.max(0, num(o.useful) ?? 0),
    votes: Math.max(0, num(o.votes) ?? 0),
    pushes: Math.max(0, Math.round(num(o.pushes) ?? 0)),
    chatTitle: !named && chatPlace && value === chatPlace ? chatTitle : named
  }
}

export function parseLearned(raw: unknown): Learned {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const levels: Record<string, Level> = {}
  if (o.levels && typeof o.levels === 'object') {
    for (const [kind, level] of Object.entries(o.levels as Record<string, unknown>)) if (LEVELS.includes(level as Level)) levels[kind] = level as Level
  }
  return {
    lessons: rows(o.lessons)
      .filter(row => Number.isInteger(row.id) && typeof row.what === 'string')
      .map(row => ({
        id: row.id as number,
        kind: str(row.kind),
        what: str(row.what),
        value: str(row.value),
        cause: str(row.cause),
        chatTitle: str(row.chat_title)
      })),
    levels,
    preferences: rows(o.preferences)
      .map(row => parsePreference(row))
      .filter((p): p is Preference => !!p)
  }
}

/** A lesson in a line. */
export function lessonText(lesson: Lesson): string {
  const name = kindName(lesson.kind)
  switch (lesson.what) {
    case 'level':
      return t('{kind}: {level}', { kind: name, level: levelTitle(lesson.value) })
    case 'rule':
      return t('No updates about “{topic}”', { topic: lesson.value })
    case 'sooner':
      return lesson.kind === 'followup' ? t('Check on promises sooner') : t('{kind}: Bring up sooner', { kind: name })
    case 'seen':
      return lesson.kind === 'followup' ? t('Skip news you already saw in the chat') : t('{kind}: Skip what you already know', { kind: name })
    case 'reset':
      return lesson.kind === 'everything'
        ? t('Forgot everything learned before this')
        : t('Reset: {subject}', { subject: subject(lesson.kind, lesson.value, lesson.chatTitle) })
    case 'part':
      switch (lesson.value) {
        case 'morning':
          return t('{kind}: No notifications in the morning', { kind: name })
        case 'midday':
          return t('{kind}: No notifications in the middle of the day', { kind: name })
        case 'evening':
          return t('{kind}: No notifications in the evening', { kind: name })
        case 'night':
          return t('{kind}: No notifications at night', { kind: name })
        default:
          return t('{kind}: No notifications at that time of day', { kind: name })
      }
    default:
      return lesson.what
  }
}

/** Why a lesson was learned; null when set by hand. */
export function causeText(cause: string): string | null {
  switch (cause) {
    case '':
    case 'set':
    case 'reset':
      return null
    case 'too often':
      return t('You said too often')
    case 'too late':
      return t('You said too late')
    case 'already knew':
      return t('You said you already knew')
    case 'not relevant':
      return t('You said not relevant')
    case 'wrong time':
      return t('You said wrong time')
    default:
      return cause.endsWith('thumbs up') ? t('After thumbs up') : cause.endsWith('thumbs down') ? t('After thumbs down') : cause
  }
}

function area(value: string): string {
  switch (value) {
    case 'work':
      return t('Work and career')
    case 'personal':
      return t('Personal matters')
    case 'health':
      return t('Health and wellbeing')
    case 'home':
      return t('Home and household')
    case 'money':
      return t('Money and finances')
    case 'social':
      return t('Friends and family')
    case 'travel':
      return t('Trips and travel')
    default:
      return t('Other matters')
  }
}

function source(value: string): string {
  switch (value) {
    case 'calendar':
      return t('Calendar')
    case 'reminders':
      return t('Reminders')
    case 'notes':
      return t("Hermes' notes")
    case 'jobs':
      return t('Scheduled jobs')
    case 'tools':
      return t('Tools')
    case 'inbox':
      return t('Shortcuts inbox')
    default:
      return t('Chats')
  }
}

/** What a preference is about. */
export function subject(scope: string, value: string, chatTitle: string): string {
  switch (scope) {
    case 'all':
      return t("Pulse's cards in general")
    case 'kind':
      return t('“{kind}” cards', { kind: kindName(value) })
    case 'loud':
      return t('How loudly “{kind}” cards come up', { kind: kindName(value) })
    case 'timely':
      return value === 'yes' ? t("What's overdue or due within a day") : t("What isn't due within a day")
    default:
      if (value.startsWith('area:')) return t('Things about “{area}”', { area: area(value.slice(5)) })
      if (value.startsWith('source:')) return t('Things from “{source}”', { source: source(value.slice(7)) })
      return chatTitle ? t('Things from “{title}”', { title: chatTitle }) : t('Things from a chat')
  }
}

const decimal = (value: number, language?: string) => value.toLocaleString(language, { maximumFractionDigits: 1 })

/** Which way a preference moves things, how strongly, and the votes behind it. */
export function preferenceDetail(p: Preference, language?: string): string {
  if (p.scope === 'loud') {
    const louder = t('Louder')
    return p.pushes > 0 ? `${louder} · ${t('After {count} notifications you acted on within the hour', { count: p.pushes })}` : louder
  }
  const size = Math.abs(p.effect)
  const parts = [
    p.effect > 0 ? t('Brings up more') : t('Brings up less'),
    size >= 1.5 ? t('Strong effect') : size >= 0.5 ? t('Moderate effect') : t('Slight effect')
  ]
  if (p.votes > 0) parts.push(t('Useful {useful} out of {votes} lately', { useful: decimal(p.useful, language), votes: decimal(p.votes, language) }))
  return parts.join(' · ')
}

export interface LeftOut {
  id: number
  kind: string
  text: string
  decision: string
  skip: string
  chatTitle: string
  createdAt?: number
  from: string
  cardId?: number
  learned: Preference | null
}

export function parseLeftOut(raw: unknown): LeftOut[] {
  return rows((raw as { left_out?: unknown } | null)?.left_out)
    .filter(row => Number.isInteger(row.id) && str(row.text))
    .map(row => {
      const chatTitle = str(row.chat_title)
      const chatPlace = str(row.chat_id) ? `chat:${str(row.profile)}:${str(row.chat_id)}` : ''
      const created = num(row.created_at)
      const card = num(row.card_id)
      return {
        id: row.id as number,
        kind: str(row.kind),
        text: str(row.text),
        decision: str(row.decision),
        skip: str(row.skip),
        chatTitle,
        createdAt: created !== undefined ? created * 1000 : undefined,
        from: str(row.from),
        cardId: card !== undefined ? Math.round(card) : undefined,
        learned: parsePreference(row.learned, chatPlace, chatTitle)
      }
    })
}

export const isKeptOut = (entry: LeftOut) => ['quieted', 'muted', 'off'].includes(entry.decision)
export const isLookAhead = (entry: LeftOut) => entry.from === 'look_ahead'

/** Why it stayed out, in a line. */
export function leftOutReason(entry: LeftOut): string {
  const ahead = isLookAhead(entry)
  switch (entry.decision) {
    case 'quieted':
      return t('What you did with cards like this kept it out')
    case 'muted':
      return t("You said things from this chat aren't relevant")
    case 'off':
      return t('You turned this kind off')
    case 'over_limit':
      return ahead ? t('Picked, but the look ahead was full') : t('Picked, but the report was full')
    case 'not_picked':
      return ahead ? t('Not picked in the look ahead') : t('Not picked for the report')
    case 'unanswered':
      return ahead ? t('The look ahead passed over it') : t('The report passed over it')
    case 'resting':
      return entry.skip === 'rated' ? t('Resting after your thumbs down') : t('Resting after you said Not now')
    default:
      switch (entry.skip) {
        case 'done':
          return t('Already done')
        case 'covered':
          return t('Your calendar, reminders or a scheduled job covers it')
        case 'raised':
          return t('Brought up lately, and nothing changed since')
        case 'rated':
          return t("You said before that it wasn't useful")
        case 'minor':
          return t('Too minor to bring up')
        case 'shapeless':
          return t("Didn't fit a card type")
        default:
          return t('Pulse chose to leave it out')
      }
  }
}
