/**
 * What a Pulse card shows besides its words, after the phone's PulseLook
 * (plugin 0.150.0, `pulse_looks`): the pick it was made from, checked by the
 * plugin. A shape with its facts (a date, something due, a job's recent runs,
 * a promise in the words it was made, a status, the steps of something
 * underway, a value that moved, someone you're waiting on, what a watch
 * found, a card body drawn like a chat's conduit_show card, or plain words)
 * and at most two actions. The morning brief's card carries its parts the
 * same way. A card from an older plugin, or one whose look this can't read,
 * has none and shows its words as before.
 */
import { t } from '../../../shared/i18n'
import { DRAWN, type Board, type Card } from './boards'

export type LookState = 'ok' | 'warn' | 'fail'
export type Better = 'up' | 'down'

export type LookBody =
  | { shape: 'date'; day: Date; what: string; whose: string }
  | { shape: 'due'; due: Date; hasTime: boolean; noticed: Date | null }
  | { shape: 'runs'; job: string; results: boolean[] }
  | { shape: 'promise'; said: string; person: string; place: string; when: string }
  | { shape: 'status'; label: string; state: LookState }
  | { shape: 'steps'; names: string[]; at: number }
  | { shape: 'number'; label: string; value: number; unit: string; was: number | null; limit: number | null; better: Better | null }
  | { shape: 'waiting'; person: string; what: string; since: Date | null }
  | { shape: 'found'; asked: string; answer: string; place: string }
  | { shape: 'drawn'; board: Board }
  | { shape: 'brief'; summary: string; today: string[]; open: string[]; held: number }
  | { shape: 'plain' }

export interface LookAction {
  label: string
  does: 'ask' | 'open' | 'draft' | 'done' | 'later'
  /** ask: the words for the chat's composer. draft: the message to send someone. open: the link. */
  value: string
}

export interface PulseLook {
  body: LookBody
  line: string
  detail: string
  /** At most two, one each of what they do. */
  actions: LookAction[]
}

type Row = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null
const int = (v: unknown) => {
  const n = num(v)
  return n !== null && Number.isInteger(n) ? n : null
}
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

/** The links an open action may open, as the plugin's pick check allows: web pages, maps, phone, messages, mail, calendar. */
const OPENABLE = /^(https?:|tel:|sms:|mailto:|maps:|calshow:|x-apple-reminderkit:)/i

function action(raw: unknown): LookAction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Row
  const does = o.does
  if (does !== 'ask' && does !== 'open' && does !== 'draft' && does !== 'done' && does !== 'later') return null
  const label = text(o.label)
  const value = does === 'ask' ? text(o.say) : does === 'draft' ? text(o.text) : does === 'open' ? text(o.url) : ''
  const needsValue = does === 'ask' || does === 'draft' || does === 'open'
  if (needsValue && (!label || !value)) return null
  if (does === 'open' && !OPENABLE.test(value)) return null
  return { label, does, value }
}

/** "2026-11-20" (the start of that day) or "2026-11-20T15:00", in this computer's time zone. */
export function lookDay(value: string): { date: Date; hasTime: boolean } | null {
  const match = value.match(/^(\d+)-(\d+)-(\d+)(?:T(\d+):(\d+))?$/)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const hasTime = match[4] !== undefined
  const [h, min] = hasTime ? [Number(match[4]), Number(match[5])] : [0, 0]
  if (h > 23 || min > 59) return null
  const date = new Date(y, m - 1, d, h, min)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return { date, hasTime }
}

function body(shape: string, facts: Row): LookBody | null {
  switch (shape) {
    case 'date': {
      const found = lookDay(text(facts.day))
      return found ? { shape, day: found.date, what: text(facts.what), whose: text(facts.whose) } : null
    }
    case 'due': {
      const found = lookDay(text(facts.due))
      return found ? { shape, due: found.date, hasTime: found.hasTime, noticed: lookDay(text(facts.noticed))?.date ?? null } : null
    }
    case 'runs': {
      const raw = Array.isArray(facts.results) ? facts.results : []
      if (!raw.length || !raw.every(r => r === 'ok' || r === 'fail')) return null
      return { shape, job: text(facts.job), results: raw.slice(-10).map(r => r === 'ok') }
    }
    case 'promise':
      return text(facts.said) ? { shape, said: text(facts.said), person: text(facts.person), place: text(facts.where), when: text(facts.when) } : null
    case 'status': {
      const state = text(facts.state)
      return text(facts.label) && (state === 'ok' || state === 'warn' || state === 'fail') ? { shape, label: text(facts.label), state } : null
    }
    case 'steps': {
      const raw = Array.isArray(facts.names) ? facts.names : []
      const names = raw.filter((n): n is string => typeof n === 'string' && n.length > 0)
      const at = int(facts.at)
      return names.length === raw.length && names.length >= 2 && at !== null && at >= 0 && at < names.length ? { shape, names, at } : null
    }
    case 'number': {
      const value = num(facts.value)
      if (!text(facts.label) || value === null) return null
      const better = text(facts.better)
      return {
        shape,
        label: text(facts.label),
        value,
        unit: text(facts.unit),
        was: num(facts.was),
        limit: num(facts.limit),
        better: better === 'up' || better === 'down' ? better : null
      }
    }
    case 'waiting':
      return text(facts.person) && text(facts.what)
        ? { shape, person: text(facts.person), what: text(facts.what), since: lookDay(text(facts.since))?.date ?? null }
        : null
    case 'found':
      return text(facts.asked) && text(facts.answer) && text(facts.where)
        ? { shape, asked: text(facts.asked), answer: text(facts.answer), place: text(facts.where) }
        : null
    case 'drawn': {
      const card = facts.body as Card | undefined
      // Drawn as a chat's board where this app draws the kind; else the words alone.
      if (!card || typeof card !== 'object' || typeof card.type !== 'string' || !DRAWN.has(card.type)) return null
      return { shape, board: { cards: [card], tabs: false, next: [] } }
    }
    case 'brief': {
      const counts = (facts.counts ?? {}) as Row
      return { shape, summary: text(facts.summary), today: strings(facts.today), open: strings(facts.open), held: Math.max(0, int(counts.held) ?? 0) }
    }
    default:
      return null
  }
}

/** Null for no look; a shape this can't read draws nothing more than its words. */
export function parseLook(raw: unknown): PulseLook | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Row
  if (typeof o.shape !== 'string') return null
  const facts = (o.facts && typeof o.facts === 'object' ? o.facts : {}) as Row
  const actions: LookAction[] = []
  for (const item of Array.isArray(o.actions) ? o.actions : []) {
    if (actions.length >= 2) break
    const a = action(item)
    if (a && !actions.some(b => b.does === a.does)) actions.push(a)
  }
  return { body: body(o.shape, facts) ?? { shape: 'plain' }, line: text(o.line), detail: text(o.detail), actions }
}

export const drawsBody = (look: PulseLook) => look.body.shape !== 'plain' && look.body.shape !== 'brief'
export const askAction = (look: PulseLook | null | undefined) => look?.actions.find(a => a.does === 'ask')
/** The actions drawn as buttons of their own: done and later are the card's Done and Not now, and ask is Do it. */
export const extraActions = (look: PulseLook | null | undefined) => (look?.actions ?? []).filter(a => a.does === 'open' || a.does === 'draft')

/** Where a shape stands on the card, and its color (the phone's PulseLookStyle, Eric 2026-11-10: each type at a glance). */
export type Place = 'side' | 'band' | 'lead' | 'under' | 'none'
export function lookStyle(body: LookBody, now = new Date()): { tint: string; place: Place } {
  switch (body.shape) {
    case 'date':
      return { tint: 'var(--pulse-blue)', place: 'side' }
    case 'due':
      return { tint: (body.hasTime ? body.due : endOfDay(body.due)) < now ? 'var(--pulse-red)' : 'var(--pulse-orange)', place: 'lead' }
    case 'runs':
      return { tint: body.results.includes(false) ? 'var(--pulse-red)' : 'var(--pulse-green)', place: 'band' }
    case 'promise':
      return { tint: 'var(--pulse-purple)', place: 'lead' }
    case 'status':
      return { tint: body.state === 'ok' ? 'var(--pulse-green)' : body.state === 'warn' ? 'var(--pulse-orange)' : 'var(--pulse-red)', place: 'lead' }
    case 'steps':
      return { tint: 'var(--pulse-teal)', place: 'under' }
    case 'number':
      return { tint: 'var(--pulse-indigo)', place: 'lead' }
    case 'waiting':
      return { tint: 'var(--pulse-pink)', place: 'lead' }
    case 'found':
      return { tint: 'var(--pulse-mint)', place: 'lead' }
    case 'drawn':
      return { tint: 'var(--accent)', place: 'under' }
    default:
      return { tint: 'var(--accent)', place: 'none' }
  }
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** A day with no time, in whole days: "today", "tomorrow", "in 3 days". */
export function relativeDay(day: Date, now = new Date(), locale?: string): string {
  const days = Math.round((startOfDay(day).getTime() - startOfDay(now).getTime()) / 86_400_000)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
}

/** A time: "in 3 hours", "20 minutes ago", "tomorrow". */
export function relativeTime(date: Date, now = new Date(), locale?: string): string {
  const seconds = (date.getTime() - now.getTime()) / 1000
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return format.format(Math.round(seconds), 'second')
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86_400), 'day')
}

/** How a number moved: the good way, the other way, or (which way is good unsaid) only that it moved; null when it didn't. */
export function move(value: number, was: number | null, better: Better | null): 'good' | 'bad' | 'unsaid' | null {
  if (was === null || was === value) return null
  if (!better) return 'unsaid'
  return value > was === (better === 'up') ? 'good' : 'bad'
}

/** On the wrong side of its limit; never when which way is good wasn't said. */
export function pastLimit(value: number, limit: number | null, better: Better | null): boolean {
  if (limit === null || !better) return false
  return better === 'down' ? value > limit : value < limit
}

/** A number in the app's language with its unit: a percent or a degree right after it, any other after a space. */
export function amount(value: number, unit: string, locale?: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  if (!unit) return number
  return unit === '%' || unit.startsWith('°') ? number + unit : `${number} ${unit}`
}

export function statusTitle(state: LookState): string {
  return state === 'ok' ? t('OK') : state === 'warn' ? t('Warning') : t('Failing')
}
