import { describe, expect, it } from 'vitest'
import { askable, draftBody, draftGuesses, guesses, repliesBody, settledReply } from '../src/renderer/src/state/predictive'
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

describe('predictive draft guesses', () => {
  it('keeps a continuation’s leading space and drops long or repeated ones', () => {
    const answer = {
      next: [{ text: ' the  weather' }, { text: 'ing' }, { text: ' the weather' }, { text: ' ' + 'x'.repeat(70) }, { text: '  ' }],
      replies: [{ text: 'What is the weather?', p: 1 }]
    }
    expect(draftGuesses(answer)).toEqual({ next: [' the weather', 'ing'], replies: ['What is the weather?'] })
  })

  it('asks only about a draft that fits', () => {
    expect(askable('hi')).toBe(false)
    expect(askable('  a  ')).toBe(false)
    expect(askable('hey')).toBe(true)
    expect(askable('😀'.repeat(2000))).toBe(true)
    expect(askable('😀'.repeat(2001))).toBe(false)
  })

  it('asks with the draft and a short wait', () => {
    expect(draftBody('s', 'what is', 3, 'English', 'chat')).toEqual({
      session_id: 's',
      kind: 'draft',
      draft: 'what is',
      count: 3,
      language: 'English',
      model: 'chat',
      wait_s: 4
    })
  })
})
