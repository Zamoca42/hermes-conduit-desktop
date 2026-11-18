import { describe, expect, it } from 'vitest'
import { isRunningProcess, killFailure, lastLines, parseProcesses } from '../src/renderer/src/state/processes'

describe('parseProcesses', () => {
  it('reads process.list rows and keeps the last four lines of output', () => {
    const list = parseProcesses({
      processes: [
        { session_id: 'proc_1', command: 'npm run dev', cwd: '/srv/app', pid: 4242, status: 'running', uptime_seconds: 75, output_tail: 'a\nb\n\nc\nd\ne\n' },
        { session_id: 'proc_2', command: 'make', status: 'exited', output_preview: 'done' },
        { command: 'no id' }
      ]
    })
    expect(list).toHaveLength(2)
    expect(list![0]).toMatchObject({ id: 'proc_1', command: 'npm run dev', cwd: '/srv/app', pid: 4242, uptimeS: 75, output: 'b\nc\nd\ne' })
    expect(isRunningProcess(list![0])).toBe(true)
    expect(isRunningProcess(list![1])).toBe(false)
    expect(list![1].output).toBe('done')
  })

  it('is null for an answer that is not a list', () => {
    expect(parseProcesses(null)).toBeNull()
    expect(parseProcesses({})).toBeNull()
    expect(parseProcesses({ processes: [] })).toEqual([])
  })
})

describe('killFailure', () => {
  it('is nothing when it went or had already exited', () => {
    expect(killFailure({ status: 'killed' })).toBeNull()
    expect(killFailure({ status: 'already_exited' })).toBeNull()
    expect(killFailure({})).toBeNull()
  })

  it("gives Hermes' reason otherwise", () => {
    expect(killFailure({ status: 'error', error: 'permission denied' })).toBe('permission denied')
    expect(killFailure({ status: 'not_found' })).toBeNull()
  })
})

describe('lastLines', () => {
  it('drops blank lines and keeps the newest', () => {
    expect(lastLines('one\r\ntwo\n\n three \n', 2)).toBe('two\nthree')
  })
})
