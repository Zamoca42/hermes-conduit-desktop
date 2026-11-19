import { describe, expect, it } from 'vitest'
import { guesses, repliesBody, settledReply } from '../src/renderer/src/state/predictive'
import type { TranscriptItem } from '../src/renderer/src/state/transcript'

describe('predictive replies', () => {
  it('keeps guesses best first, drops blank, long and repeated ones', () => {
    const long = 'x'.repeat(201)
    const answer = {
      replies: [
        { text: 'Sounds good', p: 0.4 },
        { text: '  Thanks!  ', p: 0.9 },
        { text: 'thanks!', p: 0.8 },
        { text: '', p: 1 },
        { text: long, p: 1 },
        { text: 'Tell me more' },
        'not an object'
      ]
    }
    expect(guesses(answer)).toEqual(['Thanks!', 'Tell me more', 'Sounds good'])
    expect(guesses(null)).toEqual([])
  })

  it('asks for a clamped count', () => {
    expect(repliesBody('s1', 9, 'English', 'fast')).toEqual({ session_id: 's1', kind: 'replies', count: 5, language: 'English', model: 'fast', wait_s: 20 })
  })

  it('keys only a settled reply', () => {
    const user: TranscriptItem = { kind: 'user', key: 'u', text: 'hi' } as TranscriptItem
    const reply: TranscriptItem = { kind: 'assistant', key: 'a', text: 'Hello there', streaming: false }
    expect(settledReply([user, reply], false)).toBe('1:11:Hello there')
    expect(settledReply([user, reply], true)).toBeNull()
    expect(settledReply([user, { ...reply, streaming: true } as TranscriptItem], false)).toBeNull()
    expect(settledReply([reply, user], false)).toBeNull()
    expect(settledReply([user, { kind: 'notice', key: 'n', text: 'x', tone: 'error' }], false)).toBeNull()
  })
})
