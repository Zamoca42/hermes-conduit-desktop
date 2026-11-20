import { gateway } from '../gateway'
import { useCallback, useEffect, useRef, useState } from 'react'
import { answerKeeper, keptAnswer } from './keptAnswers'
import { LIVE_BOARD_POLL_MS, startKanbanStream, windowSockets } from './kanbanEvents'
import { boardPath, boardPollDelay, defaultAssignee, failedInTransit, FIRST_READ_RETRY_MS, parseBoard, parseBoards, parseTask, parseTaskDetail, type KanbanBoard, type KanbanBoardRow, type KanbanTask, type KanbanTaskDetail } from './kanban'

const BOARD_KEY = 'conduit.kanbanBoard'

const savedBoard = (): string | null => {
  try {
    return localStorage.getItem(BOARD_KEY)
  } catch {
    return null
  }
}

/**
 * The last board read on this dashboard, so opening Tasks again shows it at
 * once while the read runs, as the phone keeps its board, instead of an
 * empty board until the dashboard answers.
 */
let keptHost = ''
const kept = new Map<string, KanbanBoard>()
let keptBoards: KanbanBoardRow[] | null = null
const keptKey = (slug: string | null) => slug ?? ''

/** The dashboard signed in to; another one's board is never shown. */
export function setKanbanHost(host: string): void {
  if (host === keptHost) return
  keptHost = host
  kept.clear()
  keptBoards = null
}

/** This run's board, else the one kept on this computer from the last (keptAnswers.ts), so a launch opens on it too. */
function keptBoard(slug: string | null): KanbanBoard | null {
  const key = keptKey(slug)
  if (!kept.has(key)) {
    const raw = keptAnswer(boardPath('/board', slug))
    if (raw !== undefined) {
      try {
        kept.set(key, parseBoard(raw))
      } catch {
        // Not a board any more: read afresh.
      }
    }
  }
  return kept.get(key) ?? null
}

/** Hermes says so when there's no board plugin: a 404 on its routes. */
const missing = (error: unknown) => (error as { code?: unknown } | null)?.code === 404 || /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))

/**
 * The task board: its boards, the one picked (kept on this computer; the
 * server's current board is never changed), and its lanes, read again every
 * few seconds while `shown`.
 */
export function useKanban(connected: boolean, shown: boolean) {
  const [boards, setBoards] = useState<KanbanBoardRow[] | null>(keptBoards)
  const [slug, setSlug] = useState<string | null>(savedBoard)
  const [board, setBoard] = useState<KanbanBoard | null>(() => keptBoard(slug))
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [assignee, setAssignee] = useState('default')
  const generation = useRef(0)
  /** The live event stream is up: the poll is only a backstop then. */
  const [live, setLive] = useState(false)
  const liveRef = useRef(false)
  const repace = useRef<(() => void) | null>(null)
  /** The tasks the stream's last batch touched, so an open task reads again at once. */
  const [touched, setTouched] = useState<{ revision: number; ids: ReadonlySet<string> }>({ revision: 0, ids: new Set() })

  /** Reads in a row that found the board as it was, which space the poll out. */
  const unchanged = useRef(0)

  /**
   * Reads the board. While nothing of it shows yet, a read lost in transit
   * asks once more after a second before the failure shows, as the phone
   * does; with a board on screen the poll's pace carries it.
   */
  const load = useCallback(async () => {
    const mine = ++generation.current
    const key = keptKey(slug)
    for (let attempt = 0; ; attempt++) {
      try {
        const path = boardPath('/board', slug)
        const keep = answerKeeper(path)
        const raw = await gateway.http('GET', path)
        if (mine !== generation.current) return
        const read = parseBoard(raw)
        const before = kept.get(key)
        const same = before !== undefined && JSON.stringify(before) === JSON.stringify(read)
        unchanged.current = same ? unchanged.current + 1 : 0
        // Written only when it changed: the poll reads every few seconds.
        if (!same || keptAnswer(path) === undefined) keep(raw)
        kept.set(key, read)
        // The same read keeps the board drawn, unless a move shown at once is still on it.
        setBoard(current => (same && current === before ? current : read))
        setError(null)
        setUnavailable(false)
        return
      } catch (e) {
        if (mine !== generation.current) return
        if (attempt === 0 && !kept.has(key) && failedInTransit(e)) {
          await new Promise(resolve => setTimeout(resolve, FIRST_READ_RETRY_MS))
          if (mine !== generation.current) return
          continue
        }
        unchanged.current = 0
        if (missing(e) && !slug) setUnavailable(true)
        else setError(e instanceof Error ? e.message : String(e))
        return
      }
    }
  }, [slug])

  const loadBoards = useCallback(async () => {
    try {
      const list = parseBoards(await gateway.http('GET', boardPath('/boards', null)))
      keptBoards = list
      setBoards(list)
      // A saved board that's gone falls back to the server's current one.
      if (slug && !list.some(row => row.slug === slug)) setSlug(null)
    } catch {
      setBoards(list => list ?? [])
    }
    try {
      setAssignee(defaultAssignee(await gateway.http('GET', boardPath('/orchestration', null))))
    } catch {
      // An older plugin: the default profile.
    }
  }, [slug])

  useEffect(() => {
    if (!connected || !shown) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    unchanged.current = 0
    const tick = async (first: boolean) => {
      if (first || document.visibilityState === 'visible') await load()
      if (!stopped) timer = setTimeout(() => void tick(false), liveRef.current ? LIVE_BOARD_POLL_MS : boardPollDelay(unchanged.current))
    }
    void tick(true)
    // The stream dropped: the next read comes at the board's own pace, not the backstop's.
    repace.current = () => {
      if (stopped || timer === undefined) return
      clearTimeout(timer)
      timer = setTimeout(() => void tick(false), boardPollDelay(unchanged.current))
    }
    return () => {
      stopped = true
      clearTimeout(timer)
      repace.current = null
    }
  }, [connected, shown, load])

  // The live stream, from the cursor the first read of this board gave, while the board shows and the window is visible.
  const cursor = board?.latestEventId
  const hasCursor = cursor !== undefined
  const startAt = useRef<number | undefined>(undefined)
  startAt.current = cursor
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  useEffect(() => {
    if (!connected || !shown || !visible || !hasCursor) return
    const stream = startKanbanStream({
      board: slug,
      since: startAt.current!,
      sockets: windowSockets,
      onBatch: ids => {
        void load()
        setTouched(current => ({ revision: current.revision + 1, ids }))
      },
      onConnected: up => {
        liveRef.current = up
        setLive(up)
        // Back down: the board's own pace again, from now.
        if (!up) {
          unchanged.current = 0
          repace.current?.()
        }
      }
    })
    return () => {
      stream.stop()
    }
  }, [connected, shown, visible, hasCursor, slug, load])

  useEffect(() => {
    if (connected && shown) void loadBoards()
  }, [connected, shown, loadBoards])

  const pickBoard = useCallback((next: string | null) => {
    setSlug(next)
    setBoard(keptBoard(next))
    try {
      if (next) localStorage.setItem(BOARD_KEY, next)
      else localStorage.removeItem(BOARD_KEY)
    } catch {
      // Kept for this window only.
    }
  }, [])

  /** A task's change (status, assignee, priority, title, body); the task as Hermes now has it. */
  const patch = useCallback(
    async (task: KanbanTask, fields: Record<string, unknown>): Promise<KanbanTask | null> => {
      // Shown at once in its new lane; the read that follows settles it.
      if (typeof fields.status === 'string') {
        const status = fields.status
        setBoard(current =>
          current && {
            ...current,
            columns: current.columns.map(column => ({
              ...column,
              tasks: column.name === status ? [{ ...task, status }, ...column.tasks.filter(row => row.id !== task.id)] : column.tasks.filter(row => row.id !== task.id)
            }))
          }
        )
      }
      try {
        const raw = (await gateway.http('PATCH', boardPath(`/tasks/${encodeURIComponent(task.id)}`, slug), fields)) as { task?: unknown } | null
        return parseTask(raw?.task)
      } finally {
        void load()
      }
    },
    [slug, load]
  )

  const create = useCallback(
    async (body: Record<string, unknown>): Promise<{ task: KanbanTask | null; warning?: string }> => {
      const raw = (await gateway.http('POST', boardPath('/tasks', slug), body)) as { task?: unknown; warning?: unknown } | null
      void load()
      return { task: parseTask(raw?.task), warning: typeof raw?.warning === 'string' ? raw.warning : undefined }
    },
    [slug, load]
  )

  const remove = useCallback(
    async (task: KanbanTask): Promise<void> => {
      await gateway.http('DELETE', boardPath(`/tasks/${encodeURIComponent(task.id)}`, slug))
      void load()
    },
    [slug, load]
  )

  const comment = useCallback(
    async (task: KanbanTask, body: string): Promise<void> => {
      await gateway.http('POST', boardPath(`/tasks/${encodeURIComponent(task.id)}/comments`, slug), { body })
    },
    [slug]
  )

  const detail = useCallback(
    async (id: string): Promise<KanbanTaskDetail | null> => parseTaskDetail(await gateway.http('GET', boardPath(`/tasks/${encodeURIComponent(id)}`, slug))),
    [slug]
  )

  return { boards, slug, pickBoard, board, error, unavailable, defaultAssignee: assignee, reload: load, patch, create, remove, comment, detail, live, touched }
}
