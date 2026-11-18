/**
 * The chat list: rows from the dashboard (`/api/profiles/sessions`, every
 * profile, newest activity first), with the gateway's `session.list` as the
 * fallback an older dashboard needs, grouped the way the phone groups them.
 */

export interface ChatRow {
  id: string
  title: string
  preview?: string
  /** Last activity, in milliseconds. */
  activeAt?: number
  profile?: string
  pinned: boolean
  source?: string
  messageCount?: number
}

export interface ChatSection {
  title: string
  rows: ChatRow[]
}

/** Sessions that aren't chats, as the phone's list leaves them out (cron runs have their own list). */
export const CHAT_LIST_EXCLUDED_SOURCES = 'cron,kanban,oneshot,tool'

export const CHAT_LIST_PATH =
  `/api/profiles/sessions?limit=200&offset=0&min_messages=1&archived=exclude&order=recent&exclude_sources=${CHAT_LIST_EXCLUDED_SOURCES}`

const ACTIVITY_KEYS = ['last_active', 'updated_at', 'last_message_at', 'started_at', 'created_at'] as const

/** Seconds, milliseconds, micro- or nanoseconds to milliseconds. */
export function toMillis(value: unknown): number | undefined {
  let n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  while (n > 4e10) n /= 1000 // anything past year 3300 in seconds is a finer unit
  return n * 1000
}

/** Strips the context Hermes stores after a picture prompt, and folds lines. */
function cleanPreview(text: string): string {
  return text.replace(/\n+/g, ' ').trim()
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
    const title = typeof obj.title === 'string' ? obj.title.trim() : ''
    const preview = typeof obj.preview === 'string' ? cleanPreview(obj.preview) : ''
    let activeAt: number | undefined
    for (const key of ACTIVITY_KEYS) {
      activeAt = toMillis(obj[key])
      if (activeAt) break
    }
    rows.push({
      id,
      title: title || preview || 'Untitled chat',
      preview: title && preview && preview !== title ? preview : undefined,
      activeAt,
      profile: typeof obj.profile === 'string' ? obj.profile : undefined,
      pinned: obj.pinned === true || obj.pinned === 1,
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
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([title, list]) => ({ title, rows: list }))
}

/** 8:07 AM today, a weekday this week, else a short date. */
export function timeLabel(ms: number | undefined, now = Date.now()): string {
  if (!ms) return ''
  const today = startOfDay(now)
  const date = new Date(ms)
  if (ms >= today) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (ms >= today - 6 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'short' })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
