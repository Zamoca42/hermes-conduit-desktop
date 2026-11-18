/**
 * The chat list: rows from the dashboard (`/api/profiles/sessions`, every
 * profile, newest activity first), with the gateway's `session.list` as the
 * fallback an older dashboard needs, grouped the way the phone groups them.
 */
import { locale, t } from '../../../shared/i18n'
import { cleanTitle, previewText } from './text'

export interface ChatRow {
  id: string
  title: string
  preview?: string
  /** Last activity, in milliseconds. */
  activeAt?: number
  profile?: string
  pinned: boolean
  /** Hermes' shared read flag (Hermes Desktop's Mark as unread sets it). */
  unread?: boolean
  source?: string
  messageCount?: number
}

export interface ChatSection {
  title: string
  rows: ChatRow[]
}

/** Sessions that aren't chats, as the phone's list leaves them out (cron runs have their own list). */
export const CHAT_LIST_EXCLUDED_SOURCES = 'cron,kanban,oneshot,tool'

/** Rows per page of the chat list. */
export const CHAT_LIST_PAGE = 200

/** Pages read at most, so a host with years of chats doesn't read them all at once. */
export const CHAT_LIST_MAX_PAGES = 25

export function chatListPath(offset = 0): string {
  return `/api/profiles/sessions?limit=${CHAT_LIST_PAGE}&offset=${offset}&min_messages=1&archived=exclude&order=recent&exclude_sources=${CHAT_LIST_EXCLUDED_SOURCES}`
}

export const CHAT_LIST_PATH = chatListPath(0)

/** How many sessions a response held before any were left out, to tell a full page from the last one. */
export function responseCount(body: unknown): number {
  if (Array.isArray(body)) return body.length
  const sessions = body && typeof body === 'object' ? (body as { sessions?: unknown }).sessions : undefined
  return Array.isArray(sessions) ? sessions.length : 0
}

/**
 * A fresh first page over the rows already read: the page wins for the
 * newest chats, and the older pages stay as they were read.
 */
export function refreshFirstPage(existing: ChatRow[], page: ChatRow[], pageWasFull: boolean): ChatRow[] {
  if (!pageWasFull) return page
  const ids = new Set(page.map(r => r.id))
  const oldest = Math.min(...page.map(r => r.activeAt ?? 0))
  return [...page, ...existing.filter(r => !ids.has(r.id) && (r.activeAt ?? 0) < oldest)]
}

/** Adds a later page's rows, keeping the first copy of a chat that moved between pages. */
export function mergeRows(existing: ChatRow[], page: ChatRow[]): ChatRow[] {
  const seen = new Set(existing.map(r => r.id))
  return [...existing, ...page.filter(r => !seen.has(r.id))]
}

const ACTIVITY_KEYS = ['last_active', 'updated_at', 'last_message_at', 'started_at', 'created_at'] as const

/** Seconds, milliseconds, micro- or nanoseconds to milliseconds. */
export function toMillis(value: unknown): number | undefined {
  let n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  while (n > 4e10) n /= 1000 // anything past year 3300 in seconds is a finer unit
  return n * 1000
}


export function rowsFromResponse(body: unknown): ChatRow[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { sessions?: unknown }).sessions)
      ? (body as { sessions: unknown[] }).sessions
      : []
  const rows: ChatRow[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    const id = typeof obj.id === 'string' ? obj.id : typeof obj.session_id === 'string' ? obj.session_id : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const source = typeof obj.source === 'string' ? obj.source : undefined
    if (source && CHAT_LIST_EXCLUDED_SOURCES.split(',').includes(source.toLowerCase())) continue
    const title = typeof obj.title === 'string' ? cleanTitle(obj.title) : ''
    const preview = typeof obj.preview === 'string' ? previewText(obj.preview) : ''
    let activeAt: number | undefined
    for (const key of ACTIVITY_KEYS) {
      activeAt = toMillis(obj[key])
      if (activeAt) break
    }
    rows.push({
      id,
      title: title || preview || t('Untitled chat'),
      preview: title && preview && preview !== title ? preview : undefined,
      activeAt,
      profile: typeof obj.profile === 'string' ? obj.profile : undefined,
      pinned: obj.pinned === true || obj.pinned === 1,
      unread: obj.unread === true || obj.unread === 1 || undefined,
      source,
      messageCount: typeof obj.message_count === 'number' ? obj.message_count : undefined
    })
  }
  return rows
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function sectionRows(rows: ChatRow[], now = Date.now()): ChatSection[] {
  const today = startOfDay(now)
  const yesterday = today - 86_400_000
  const week = today - 6 * 86_400_000
  const buckets: Record<string, ChatRow[]> = { Pinned: [], Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] }
  const sorted = [...rows].sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
  for (const row of sorted) {
    const at = row.activeAt ?? 0
    const bucket = row.pinned
      ? 'Pinned'
      : at >= today
        ? 'Today'
        : at >= yesterday
          ? 'Yesterday'
          : at >= week
            ? 'Previous 7 days'
            : 'Older'
    buckets[bucket]!.push(row)
  }
  const titles: Record<string, string> = {
    Pinned: t('Pinned'),
    Today: t('Today'),
    Yesterday: t('Yesterday'),
    'Previous 7 days': t('Previous 7 days'),
    Older: t('Older')
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([bucket, list]) => ({ title: titles[bucket]!, rows: list }))
}

/** 8:07 AM today, a weekday this week, else a short date. */
export function timeLabel(ms: number | undefined, now = Date.now()): string {
  if (!ms) return ''
  const today = startOfDay(now)
  const date = new Date(ms)
  if (ms >= today) return date.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  if (ms >= today - 6 * 86_400_000) return date.toLocaleDateString(locale(), { weekday: 'short' })
  return date.toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
}
