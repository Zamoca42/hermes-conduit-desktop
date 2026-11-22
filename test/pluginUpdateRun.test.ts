// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { untilQuiet, type UpdateState } from '../src/renderer/src/state/plugin'
import { followHostUpdate, useStaleUpdateRow, type PluginHttp } from '../src/renderer/src/state/pluginUpdateRun'

const failing = () => Object.assign(new Error('unreachable'), { code: 0 })

/** Runs the real follow under the real watchdog: the host starts the job, then `read(n)` answers the nth poll. */
async function runFollow(read: (n: number) => Promise<unknown>) {
  let reads = 0
  const http: PluginHttp = async method => (method === 'POST' ? { job: { id: 'j', step: 'downloading' } } : read(++reads))
  let row: UpdateState = { phase: 'updating', step: 'downloading' }
  let live = true
  const run = untilQuiet(
    heard =>
      followHostUpdate(
        { http, readStatus: async () => ({ state: 'unknown' }), current: () => row, startedAt: Date.now() },
        next => (row = next),
        heard,
        false,
        () => live,
        () => {}
      ),
    () => (row.phase === 'updating' ? 360_000 : null),
    15_000
  )
  return {
    run,
    stop: () => (live = false),
    reads: () => reads
  }
}

describe('following the host\'s update', () => {
  it('ends a run whose reads keep failing: a failed read is no word from the host', async () => {
    vi.useFakeTimers()
    try {
      const { run, stop, reads } = await runFollow(async () => {
        throw failing()
      })
      await vi.advanceTimersByTimeAsync(380_000)
      await expect(run).resolves.toBe('stalled')
      // It kept asking the whole time; only the answers were missing.
      expect(reads()).toBeGreaterThan(100)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a run going while the host answers on the same step, and after reads come back', async () => {
    vi.useFakeTimers()
    try {
      // Fails for five minutes (inside the six-minute limit), then answers on the same step for an hour's worth of polls.
      const { run, stop } = await runFollow(async n => {
        if (n <= 150) throw failing()
        return { job: { id: 'j', step: 'downloading' } }
      })
      let ended: string | null = null
      void run.then(r => (ended = r))
      await vi.advanceTimersByTimeAsync(800_000)
      expect(ended).toBeNull()
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

type Props = { row: UpdateState; rowHost: string; host: string }

function guard(props: Props, answer: () => Promise<unknown>) {
  const http = vi.fn<PluginHttp>(answer)
  const clear = vi.fn<(row: UpdateState) => void>()
  renderHook((p: Props) => useStaleUpdateRow(p.row, p.rowHost, p.host, http, clear), props)
  return { http, clear }
}

describe('the update row when the page opens', () => {
  const held: UpdateState = { phase: 'scanHeld', id: 'j1', findings: [], count: 1 }

  it('clears another dashboard\'s row at once, whatever it says, without asking', async () => {
    for (const row of [
      held,
      { phase: 'updated', version: '0.193.0' },
      { phase: 'needsDashboardRestart', detail: null },
      { phase: 'failed', detail: 'no route' },
      { phase: 'runningOnHost' }
    ] as UpdateState[]) {
      const { http, clear } = guard({ row, rowHost: 'a', host: 'b' }, async () => ({}))
      await settle()
      expect(clear).toHaveBeenCalledWith(row)
      expect(http).not.toHaveBeenCalled()
    }
  })

  it('keeps a live run, which stops by itself', async () => {
    const { clear } = guard({ row: { phase: 'updating', step: 'downloading' }, rowHost: 'a', host: 'b' }, async () => ({}))
    await settle()
    expect(clear).not.toHaveBeenCalled()
  })

  it('keeps a held scan whose job the host still holds', async () => {
    const { http, clear } = guard({ row: held, rowHost: 'a', host: 'a' }, async () => ({ job: { id: 'j1', step: 'scan_held' } }))
    await settle()
    expect(http).toHaveBeenCalledWith('GET', expect.stringContaining('/self/update'))
    expect(clear).not.toHaveBeenCalled()
  })

  it('clears a held scan once the host has moved on to another job', async () => {
    const { clear } = guard({ row: held, rowHost: 'a', host: 'a' }, async () => ({ job: { id: 'j2', step: 'done' } }))
    await settle()
    expect(clear).toHaveBeenCalledWith(held)
  })

  it('keeps a held scan when the host can\'t be read', async () => {
    const { clear } = guard({ row: held, rowHost: 'a', host: 'a' }, async () => {
      throw failing()
    })
    await settle()
    expect(clear).not.toHaveBeenCalled()
  })
})
