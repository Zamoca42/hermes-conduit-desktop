import { describe, expect, it } from 'vitest'
import { modelBody, parseWorkSettings, policyChoices, quickStepsChoices } from '../src/renderer/src/state/workSettings'

describe('work settings', () => {
  it('reads what the plugin sends, with safe defaults', () => {
    const s = parseWorkSettings({
      policy: 'strict',
      policies: ['off', 'strict', 'lookups'],
      quick_steps: 7,
      quick_steps_choices: [3, 5, 10, 0],
      coordination: 'ask',
      max_running: 2,
      max_running_limit: 6,
      after_restart: 'ask',
      workstream_approvals: 'off',
      workstream_model: { model: 'x/y', provider: 'openrouter' }
    })
    expect(s).toMatchObject({ policy: 'strict', maxRunning: 2, maxRunningLimit: 6, afterRestart: 'ask', approvals: 'off', coordination: 'ask' })
    expect(s.model).toEqual({ model: 'x/y', provider: 'openrouter', reasoningEffort: undefined })
    // Everything Here only where the plugin takes it.
    expect(policyChoices(s).map(c => c.id)).toEqual(['lookups', 'strict'])
    expect(quickStepsChoices(s)).toEqual([3, 5, 7, 10])
    const bare = parseWorkSettings({})
    expect(bare).toMatchObject({ policy: 'lookups', approvals: 'chats', afterRestart: 'continue', model: null, coordination: undefined })
  })

  it("saves the Bot Chat's own model as null", () => {
    expect(modelBody(null)).toBeNull()
    expect(modelBody({ model: 'm' })).toEqual({ model: 'm' })
  })
})
