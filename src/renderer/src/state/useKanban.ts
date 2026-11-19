import { gateway } from '../gateway'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [board, setBoard] = useState<KanbanBoard | null>(() => kept.get(keptKey(slug)) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [assignee, setAssignee] = useState('default')
  const generation = useRef(0)

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
        const raw = await gateway.http('GET', boardPath('/board', slug))
        if (mine !== generation.current) return
        const read = parseBoard(raw)
        const before = kept.get(key)
        const same = before !== undefined && JSON.stringify(before) === JSON.stringify(read)
        unchanged.current = same ? unchanged.current + 1 : 0
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
      if (!stopped) timer = setTimeout(() => void tick(false), boardPollDelay(unchanged.current))
    }
    void tick(true)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [connected, shown, load])

  useEffect(() => {
    if (connected && shown) void loadBoards()
  }, [connected, shown, loadBoards])

  const pickBoard = useCallback((next: string | null) => {
    setSlug(next)
    setBoard(kept.get(keptKey(next)) ?? null)
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

  return { boards, slug, pickBoard, board, error, unavailable, defaultAssignee: assignee, reload: load, patch, create, remove, comment, detail }
}
