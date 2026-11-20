import { beforeEach, describe, expect, it } from 'vitest'
import type { PendingRequest } from '../src/shared/ipc'
import { answering, clearExpired, expiredFor, markExpired, noteLocked, noteRequests, resetExpiredQuestions, takeCancel } from '../src/renderer/src/state/expiredQuestions'
import { insertQuote } from '../src/renderer/src/state/quote'

const ask = (id: string, sessionId = 's1'): PendingRequest => ({
  id,
  method: 'clarify',
  sessionId,
  params: { questions: [{ id: 'q1', question: 'Run the fix?', choices: ['Yes', 'No'] }] },
  receivedAt: 1
})

describe('questions Hermes stopped waiting for (issue 2850)', () => {
  beforeEach(resetExpiredQuestions)

  it('keeps a question whose wait timed out or whose turn stopped', () => {
    noteRequests([ask('a'), ask('b')])
    takeCancel({ id: 'a', method: 'clarify', reason: 'timeout' })
    takeCancel({ id: 'b', method: 'clarify', reason: 'interrupted' })
    expect(expiredFor('s1').map(e => e.request.id)).toEqual(['a', 'b'])
  })

  it('lets one answered on another device go', () => {
    noteRequests([ask('a')])
    takeCancel({ id: 'a', method: 'clarify', reason: 'resolved' })
    takeCancel({ id: 'a', method: 'clarify', reason: 'timeout' })
    expect(expiredFor('s1')).toEqual([])
  })

  it('ignores approvals and requests it never showed', () => {
    noteRequests([{ ...ask('a'), method: 'approval' }])
    takeCancel({ id: 'a', reason: 'timeout' })
    takeCancel({ id: 'zz', reason: 'timeout' })
    expect(expiredFor('s1')).toEqual([])
  })

  it('carries the answers locked here, and stays with its own chat until a message is sent there', () => {
    noteRequests([ask('a'), ask('b', 's2')])
    noteLocked('a', 'q1', 'Yes')
    takeCancel({ id: 'a', reason: 'timeout' })
    markExpired(ask('b', 's2'))
    expect(expiredFor('s1')[0]!.locked).toEqual({ q1: 'Yes' })
    clearExpired('s1')
    expect(expiredFor('s1')).toEqual([])
    expect(expiredFor('s2')).toHaveLength(1)
  })

  it('puts the question in the draft as a quote with the choice under it', () => {
    expect(answering('Run the fix?\nOne more cycle.', ' Yes, run it ')).toBe('> Run the fix?\n> One more cycle.\n\nYes, run it')
    expect(answering('Which branch?', null)).toBe('> Which branch?')
    expect(answering('Which branch?', '  ')).toBe('> Which branch?')
    expect(answering(' \n', 'Yes')).toBe('')
    expect(insertQuote(answering('Run it?', 'Yes'), 'Draft')).toBe('Draft\n\n> Run it?\n\nYes\n\n')
  })
})
