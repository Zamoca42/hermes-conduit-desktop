import { describe, expect, it } from 'vitest'
import { delegationReport, modelChange, timelineNotice } from '../src/renderer/src/state/timeline'
import { fromHistory } from '../src/renderer/src/state/transcript'

const BATCH = `[ASYNC DELEGATION BATCH COMPLETE — deleg_a1]
A background fan-out unit you dispatched earlier has finished.

Context you provided: Just reply with a short count.

--- ✓ TASK 1/2: Count to three
slowly  (status=completed, api_calls=1, 0.29s) ---
One, two, three.
Full live transcript (complete tool/assistant trace): /tmp/x/task-0.log
--- ✗ TASK 2/2: Fetch the page  (status=failed, api_calls=2, 4.5s) ---
The site refused.`

describe('timeline rows', () => {
  it('reads a batch of background agents', () => {
    expect(delegationReport(BATCH)).toEqual([
      { number: 1, goal: 'Count to three slowly', outcome: 'completed', duration: 0.29, result: 'One, two, three.' },
      { number: 2, goal: 'Fetch the page', outcome: 'failed', duration: 4.5, result: 'The site refused.' }
    ])
    expect(delegationReport('[ASYNC DELEGATION BATCH COMPLETE]\n--- ✓ TASK 1/1 broken header')).toBeNull()
    expect(delegationReport('hello')).toBeNull()
  })

  it('reads one agent and an early failure', () => {
    const single =
      '[ASYNC DELEGATION COMPLETE]\nOriginal goal: Summarize\nthe notes\nToolsets: web\nStatus: completed   API calls: 3   Duration: 12.5s\n--- RESULT ---\nDone.'
    expect(delegationReport(single)).toEqual([{ number: 1, goal: 'Summarize the notes', outcome: 'completed', duration: 12.5, result: 'Done.' }])
    const failed = '[ASYNC DELEGATION TASK FAILED — task 3/4]\nTask: Book a table\nStatus: failed   Duration: 2s\nError: no network'
    expect(delegationReport(failed)).toEqual([{ number: 3, goal: 'Book a table', outcome: 'failed', duration: 2, result: 'no network' }])
  })

  it('names each kind as the phone does', () => {
    expect(modelChange('[System: The active model for this chat has changed to gpt-5 via provider openai. From this point forward, …]')).toEqual({
      model: 'gpt-5',
      provider: 'openai'
    })
    expect(timelineNotice('model_switch', '[System: The active model for this chat has changed to gpt-5 via provider openai.]', null)).toBe(
      'Model has been changed to openai/gpt-5'
    )
    expect(timelineNotice('async_delegation_complete', '', { task_count: 2 })).toBe('2 background agents finished')
    expect(timelineNotice('async_delegation_complete', '', { display_text: 'Subagent done' })).toBe('Subagent done')
    expect(timelineNotice('process_complete', '[IMPORTANT: wall]', null)).toBe('Background process finished')
    expect(timelineNotice('internal_notification', '[System: Woke up]', null)).toBe('Woke up')
    expect(timelineNotice('personality_switch', 'long persona', null, 'Now: pirate')).toBe('Now: pirate')
    expect(timelineNotice('skill_invocation', 'x', null)).toBeNull()
  })

  it('history shows the notice or the agents, never the scaffold as your message', () => {
    const items = fromHistory([
      { role: 'user', content: BATCH, display_kind: 'async_delegation_complete', display_metadata: { task_count: 2 } },
      { role: 'user', content: '[IMPORTANT: …]', display_kind: 'process_complete', display_metadata: { display_text: 'npm test finished' } }
    ])
    expect(items).toMatchObject([
      { kind: 'delegation', title: '2 background agents finished' },
      { kind: 'notice', text: 'npm test finished' }
    ])
  })
})
