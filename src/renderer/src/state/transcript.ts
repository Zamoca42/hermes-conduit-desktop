/**
 * A chat's transcript as the window draws it: the stored history from
 * `session.resume`, then the live turn's events folded in as they arrive.
 * Pure functions, so the tests can play a turn's events through them.
 */
import { cleanUserText, type Attachment } from './text'
import { t } from '../../../shared/i18n'

export interface UserItem {
  kind: 'user'
  key: string
  text: string
  /** Files and links the message named on its first lines. */
  attachments?: Attachment[]
  at?: number
  /** Sent from here and not yet confirmed by the gateway. */
  pending?: boolean
}

export interface AssistantItem {
  kind: 'assistant'
  key: string
  text: string
  at?: number
  streaming: boolean
}

export interface ThinkingItem {
  kind: 'thinking'
  key: string
  text: string
  streaming: boolean
}

export interface ToolItem {
  kind: 'tool'
  key: string
  toolId: string
  name: string
  context?: string
  summary?: string
  status: 'running' | 'done'
  durationS?: number
  at?: number
}

export interface NoticeItem {
  kind: 'notice'
  key: string
  text: string
  tone: 'error' | 'info'
}

export type TranscriptItem = UserItem | AssistantItem | ThinkingItem | ToolItem | NoticeItem

export interface TranscriptState {
  items: TranscriptItem[]
  running: boolean
  /** The running turn's latest status line (`status.update`). */
  status?: string
}

export const emptyTranscript: TranscriptState = { items: [], running: false }

/** One stored row, as `session.resume` / `session.history` project it. */
export interface HistoryRow {
  role: string
  text?: string | null
  content?: unknown
  timestamp?: number | null
  row_id?: number | null
  display_kind?: string | null
  name?: string | null
  context?: string | null
  reasoning?: string | null
  tool_call_id?: string | null
  [key: string]: unknown
}

let keyCounter = 0
const nextKey = (prefix: string) => `${prefix}-${++keyCounter}`

function rowText(row: HistoryRow): string {
  if (typeof row.text === 'string') return row.text
  if (typeof row.content === 'string') return row.content
  if (Array.isArray(row.content)) {
    return row.content
      .map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  return ''
}

/** Seconds or milliseconds to milliseconds. */
function toMillis(timestamp: number | null | undefined): number | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return undefined
  return timestamp < 1e11 ? timestamp * 1000 : timestamp
}

/** A person's message without what Hermes stored around it; null when nothing is left to show. */
function userItem(key: string, raw: string, at?: number): UserItem | null {
  const { text, attachments } = cleanUserText(raw)
  if (!text && !attachments.length) return null
  return { kind: 'user', key, text, at, ...(attachments.length ? { attachments } : {}) }
}

export function fromHistory(rows: HistoryRow[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const row of rows) {
    if (row.display_kind === 'hidden') continue
    const at = toMillis(row.timestamp)
    const key = row.row_id != null ? `row-${row.row_id}` : nextKey('h')
    switch (row.role) {
      case 'user': {
        const item = userItem(key, rowText(row), at)
        if (item) items.push(item)
        break
      }
      case 'assistant': {
        if (typeof row.reasoning === 'string' && row.reasoning.trim()) {
          items.push({ kind: 'thinking', key: `${key}-r`, text: row.reasoning.trim(), streaming: false })
        }
        const text = rowText(row).trim()
        if (text) items.push({ kind: 'assistant', key, text, at, streaming: false })
        break
      }
      case 'tool':
        items.push({
          kind: 'tool',
          key,
          toolId: row.tool_call_id ?? key,
          name: row.name ?? 'tool',
          context: row.context ?? undefined,
          status: 'done',
          at
        })
        break
      default:
        break
    }
  }
  return items
}

/** Stops whatever is still streaming: a tool line or the turn's end comes next. */
function seal(items: TranscriptItem[]): TranscriptItem[] {
  let changed = false
  const next = items.map(item => {
    if ((item.kind === 'assistant' || item.kind === 'thinking') && item.streaming) {
      changed = true
      return { ...item, streaming: false }
    }
    return item
  })
  return changed ? next : items
}

function appendStreaming(items: TranscriptItem[], kind: 'assistant' | 'thinking', text: string): TranscriptItem[] {
  const last = items[items.length - 1]
  if (last && last.kind === kind && last.streaming) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }]
  }
  const base = kind === 'assistant' ? seal(items) : items
  const item: TranscriptItem =
    kind === 'assistant'
      ? { kind: 'assistant', key: nextKey('a'), text, at: Date.now(), streaming: true }
      : { kind: 'thinking', key: nextKey('t'), text, streaming: true }
  return [...base, item]
}

function payloadOf(event: { payload?: unknown }): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object' ? (event.payload as Record<string, unknown>) : {}
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export function applyEvent(state: TranscriptState, event: { type: string; payload?: unknown }): TranscriptState {
  const payload = payloadOf(event)
  switch (event.type) {
    case 'message.start':
      return { ...state, running: true, status: undefined, items: confirmPending(state.items) }
    case 'message.delta': {
      const text = payload.text
      if (text === null) return { ...state, items: seal(state.items) }
      if (typeof text !== 'string' || !text) return state
      return { ...state, running: true, items: appendStreaming(confirmPending(state.items), 'assistant', text) }
    }
    // `thinking.delta` is the terminal UI's spinner face, not the model's reasoning.
    case 'reasoning.delta': {
      const text = str(payload.text)
      if (!text) return state
      return { ...state, items: appendStreaming(state.items, 'thinking', text) }
    }
    case 'message.interim': {
      const text = str(payload.text)
      if (!text || payload.already_streamed === true) return { ...state, items: seal(state.items) }
      return {
        ...state,
        items: [...seal(state.items), { kind: 'assistant', key: nextKey('a'), text, at: Date.now(), streaming: false }]
      }
    }
    case 'tool.start': {
      const toolId = str(payload.tool_id) ?? nextKey('tool')
      const item: ToolItem = {
        kind: 'tool',
        key: `tool-${toolId}`,
        toolId,
        name: str(payload.name) ?? 'tool',
        context: str(payload.context) ?? str(payload.preview),
        status: 'running',
        at: Date.now()
      }
      return { ...state, items: [...seal(state.items), item] }
    }
    case 'tool.complete': {
      const toolId = str(payload.tool_id)
      const items = state.items.map(item =>
        item.kind === 'tool' && item.toolId === toolId
          ? {
              ...item,
              status: 'done' as const,
              summary: str(payload.summary) ?? item.summary,
              durationS: typeof payload.duration_s === 'number' ? payload.duration_s : item.durationS
            }
          : item
      )
      return { ...state, items }
    }
    case 'status.update': {
      const text = str(payload.text)
      return text ? { ...state, status: text } : state
    }
    case 'message.complete': {
      let items = seal(confirmPending(state.items))
      const finalText = str(payload.text) ?? str(payload.rendered)
      const lastUser = items.map(i => i.kind).lastIndexOf('user')
      const repliedThisTurn = items.slice(lastUser + 1).some(i => i.kind === 'assistant')
      if (finalText?.trim() && !repliedThisTurn) {
        items = [...items, { kind: 'assistant', key: nextKey('a'), text: finalText.trim(), at: Date.now(), streaming: false }]
      }
      // Tools the turn ended without finishing (a stop) aren't running any more.
      items = items.map(item => (item.kind === 'tool' && item.status === 'running' ? { ...item, status: 'done' as const } : item))
      const status = str(payload.status)
      if (status === 'error') {
        const error = str(payload.error) ?? str(payload.failure_reason) ?? t('The turn failed.')
        items = [...items, { kind: 'notice', key: nextKey('n'), text: error, tone: 'error' }]
      } else if (status === 'interrupted') {
        items = [...items, { kind: 'notice', key: nextKey('n'), text: t('Stopped'), tone: 'info' }]
      }
      return { items, running: false, status: undefined }
    }
    case 'user.message': {
      // Sent from another client of this chat (the phone).
      const item = userItem(nextKey('u'), str(payload.text) ?? '', Date.now())
      if (!item) return state
      return { ...state, items: [...seal(state.items), item] }
    }
    case 'message.interrupted':
    case 'session.interrupted':
      return { ...state, running: false, status: undefined, items: seal(state.items) }
    case 'error': {
      const text = str(payload.message)
      if (!text) return state
      return { ...state, items: [...state.items, { kind: 'notice', key: nextKey('n'), text, tone: 'error' }] }
    }
    default:
      return state
  }
}

function confirmPending(items: TranscriptItem[]): TranscriptItem[] {
  if (!items.some(item => item.kind === 'user' && item.pending)) return items
  return items.map(item => (item.kind === 'user' && item.pending ? { ...item, pending: false } : item))
}

export function addPendingUser(state: TranscriptState, text: string, attachments: Attachment[] = []): TranscriptState {
  const item: UserItem = userItem(nextKey('u'), text, Date.now()) ?? { kind: 'user' as const, key: nextKey('u'), text, at: Date.now() }
  const all = [...attachments, ...(item.attachments ?? [])]
  return { ...state, items: [...state.items, { ...item, ...(all.length ? { attachments: all } : {}), pending: true }] }
}

/** A send that failed: its bubble goes, with the reason in its place. */
export function failPendingUser(state: TranscriptState, error: string): TranscriptState {
  const index = state.items.map(i => i.kind === 'user' && i.pending).lastIndexOf(true)
  if (index < 0) return state
  const items = [...state.items]
  items.splice(index + 1, 0, { kind: 'notice', key: nextKey('n'), text: `Not sent: ${error}`, tone: 'error' })
  items[index] = { ...(items[index] as UserItem), pending: false }
  return { ...state, items }
}
