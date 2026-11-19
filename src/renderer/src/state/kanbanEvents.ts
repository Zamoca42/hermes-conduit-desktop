/**
 * The Tasks board's live event stream, after the phone's
 * KanbanEventStreamCoordinator: Hermes' kanban plugin sends each batch of
 * task events on `/api/plugins/kanban/events?board=&since=`, and every batch
 * reads the board again (REST stays canonical). While the stream is up the
 * board's poll slows to a backstop; a socket that drops reconnects on a
 * 1-15 s ladder from the cursor it reached, and one Hermes refuses for good
 * (a 1008 close, or three refusals in a row) ends, leaving the poll.
 */
import type { LiveSocketEvent } from '../../../shared/ipc'

export const KANBAN_EVENTS_PATH = '/api/plugins/kanban/events'
/** The board's poll while the stream is connected, as the phone's. */
export const LIVE_BOARD_POLL_MS = 60_000
/** The first event of a batch waits this long for the rest, so a burst reads the board once. */
export const COALESCE_MS = 300
export const RECONNECT_MS = [1000, 2000, 4000, 8000, 15000]
/** Refusals in a row before a non-1008 refusal ends the stream. */
export const REFUSALS_BEFORE_GIVING_UP = 3
/** A socket open this long without trouble has settled: the refusals in a row start over. */
export const SETTLED_MS = 20_000

export const reconnectDelay = (failures: number): number => RECONNECT_MS[Math.min(Math.max(0, failures), RECONNECT_MS.length - 1)]!

/** The board read's `latest_event_id`: a whole number of at least 0 opens the stream, anything else leaves the poll alone. */
export function initialCursor(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** A frame's cursor and the tasks its events touched; null for a frame that isn't JSON. */
export function eventFrame(data: string): { cursor: number | null; events: number; taskIds: string[] } | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const frame = raw as { events?: unknown; cursor?: unknown }
  const events = Array.isArray(frame.events) ? frame.events : []
  const taskIds = events.flatMap(event => {
    const id = (event as { task_id?: unknown } | null)?.task_id
    return typeof id === 'string' && id ? [id] : []
  })
  return { cursor: typeof frame.cursor === 'number' && Number.isInteger(frame.cursor) ? frame.cursor : null, events: events.length, taskIds }
}

export type Refusal = 'none' | 'policy' | 'refused'

/**
 * How Hermes ended a socket, as the phone's classify: 1008 is final; a
 * refused upgrade (an HTTP 4xx, which the socket library names in its error)
 * or another close the server chose is a refusal; no close frame, a restart
 * or a dropped link is none.
 */
export function refusal(code: number, error: string | null): Refusal {
  if (code === 1008) return 'policy'
  const status = /Unexpected server response: (\d{3})/.exec(error ?? '')?.[1]
  if (status && Number(status) >= 400 && Number(status) < 500) return 'refused'
  if ([1000, 1001, 1005, 1006, 1015].includes(code)) return 'none'
  return 'refused'
}

export interface LiveSockets {
  open(path: string, query: Record<string, string>): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  close(id: string): void
  listen(listener: (event: LiveSocketEvent) => void): () => void
}

export interface StreamOptions {
  board: string | null
  since: number
  sockets: LiveSockets
  /** A batch of events: the tasks they touched. */
  onBatch: (taskIds: Set<string>) => void
  onConnected: (connected: boolean) => void
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (timer: unknown) => void
}

/** One stream for one board; `stop()` ends it for good. */
export function startKanbanStream(options: StreamOptions): { stop: () => void; cursor: () => number } {
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel = options.cancel ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let cursor = options.since
  let stopped = false
  let socket: string | null = null
  let lastError: string | null = null
  let failures = 0
  let refusals = 0
  let connected = false
  let retry: unknown = null
  let settle: unknown = null
  let flush: unknown = null
  let pending = new Set<string>()
  let batched = false

  const setConnected = (next: boolean) => {
    if (next === connected) return
    connected = next
    options.onConnected(next)
  }

  const unlisten = options.sockets.listen(event => {
    if (stopped || event.id !== socket) return
    if (event.type === 'open') {
      failures = 0
      setConnected(true)
      settle = schedule(() => {
        settle = null
        refusals = 0
      }, SETTLED_MS)
    } else if (event.type === 'message') {
      const frame = eventFrame(event.data)
      if (!frame) return
      if (frame.cursor !== null && frame.cursor > cursor) cursor = frame.cursor
      refusals = 0
      if (!frame.events) return
      for (const id of frame.taskIds) pending.add(id)
      batched = true
      if (flush === null)
        flush = schedule(() => {
          flush = null
          if (stopped || !batched) return
          const ids = pending
          pending = new Set()
          batched = false
          options.onBatch(ids)
        }, COALESCE_MS)
    } else if (event.type === 'error') {
      lastError = event.message
    } else if (event.type === 'close') {
      socket = null
      if (settle !== null) cancel(settle)
      settle = null
      setConnected(false)
      const why = refusal(event.code, lastError)
      lastError = null
      if (why === 'policy') return end()
      if (why === 'refused' && ++refusals >= REFUSALS_BEFORE_GIVING_UP) return end()
      backoff()
    }
  })

  const end = () => {
    stopped = true
    unlisten()
  }

  const backoff = () => {
    if (stopped) return
    const delay = reconnectDelay(failures++)
    retry = schedule(() => {
      retry = null
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (stopped) return
    const query: Record<string, string> = { since: String(cursor) }
    if (options.board) query.board = options.board
    const opened = await options.sockets.open(KANBAN_EVENTS_PATH, query).catch(error => ({ ok: false as const, error: String(error) }))
    if (stopped) {
      if (opened.ok) options.sockets.close(opened.id)
      return
    }
    if (!opened.ok) return backoff()
    socket = opened.id
  }

  void connect()
  return {
    cursor: () => cursor,
    stop: () => {
      if (stopped && socket === null) return
      stopped = true
      unlisten()
      for (const timer of [retry, settle, flush]) if (timer !== null) cancel(timer)
      if (socket) options.sockets.close(socket)
      socket = null
      setConnected(false)
    }
  }
}

/** The window's live sockets, which the main process opens with this sign-in's credential. */
export const windowSockets: LiveSockets = {
  open: (path, query) => window.conduit.liveOpen(path, query),
  close: id => window.conduit.liveClose(id),
  listen: listener => window.conduit.onLive(listener)
}
