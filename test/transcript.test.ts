import { describe, expect, it } from 'vitest'
import {
  addPendingUser,
  applyEvent,
  emptyTranscript,
  failPendingUser,
  fromHistory,
  type TranscriptState
} from '../src/renderer/src/state/transcript'

const play = (events: { type: string; payload?: unknown }[], start: TranscriptState = emptyTranscript) =>
  events.reduce(applyEvent, start)

const kinds = (state: TranscriptState) => state.items.map(i => i.kind)

describe('stored history', () => {
  it('keeps user, reasoning, reply and tool rows in order and drops hidden ones', () => {
    const items = fromHistory([
      { role: 'system', text: 'You are Hermes' },
      { role: 'user', text: 'Total Q3', timestamp: 1_700_000_000, row_id: 1 },
      { role: 'assistant', text: 'Checking.', reasoning: 'Need the export', row_id: 2 },
      { role: 'tool', name: 'terminal', context: 'cat budget.csv', tool_call_id: 'c1', row_id: 3 },
      { role: 'user', text: 'hidden nudge', display_kind: 'hidden', row_id: 4 },
      { role: 'assistant', content: [{ type: 'text', text: 'Q3 was $72 over.' }], row_id: 5 }
    ])
    expect(items.map(i => i.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'assistant'])
    expect(items[0]).toMatchObject({ text: 'Total Q3', at: 1_700_000_000_000 })
    expect(items[3]).toMatchObject({ name: 'terminal', context: 'cat budget.csv', status: 'done' })
    expect(items[4]).toMatchObject({ text: 'Q3 was $72 over.' })
  })
})

describe('a live turn', () => {
  it('streams a reply, splits it around a tool step and ends', () => {
    const state = play(
      [
        { type: 'message.start' },
        { type: 'reasoning.delta', payload: { text: 'Plan: ' } },
        { type: 'reasoning.delta', payload: { text: 'run it' } },
        { type: 'message.delta', payload: { text: 'Let me ' } },
        { type: 'message.delta', payload: { text: 'check.' } },
        { type: 'message.delta', payload: { text: null } },
        { type: 'tool.start', payload: { tool_id: 't1', name: 'terminal', context: 'echo hi' } },
        { type: 'status.update', payload: { kind: 'tool', text: 'running echo' } },
        { type: 'tool.complete', payload: { tool_id: 't1', name: 'terminal', duration_s: 0.4, summary: 'hi' } },
        { type: 'message.delta', payload: { text: 'It said hi.' } },
        { type: 'message.complete', payload: { text: 'Let me check.It said hi.', status: 'complete' } }
      ],
      addPendingUser(emptyTranscript, 'run echo')
    )
    expect(kinds(state)).toEqual(['user', 'thinking', 'assistant', 'tool', 'assistant'])
    expect(state.running).toBe(false)
    expect(state.status).toBeUndefined()
    expect(state.items[0]).toMatchObject({ pending: false })
    expect(state.items[1]).toMatchObject({ text: 'Plan: run it', streaming: false })
    expect(state.items[2]).toMatchObject({ text: 'Let me check.', streaming: false })
    expect(state.items[3]).toMatchObject({ status: 'done', durationS: 0.4, summary: 'hi' })
    expect(state.items[4]).toMatchObject({ text: 'It said hi.', streaming: false })
  })

  it('ignores the terminal spinner and shows the status line while running', () => {
    const state = play([
      { type: 'message.start' },
      { type: 'thinking.delta', payload: { text: '(¬_¬) contemplating...' } },
      { type: 'status.update', payload: { kind: 'tool', text: 'reading files' } }
    ])
    expect(state.items).toEqual([])
    expect(state).toMatchObject({ running: true, status: 'reading files' })
  })

  it('uses the final text when nothing streamed', () => {
    const state = play([{ type: 'message.start' }, { type: 'message.complete', payload: { text: 'Done.' } }])
    expect(state.items).toMatchObject([{ kind: 'assistant', text: 'Done.' }])
  })

  it('says why a turn failed, and that a stopped one stopped', () => {
    const failed = play([{ type: 'message.start' }, { type: 'message.complete', payload: { status: 'error', error: 'Rate limited' } }])
    expect(failed.items).toMatchObject([{ kind: 'notice', tone: 'error', text: 'Rate limited' }])
    const stopped = play([
      { type: 'message.start' },
      { type: 'tool.start', payload: { tool_id: 't', name: 'terminal' } },
      { type: 'message.complete', payload: { status: 'interrupted' } }
    ])
    expect(stopped.items).toMatchObject([{ kind: 'tool', status: 'done' }, { kind: 'notice', text: 'Stopped' }])
  })

  it('shows a message sent from the phone', () => {
    const state = play([{ type: 'user.message', payload: { text: 'from my phone' } }])
    expect(state.items).toMatchObject([{ kind: 'user', text: 'from my phone' }])
  })
})

describe('sending', () => {
  it('keeps a failed send visible with the reason', () => {
    const state = failPendingUser(addPendingUser(emptyTranscript, 'hello'), 'Not connected to Hermes.')
    expect(state.items).toMatchObject([
      { kind: 'user', text: 'hello', pending: false },
      { kind: 'notice', tone: 'error', text: 'Not sent: Not connected to Hermes.' }
    ])
  })
})
