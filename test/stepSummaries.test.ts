import { describe, expect, it } from 'vitest'
import { cleaned, explainQuestion, isDistinct, lastRun, question, runKey, sideQuestionAnswer, words } from '../src/renderer/src/state/stepSummaries'
import type { TranscriptItem, ToolItem } from '../src/renderer/src/state/transcript'

const tool = (toolId: string, extra: Partial<ToolItem> = {}): ToolItem => ({ kind: 'tool', key: toolId, toolId, name: 'terminal', status: 'done', ...extra })
const user: TranscriptItem = { kind: 'user', key: 'u', text: 'hi' } as TranscriptItem
const reply: TranscriptItem = { kind: 'assistant', key: 'r', text: 'ok', streaming: false } as TranscriptItem

describe('step summaries', () => {
  it('keys a run by its first distinct tool call', () => {
    expect(isDistinct('call_abcdef123456')).toBe(true)
    expect(isDistinct('functions.web_search:0')).toBe(false)
    expect(runKey([tool('call_abcdef123456'), tool('call_x')])).toBe('call_abcdef123456')
    expect(runKey([tool('short')])).toBeNull()
  })
  it('finds the last finished run after your last message', () => {
    expect(lastRun([user, tool('call_aaaaaaaaaaaa'), tool('call_bbbbbbbbbbbb'), reply])).toHaveLength(2)
    expect(lastRun([tool('call_aaaaaaaaaaaa'), tool('call_bbbbbbbbbbbb'), user, reply])).toBeNull()
    expect(lastRun([user, tool('call_aaaaaaaaaaaa'), tool('call_bbbbbbbbbbbb', { status: 'running' })])).toBeNull()
    expect(lastRun([user, tool('call_aaaaaaaaaaaa'), reply])).toBeNull()
  })
  it('asks the phone question word for word', () => {
    const q = question('German', words(3))
    expect(q.startsWith("Look back at the tool calls you made just before your last reply. Only the calls since the user's last message")).toBe(true)
    expect(q).toContain('In German, tell the user, looking back')
    expect(q).toContain('at most 18 words')
    expect(q.endsWith('Reply with the paragraph only.')).toBe(true)
  })
  it('lists the calls it explains', () => {
    const q = explainQuestion('English', 36, [tool('call_aaaaaaaaaaaa', { args: '{"command": "ls"}', result: 'a  b' })])
    expect(q).toContain('1. terminal {"command": "ls"}\n   → a b')
  })
  it('cleans the answer to one paragraph', () => {
    expect(cleaned('- **First** I looked\n- then I read it')).toBe('First I looked then I read it')
    expect(cleaned('"Quoted."')).toBe('Quoted.')
    expect(cleaned('Error: nope')).toBeNull()
    expect(sideQuestionAnswer({ ok: true, text: ' ' })).toBeNull()
    expect(sideQuestionAnswer({ ok: true, text: 'Fine' })).toBe('Fine')
  })
})
