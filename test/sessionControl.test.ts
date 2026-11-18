import { describe, expect, it } from 'vitest'
import { actionNote, everyText, goalCaption, isEmpty, loopCaption, parseControl } from '../src/renderer/src/state/sessionControl'

describe('session control', () => {
  it('reads the goal, loop and heartbeat, leaving out what has ended', () => {
    const c = parseControl({
      control: {
        revision: 'r1',
        goal: { title: 'Ship it', status: 'active', turns_used: 2, max_turns: 10, subgoals: ['Tests pass', ' ', 'Docs'] },
        loop: { prompt: 'Check CI', status: 'completed', interval_seconds: 300 },
        heartbeat: { prompt: 'Any news?', status: 'paused', interval_seconds: 3600 }
      }
    })!
    expect(c.goal).toMatchObject({ title: 'Ship it', subgoals: ['Tests pass', 'Docs'] })
    expect(c.loop).toBeUndefined()
    expect(c.heartbeat?.status).toBe('paused')
    expect(goalCaption(c.goal!)).toBe('Goal · turn 2 of 10')
    expect(isEmpty(parseControl({ revision: 'x', goal: { title: 'g', status: 'cleared' } }))).toBe(true)
    expect(parseControl({ other: 1 })).toBeNull()
  })

  it('says how often a loop runs', () => {
    expect(everyText(300)).toBe('every 5 min')
    expect(everyText(5400)).toBe('every 1 h 30 min')
    expect(everyText(20)).toBe('every 20 s')
    const loop = parseControl({ loop: { prompt: 'p', interval_seconds: 60, ticks_fired: 1, max_ticks: 3 } })!.loop!
    expect(loopCaption(loop)).toBe('Loop · every 1 min · run 1 of 3')
    expect(loopCaption({ ...loop, deferredByGoal: true })).toBe('Loop · waiting for the goal')
  })

  it("takes Hermes' own words from an action's answer", () => {
    expect(actionNote({ dispatch: { notice: ' Goal paused. ' } })).toBe('Goal paused.')
    expect(actionNote({})).toBeUndefined()
  })
})
