import { describe, expect, it } from 'vitest'
import { GatewayError } from '../src/renderer/src/gateway'
import {
  RestartMonitor,
  latestLine,
  parseGatewayStatus,
  parseUpdateCheck,
  runRestart,
  runUpdate,
  sharedProfiles,
  updateVerdict,
  type Runner
} from '../src/renderer/src/state/hostActions'

function fakeRunner(answers: (method: string, path: string) => unknown): Runner & { clock: number } {
  const run = {
    clock: 0,
    request: async (method: 'GET' | 'POST', path: string) => {
      const a = answers(method, path)
      if (a instanceof Error) throw a
      return a
    },
    sleep: async (ms: number) => {
      run.clock += ms
    },
    now: () => run.clock,
    live: () => true
  }
  return run
}

describe('update check', () => {
  it('reads the check and leaves out an answer that is not one', () => {
    const check = parseUpdateCheck({
      current_version: '0.23.2',
      behind: 3,
      update_available: true,
      can_apply: true,
      commits: [{ sha: 'a', summary: 'Fix' }, { x: 1 }]
    })
    expect(check).toMatchObject({ currentVersion: '0.23.2', behind: 3, canApply: true, commits: [{ sha: 'a', summary: 'Fix' }] })
    expect(parseUpdateCheck({ other: 1 })).toBeNull()
    expect(parseUpdateCheck({ update_available: false })?.behind).toBeUndefined()
  })

  it('settles an update by its line, its own receipt, or its exit code', () => {
    expect(updateVerdict({ running: true, lines: [] }, null, 'x')).toBe('running')
    expect(updateVerdict({ running: false, lines: ['=== hermes-update completed x ==='] }, null, 'x')).toBe('succeeded')
    expect(updateVerdict({ running: false, lines: [] }, { action_id: 'y', outcome: 'success' }, 'x')).toBe('unknown')
    expect(updateVerdict({ running: false, lines: [] }, { action_id: 'x', outcome: 'partial' }, 'x')).toBe('succeeded')
    expect(updateVerdict({ running: false, exitCode: 1, lines: [] }, null, 'x')).toBe('failed')
  })

  it('shows the newest log line, not a banner', () => {
    expect(latestLine({ running: true, lines: ['Pulling', '', '=== hermes-update started ==='] })).toBe('Pulling')
  })

  it('runs an update through the restart and reads the new version', async () => {
    let polls = 0
    const steps: string[] = []
    const run = fakeRunner((method, path) => {
      if (method === 'POST') return { ok: true, name: 'hermes-update', action_id: 'id1' }
      if (path.startsWith('/api/actions/')) {
        polls++
        if (polls === 1) return { running: true, lines: ['Installing'] }
        if (polls === 2) return new GatewayError('down', 502)
        return { running: false, lines: ['=== hermes-update completed id1 ==='] }
      }
      return { current_version: '0.24.0', update_available: false, behind: 0 }
    })
    const outcome = await runUpdate(run, s => steps.push(s.kind === 'updating' ? s.step : s.kind), 'fallback')
    expect(steps).toEqual(['starting', 'updating', 'updating', 'restarting'])
    expect(outcome).toEqual({ kind: 'updated', version: '0.24.0' })
  })

  it('says how to update an install Hermes cannot update itself', async () => {
    const run = fakeRunner(() => ({ ok: false, message: 'Docker install', update_command: 'docker pull' }))
    expect(await runUpdate(run, () => {}, 'fallback')).toEqual({ kind: 'manual', message: 'Docker install', command: 'docker pull' })
  })

  it('takes a missing route as a Hermes without updates', async () => {
    const run = fakeRunner(() => new GatewayError('Not Found', 404))
    expect(await runUpdate(run, () => {}, '')).toEqual({ kind: 'unsupported' })
  })
})

describe('gateway restart', () => {
  it('reads the gateway and who shares it', () => {
    expect(parseGatewayStatus({ gateway_running: true, gateway_state: 'running', gateway_pid: 4 })).toEqual({
      running: true,
      state: 'running',
      pid: 4,
      sharedProfiles: []
    })
    expect(sharedProfiles(['b', 'default', 'a', 'a'])).toEqual(['default', 'a', 'b'])
    expect(sharedProfiles(['only'])).toEqual([])
  })

  it('waits for the gateway to go down or change, then come back serving', () => {
    const monitor = new RestartMonitor({ running: true, pid: 1, sharedProfiles: [] })
    expect(monitor.observe(null, { running: true, pid: 1, sharedProfiles: [] }, 2)).toEqual({ kind: 'waiting', stage: 'stopping' })
    expect(monitor.observe(null, { running: true, state: 'draining', pid: 1, sharedProfiles: [] }, 4)).toEqual({ kind: 'waiting', stage: 'draining' })
    expect(monitor.observe(null, { running: false, sharedProfiles: [] }, 6)).toEqual({ kind: 'waiting', stage: 'starting' })
    expect(monitor.observe(null, { running: true, pid: 2, sharedProfiles: [] }, 8).kind).toBe('back')
  })

  it('fails on the restart child failing, and gives up after its window', () => {
    expect(new RestartMonitor(null).observe({ running: false, exitCode: 2, lines: ['boom'] }, null, 1)).toEqual({ kind: 'failed', detail: 'boom' })
    const monitor = new RestartMonitor(null)
    monitor.observe({ running: false, exitCode: 0, lines: [] }, { running: false, sharedProfiles: [] }, 1)
    expect(monitor.observe(null, { running: true, state: 'startup_failed', sharedProfiles: [] }, 95)).toEqual({ kind: 'failedToStart' })
  })

  it('runs a restart until the gateway is back', async () => {
    let up = true
    let polls = 0
    const run = fakeRunner((method, path) => {
      if (method === 'POST') {
        up = false
        return {}
      }
      if (path === '/api/status') {
        if (!up && ++polls > 1) up = true
        return { gateway_running: up, gateway_shared_with: ['default', 'nahida'] }
      }
      return new GatewayError('Not Found', 404)
    })
    expect(await runRestart(run, () => {})).toEqual({ kind: 'restarted', sharedProfiles: ['default', 'nahida'] })
  })
})
