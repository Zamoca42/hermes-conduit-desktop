import { describe, expect, it } from 'vitest'
import { currentItem, isFinished, isNewPlan, parsePlan, planCounts, planFromChecklist } from '../src/renderer/src/state/plan'
import { applyEvent, emptyTranscript } from '../src/renderer/src/state/transcript'

describe('plan', () => {
  it('reads a todo result, a JSON string included, and nothing else', () => {
    const plan = parsePlan(
      JSON.stringify({
        todos: [
          { id: '1', content: 'Read the code', status: 'completed' },
          { id: '2', content: 'Fix it', status: 'in_progress' },
          { id: '2b', content: 'Write a test', status: 'pending', parent: '2' },
          { id: '3', content: 'Old idea', status: 'cancelled' },
          { id: '1', content: 'Read the code again', status: 'completed' }
        ]
      })
    )!
    expect(plan.items.map(i => [i.id, i.depth])).toEqual([
      ['2', 0],
      ['2b', 1],
      ['3', 0],
      ['1', 0]
    ])
    expect(planCounts(plan)).toEqual({ done: 1, total: 3 })
    expect(currentItem(plan)?.content).toBe('Fix it')
    expect(isFinished(plan)).toBe(false)
    expect(parsePlan({ error: 'x' })).toBeNull()
    expect(parsePlan('not json')).toBeNull()
  })

  it('makes a looping parent chain a root', () => {
    const plan = parsePlan({
      todos: [
        { id: 'a', content: 'A', parent: 'b' },
        { id: 'b', content: 'B', parent: 'a' }
      ]
    })!
    expect(plan.items.map(i => i.depth)).toEqual([0, 0])
  })

  it('tells a new plan from an update of the last one', () => {
    const first = parsePlan({
      todos: [
        { id: '1', content: 'A' },
        { id: '2', content: 'B' }
      ]
    })!
    const update = parsePlan({
      todos: [
        { id: '1', content: 'A', status: 'completed' },
        { id: '2', content: 'B' }
      ]
    })!
    const other = parsePlan({ todos: [{ id: '9', content: 'Z' }] })!
    expect(isNewPlan(update, first)).toBe(false)
    expect(isNewPlan(other, first)).toBe(true)
  })

  it('takes a workstream checklist as the plan', () => {
    const plan = planFromChecklist([
      { text: 'One', state: 'done' },
      { text: 'Two', state: 'doing' }
    ])!
    expect(plan.items.map(i => i.status)).toEqual(['completed', 'in_progress'])
    expect(planFromChecklist([])).toBeNull()
  })

  it('follows the todo tool in a live turn', () => {
    let state = applyEvent(emptyTranscript, { type: 'tool.start', payload: { tool_id: 't1', name: 'todo_list' } })
    state = applyEvent(state, { type: 'tool.complete', payload: { tool_id: 't1', result: '{"todos":[{"id":"1","content":"Plan","status":"pending"}]}' } })
    expect(state.plan?.items[0]?.content).toBe('Plan')
    state = applyEvent(state, { type: 'tool.complete', payload: { tool_id: 'other', name: 'terminal', result: '{"todos":[]}' } })
    expect(state.plan?.items).toHaveLength(1)
  })
})

describe('plan through a turn', () => {
  it('keeps the plan when the turn completes', () => {
    let state = applyEvent(emptyTranscript, { type: 'tool.start', payload: { tool_id: 't1', name: 'todo_list' } })
    state = applyEvent(state, { type: 'tool.complete', payload: { tool_id: 't1', result: { todos: [{ id: '1', content: 'Plan' }] } } })
    state = applyEvent(state, { type: 'message.complete', payload: { text: 'Done' } })
    expect(state.plan?.items).toHaveLength(1)
  })
})
