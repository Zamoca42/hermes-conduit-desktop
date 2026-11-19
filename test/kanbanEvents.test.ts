import { describe, expect, it } from 'vitest'
import type { LiveSocketEvent } from '../src/shared/ipc'
import { COALESCE_MS, KANBAN_EVENTS_PATH, eventFrame, initialCursor, reconnectDelay, refusal, startKanbanStream, type LiveSockets } from '../src/renderer/src/state/kanbanEvents'
import { parseBoard } from '../src/renderer/src/state/kanban'

/** Sockets and timers driven by hand. */
function harness() {
  let listener: ((event: LiveSocketEvent) => void) | null = null
  const opened: { path: string; query: Record<string, string> }[] = []
  const closed: string[] = []
  const timers: { fn: () => void; ms: number; done: boolean }[] = []
  const sockets: LiveSockets = {
    open: async (path, query) => {
      opened.push({ path, query })
      return { ok: true, id: `s${opened.length}` }
    },
    close: id => closed.push(id),
    listen: l => {
      listener = l
      return () => {
        listener = null
      }
    }
  }
  const batches: string[][] = []
  const connections: boolean[] = []
  const flushTimers = (ms?: number) => {
    for (const timer of timers.filter(t => !t.done && (ms === undefined || t.ms === ms))) {
      timer.done = true
      timer.fn()
    }
  }
  const start = (since = 7, board: string | null = 'ops') =>
    startKanbanStream({
      board,
      since,
      sockets,
      onBatch: ids => batches.push([...ids].sort()),
      onConnected: up => connections.push(up),
      schedule: (fn, ms) => {
        const timer = { fn, ms, done: false }
        timers.push(timer)
        return timer
      },
      cancel: timer => {
        ;(timer as { done: boolean }).done = true
      }
    })
  const emit = (event: LiveSocketEvent) => listener?.(event)
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return { opened, closed, timers, batches, connections, flushTimers, start, emit, settle, listening: () => listener !== null }
}

describe('the board’s live event stream', () => {
  it('reads the cursor and touched tasks from a frame, and ignores what isn’t JSON', () => {
    expect(eventFrame('{"events":[{"task_id":"t1"},{"task_id":"t2"},{"id":3}],"cursor":12}')).toEqual({ cursor: 12, events: 3, taskIds: ['t1', 't2'] })
    expect(eventFrame('not json')).toBeNull()
    expect(initialCursor(0)).toBe(0)
    expect(initialCursor(-1)).toBeNull()
    expect(initialCursor('5')).toBeNull()
    expect(parseBoard({ columns: [], latest_event_id: 41 }).latestEventId).toBe(41)
    expect(parseBoard({ columns: [], latest_event_id: 'x' }).latestEventId).toBeUndefined()
  })

  it('tells a refusal from a dropped link', () => {
    expect(refusal(1008, null)).toBe('policy')
    expect(refusal(1006, 'Unexpected server response: 403')).toBe('refused')
    expect(refusal(1006, 'connect ECONNREFUSED')).toBe('none')
    expect(refusal(1001, null)).toBe('none')
    expect(refusal(1011, null)).toBe('refused')
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000])
  })

  it('opens on the board from the read’s cursor and coalesces a burst into one batch', async () => {
    const h = harness()
    h.start()
    await h.settle()
    expect(h.opened).toEqual([{ path: KANBAN_EVENTS_PATH, query: { since: '7', board: 'ops' } }])
    h.emit({ id: 's1', type: 'open' })
    expect(h.connections).toEqual([true])
    h.emit({ id: 's1', type: 'message', data: '{"events":[{"task_id":"a"}],"cursor":9}' })
    h.emit({ id: 's1', type: 'message', data: '{"events":[{"task_id":"b"},{"task_id":"a"}],"cursor":11}' })
    expect(h.batches).toEqual([])
    h.flushTimers(COALESCE_MS)
    expect(h.batches).toEqual([['a', 'b']])
    // Another socket's events are not this stream's.
    h.emit({ id: 'other', type: 'message', data: '{"events":[{"task_id":"z"}],"cursor":99}' })
    h.flushTimers(COALESCE_MS)
    expect(h.batches).toHaveLength(1)
  })

  it('reconnects from the cursor it reached after a dropped link, on the ladder', async () => {
    const h = harness()
    h.start(7, null)
    await h.settle()
    h.emit({ id: 's1', type: 'open' })
    h.emit({ id: 's1', type: 'message', data: '{"events":[],"cursor":20}' })
    h.emit({ id: 's1', type: 'close', code: 1006, reason: '' })
    expect(h.connections).toEqual([true, false])
    expect(h.timers.filter(t => !t.done).map(t => t.ms)).toContain(1000)
    h.flushTimers(1000)
    await h.settle()
    expect(h.opened[1]).toEqual({ path: KANBAN_EVENTS_PATH, query: { since: '20' } })
  })

  it('ends at once on a 1008, and after three refusals in a row otherwise', async () => {
    const h = harness()
    h.start()
    await h.settle()
    h.emit({ id: 's1', type: 'close', code: 1008, reason: '' })
    expect(h.listening()).toBe(false)
    expect(h.timers.filter(t => !t.done)).toHaveLength(0)

    const g = harness()
    g.start()
    for (let i = 1; i <= 3; i++) {
      await g.settle()
      g.emit({ id: `s${i}`, type: 'error', message: 'Unexpected server response: 403' })
      g.emit({ id: `s${i}`, type: 'close', code: 1006, reason: '' })
      g.flushTimers()
    }
    await g.settle()
    expect(g.opened).toHaveLength(3)
    expect(g.listening()).toBe(false)
  })

  it('stops for good: the socket closes and nothing more is opened', async () => {
    const h = harness()
    const stream = h.start()
    await h.settle()
    h.emit({ id: 's1', type: 'open' })
    stream.stop()
    expect(h.closed).toEqual(['s1'])
    expect(h.connections).toEqual([true, false])
    h.flushTimers()
    await h.settle()
    expect(h.opened).toHaveLength(1)
  })
})
