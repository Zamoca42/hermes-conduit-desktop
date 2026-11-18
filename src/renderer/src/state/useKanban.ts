import { useCallback, useEffect, useRef, useState } from 'react'
import { boardPath, defaultAssignee, parseBoard, parseBoards, parseTask, parseTaskDetail, type KanbanBoard, type KanbanBoardRow, type KanbanTask, type KanbanTaskDetail } from './kanban'

const BOARD_KEY = 'conduit.kanbanBoard'
/** How often the shown board is read again: Hermes' workers move tasks on their own. */
const POLL_MS = 8000

const savedBoard = (): string | null => {
  try {
    return localStorage.getItem(BOARD_KEY)
  } catch {
    return null
  }
}

/** Hermes says so when there's no board plugin: a 404 on its routes. */
const missing = (error: unknown) => (error as { code?: unknown } | null)?.code === 404 || /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))

/**
 * The task board: its boards, the one picked (kept on this computer; the
 * server's current board is never changed), and its lanes, read again every
 * few seconds while `shown`.
 */
export function useKanban(connected: boolean, shown: boolean) {
  const [boards, setBoards] = useState<KanbanBoardRow[] | null>(null)
  const [slug, setSlug] = useState<string | null>(savedBoard)
  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [assignee, setAssignee] = useState('default')
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    try {
      const raw = await window.conduit.http('GET', boardPath('/board', slug))
      if (mine !== generation.current) return
      setBoard(parseBoard(raw))
      setError(null)
      setUnavailable(false)
    } catch (e) {
      if (mine !== generation.current) return
      if (missing(e) && !slug) setUnavailable(true)
      else setError(e instanceof Error ? e.message : String(e))
    }
  }, [slug])

  const loadBoards = useCallback(async () => {
    try {
      const list = parseBoards(await window.conduit.http('GET', boardPath('/boards', null)))
      setBoards(list)
      // A saved board that's gone falls back to the server's current one.
      if (slug && !list.some(row => row.slug === slug)) setSlug(null)
    } catch {
      setBoards(list => list ?? [])
    }
    try {
      setAssignee(defaultAssignee(await window.conduit.http('GET', boardPath('/orchestration', null))))
    } catch {
      // An older plugin: the default profile.
    }
  }, [slug])

  useEffect(() => {
    if (!connected || !shown) return
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [connected, shown, load])

  useEffect(() => {
    if (connected && shown) void loadBoards()
  }, [connected, shown, loadBoards])

  const pickBoard = useCallback((next: string | null) => {
    setSlug(next)
    setBoard(null)
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
        const raw = (await window.conduit.http('PATCH', boardPath(`/tasks/${encodeURIComponent(task.id)}`, slug), fields)) as { task?: unknown } | null
        return parseTask(raw?.task)
      } finally {
        void load()
      }
    },
    [slug, load]
  )

  const create = useCallback(
    async (body: Record<string, unknown>): Promise<{ task: KanbanTask | null; warning?: string }> => {
      const raw = (await window.conduit.http('POST', boardPath('/tasks', slug), body)) as { task?: unknown; warning?: unknown } | null
      void load()
      return { task: parseTask(raw?.task), warning: typeof raw?.warning === 'string' ? raw.warning : undefined }
    },
    [slug, load]
  )

  const remove = useCallback(
    async (task: KanbanTask): Promise<void> => {
      await window.conduit.http('DELETE', boardPath(`/tasks/${encodeURIComponent(task.id)}`, slug))
      void load()
    },
    [slug, load]
  )

  const comment = useCallback(
    async (task: KanbanTask, body: string): Promise<void> => {
      await window.conduit.http('POST', boardPath(`/tasks/${encodeURIComponent(task.id)}/comments`, slug), { body })
    },
    [slug]
  )

  const detail = useCallback(
    async (id: string): Promise<KanbanTaskDetail | null> => parseTaskDetail(await window.conduit.http('GET', boardPath(`/tasks/${encodeURIComponent(id)}`, slug))),
    [slug]
  )

  return { boards, slug, pickBoard, board, error, unavailable, defaultAssignee: assignee, reload: load, patch, create, remove, comment, detail }
}
