import { describe, expect, it } from 'vitest'
import { ancestorsOf, descendants, nestRows, nestSummary } from '../src/renderer/src/state/chatNesting'
import { withVoice, type VoiceList } from '../src/renderer/src/state/voiceList'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, extra: Partial<ChatRow> = {}): ChatRow => ({ id, title: id, pinned: false, ...extra })

describe("voice jobs nested under the row they came from (the phone's nests)", () => {
  it('nests a job under its call, newest first, and leaves the rest flat', () => {
    const rows = [row('call', { activeAt: 5 }), row('old', { nestUnder: 'call', activeAt: 1 }), row('new', { nestUnder: 'call', activeAt: 3 }), row('chat')]
    const nesting = nestRows(rows)
    expect(nesting.children.get('call')!.map(r => r.id)).toEqual(['new', 'old'])
    expect([...nesting.nested].sort()).toEqual(['new', 'old'])
  })

  it('matches a lineage root, but only in the same profile', () => {
    const rows = [row('chat2', { lineageRoot: 'chat1', profile: 'work' }), row('job', { nestUnder: 'chat1', profile: 'work' }), row('other', { nestUnder: 'chat1' })]
    const nesting = nestRows(rows)
    expect(nesting.children.get('chat2')!.map(r => r.id)).toEqual(['job'])
    expect(nesting.nested.has('other')).toBe(false)
  })

  it('keeps a pinned row, a row naming itself, a missing parent and a cycle at the top', () => {
    const rows = [
      row('call'),
      row('pinned', { nestUnder: 'call', pinned: true }),
      row('self', { nestUnder: 'self' }),
      row('lost', { nestUnder: 'gone' }),
      row('a', { nestUnder: 'b' }),
      row('b', { nestUnder: 'a' })
    ]
    const nesting = nestRows(rows)
    expect(nesting.nested.has('pinned')).toBe(false)
    expect(nesting.nested.has('self')).toBe(false)
    expect(nesting.nested.has('lost')).toBe(false)
    // One of the cycle stays on top, so neither row is lost.
    expect(nesting.nested.size).toBe(1)
  })

  it('names the parents to open for the chat shown, and what sits under a row', () => {
    const rows = [row('chat'), row('job', { nestUnder: 'chat' }), row('sub', { nestUnder: 'job' })]
    const nesting = nestRows(rows)
    expect([...ancestorsOf(nesting, 'sub')].sort()).toEqual(['chat', 'job'])
    expect(ancestorsOf(nesting, 'chat').size).toBe(0)
    expect(descendants(nesting, rows[0]!).map(r => r.id)).toEqual(['job', 'sub'])
  })

  it("sums up a nest in the phone's words", () => {
    const jobs = [row('a', { sourceKind: 'voice_job' }), row('b', { sourceKind: 'voice_job' })]
    expect(nestSummary(jobs, r => r.id === 'a', () => false)).toBe('2 jobs · 1 running')
    expect(nestSummary([jobs[0]!], () => false, r => r.id === 'a')).toBe('1 job · 1 to approve')
    expect(nestSummary([row('c')], () => false, () => false)).toBe('1 session')
  })

  it('a tagged job carries the row it came from', () => {
    const voice: VoiceList = {
      tags: new Map([['default', new Map([['job', { kind: 'job' as const, engine: null, parentId: 'chat', parentTitle: 'Plans' }]])]]),
      callChats: new Map()
    }
    const [, job] = withVoice([row('chat'), row('job')], [], voice)
    expect(job).toMatchObject({ sourceKind: 'voice_job', nestUnder: 'chat' })
  })
})
