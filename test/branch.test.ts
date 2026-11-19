import { describe, expect, it } from 'vitest'
import { branchPlan } from '../src/renderer/src/state/branch'
import type { TranscriptItem } from '../src/renderer/src/state/transcript'

const items = [
  { kind: 'user', key: 'u1', text: 'Plan a hike' },
  { kind: 'thinking', key: 't1', text: 'hmm', streaming: false },
  { kind: 'assistant', key: 'a1', text: 'Try the ridge', streaming: false, rowId: 2 },
  { kind: 'user', key: 'u2', text: ' Shorter? ' },
  { kind: 'assistant', key: 'a2', text: 'The lake loop', streaming: false },
  { kind: 'user', key: 'u3', text: 'sending', pending: true }
] as unknown as TranscriptItem[]

describe('Branch', () => {
  it('carries your messages and the replies through the reply, and stops at its row', () => {
    expect(branchPlan(items, 'a1')).toEqual({
      messages: [
        { role: 'user', content: 'Plan a hike' },
        { role: 'assistant', content: 'Try the ridge' }
      ],
      rowId: 2,
      newest: false
    })
  })

  it('knows the newest reply, a message still sending aside, and branches only from a reply', () => {
    const settled = items.slice(0, 5)
    expect(branchPlan(settled, 'a2')).toMatchObject({ newest: true, messages: [{}, {}, { content: 'Shorter?' }, {}] })
    expect(branchPlan(items, 'a2')?.newest).toBe(false)
    expect(branchPlan(items, 'u1')).toBeNull()
    expect(branchPlan(items, 'nope')).toBeNull()
  })
})
