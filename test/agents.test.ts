import { describe, expect, it } from 'vitest'
import { agentFromEvent, elapsed, merged, parseRoster, withRoster } from '../src/renderer/src/state/agents'

describe('delegate agents', () => {
  it('reads a subagent event as its card, named by its id', () => {
    const card = agentFromEvent('subagent.progress', { subagent_id: 'sa1', goal: 'Find the bug', tool_name: 'terminal', text: 'Running tests' }, 's', 1000)!
    expect(card).toMatchObject({ id: 'sa1', goal: 'Find the bug', status: 'running', tool: 'terminal', line: 'Running tests', startedAt: 1000 })
    const done = agentFromEvent('subagent.complete', { subagent_id: 'sa1', summary: 'Fixed', duration_seconds: 42 }, 's', 5000)!
    expect(done).toMatchObject({ status: 'completed', durationS: 42 })
    const both = merged(card, done)
    expect(both).toMatchObject({ goal: 'Find the bug', status: 'completed', summary: 'Fixed', tool: undefined, startedAt: 1000 })
    // A late progress frame doesn't start an ended card again.
    expect(merged(both, card).status).toBe('completed')
    expect(agentFromEvent('subagent.spawn', { goal: 'g', task_index: 2, delegation_id: 'd' }, 's')?.id).toBe('s/d#2')
  })

  it('reads the roster, trusting none of it when a row has no id', () => {
    expect(parseRoster({ subagents: [{ subagent_id: 'a', status: 'pending', started_at: 10 }] })).toMatchObject([{ id: 'a', status: 'queued' }])
    expect(parseRoster({ subagents: [{ goal: 'x' }] })).toBeNull()
    expect(parseRoster({})).toBeNull()
  })

  it('ends a running card the roster no longer lists', () => {
    const cards = [agentFromEvent('subagent.start', { subagent_id: 'a' }, 's')!, agentFromEvent('subagent.start', { subagent_id: 'b' }, 's')!]
    const roster = parseRoster({
      subagents: [
        { subagent_id: 'b', status: 'running', last_tool: 'web' },
        { subagent_id: 'c', status: 'running' }
      ]
    })!
    const out = withRoster(cards, roster)
    expect(out.map(c => [c.id, c.status])).toEqual([
      ['a', 'completed'],
      ['b', 'running'],
      ['c', 'running']
    ])
  })

  it('says how long one ran', () => {
    expect(elapsed(42)).toBe('42s')
    expect(elapsed(65)).toBe('1m 05s')
    expect(elapsed(3700)).toBe('1h 01m')
  })
})
