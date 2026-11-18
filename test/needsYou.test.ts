import { describe, expect, it } from 'vitest'
import type { PendingRequest } from '../src/shared/ipc'
import {
  approvalView,
  clarifyQuestions,
  lockedAnswers,
  requestSummary,
  unmatchedWaiting,
  waitingFromResponse,
  waitingPath
} from '../src/renderer/src/state/needsYou'

const request = (over: Partial<PendingRequest>): PendingRequest => ({ id: 'r', method: 'approval', sessionId: 's', params: {}, receivedAt: 0, ...over })

describe('approvals', () => {
  it('labels the choices Hermes offers, in its order', () => {
    const view = approvalView({ description: 'Delete build', command: 'rm -rf build', choices: ['once', 'session', 'always', 'deny'] })
    expect(view.description).toBe('Delete build')
    expect(view.command).toBe('rm -rf build')
    expect(view.choices.map(c => [c.choice, c.label, c.tone])).toEqual([
      ['once', 'Allow once', 'primary'],
      ['session', 'Allow for this chat', 'plain'],
      ['always', 'Always allow', 'plain'],
      ['deny', 'Deny', 'danger']
    ])
  })

  it('falls back to once or deny, and a plain description', () => {
    const view = approvalView({})
    expect(view.choices.map(c => c.choice)).toEqual(['once', 'deny'])
    expect(view.description).toBe('Hermes wants to run a command.')
    expect(view.command).toBeUndefined()
  })
})

describe('questions', () => {
  it('reads a batch and what it already locked', () => {
    const params = {
      questions: [
        { qid: 'q1', question: 'Which color?', choices: ['Red', 'Blue', ''], multi_select: false },
        { qid: 'q2', question: 'Toppings?', choices: ['Cheese', 'Ham'], multi_select: true },
        { qid: 'q3', question: '' }
      ],
      answers: { q1: 'Red', q2: null }
    }
    expect(clarifyQuestions(params)).toEqual([
      { qid: 'q1', question: 'Which color?', choices: ['Red', 'Blue'], multiSelect: false },
      { qid: 'q2', question: 'Toppings?', choices: ['Cheese', 'Ham'], multiSelect: true }
    ])
    expect(lockedAnswers(params)).toEqual({ q1: 'Red', q2: null })
  })

  it('summarizes a batch by its first question', () => {
    expect(requestSummary(request({ method: 'clarify', params: { questions: [{ qid: 'a', question: 'One?' }, { qid: 'b', question: 'Two?' }] } }))).toBe('One? (+1 more)')
    expect(requestSummary(request({ params: { description: 'Run tests' } }))).toBe('Run tests')
  })
})

describe('the waiting list', () => {
  it('reads the plugin’s rows, with seconds as milliseconds', () => {
    const rows = waitingFromResponse(
      { ok: true, waiting: [{ id: 'w1', kind: 'question', session_ids: ['stored-1', 'live-1'], title: 'Trip [Recent voice conv', summary: 'Which day?', questions: 2, at: 1_763_000_000 }, { id: 'bad' }] },
      'work'
    )
    expect(rows).toEqual([
      { id: 'w1', kind: 'question', sessionIds: ['stored-1', 'live-1'], title: 'Trip', summary: 'Which day?', questions: 2, at: 1_763_000_000_000, profile: 'work' }
    ])
  })

  it('asks per profile', () => {
    expect(waitingPath()).toBe('/api/plugins/conduit_push/waiting')
    expect(waitingPath('my bot')).toBe('/api/plugins/conduit_push/waiting?profile=my%20bot')
  })

  it('lists a wait once when a live request already shows it', () => {
    const rows = waitingFromResponse({ waiting: [{ id: 'w1', kind: 'approval', session_ids: ['stored-1', 'live-1'], at: 1 }, { id: 'w2', kind: 'approval', session_ids: ['stored-2'], at: 1 }] })
    expect(unmatchedWaiting(rows, [request({ sessionId: 'live-1' })]).map(r => r.id)).toEqual(['w2'])
  })
})
