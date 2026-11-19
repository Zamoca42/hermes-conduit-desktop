import { describe, expect, it } from 'vitest'
import { contentRows, contentSearchPath, hitsFrom, parseSnippet, searchableQuery } from '../src/renderer/src/state/contentSearch'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, profile?: string): ChatRow => ({ id, title: `Chat ${id}`, pinned: false, profile })

describe('In messages', () => {
  it('asks only once there are words to search', () => {
    expect(searchableQuery(' a ')).toBeNull()
    expect(searchableQuery('"gpu": setup*')).toBe('gpu setup')
    expect(contentSearchPath('gpu setup', 'furina')).toBe('/api/sessions/search?q=gpu%20setup&limit=60&exclude_sources=kanban,oneshot,tool&profile=furina')
    expect(contentSearchPath('x y', 'default')).not.toContain('profile=')
  })

  it('reads Hermes’ marks, and marks the words itself when there are none', () => {
    expect(parseSnippet('...the >>>GPU<<< setup\nworks...', 'gpu')).toEqual([
      { text: '…the ', match: false },
      { text: 'GPU', match: true },
      { text: ' setup works…', match: false }
    ])
    // A `>>>` Hermes didn't close is the message's own text.
    expect(parseSnippet('>>> print(1) then >>>x<<<', 'x')).toEqual([
      { text: '>>> print(1) then ', match: false },
      { text: 'x', match: true }
    ])
    expect(parseSnippet('Recycling bins', 'recycling')).toEqual([
      { text: 'Recycling', match: true },
      { text: ' bins', match: false }
    ])
  })

  it('keeps each chat once, drops old Kanban workers, and leaves out what the list shows', () => {
    const hits = hitsFrom(
      {
        results: [
          { session_id: 'a', snippet: '>>>gpu<<<', title: 'GPU', last_active: 10 },
          { session_id: 'a', snippet: 'again' },
          { session_id: 'w', snippet: 'x', source: 'local', preview: 'work kanban task t_9f2c' },
          { session_id: 'b', lineage_root: 'root', snippet: 'gpu', archived: false },
          { session_id: 'c', snippet: 'gpu', archived: true },
          { session_id: 'd', snippet: 'gpu' }
        ]
      },
      'gpu',
      'default'
    )!
    expect(hits.map(h => h.sessionId)).toEqual(['a', 'b', 'c', 'd'])
    expect(hitsFrom({ nope: 1 }, 'gpu', 'default')).toBeNull()
    const rows = contentRows(hits, [row('a')], [row('a'), row('root'), row('d', 'furina')])
    // a is listed already, c archived; b opens its listed lineage root; d is another profile's chat, so not known here.
    expect(rows.map(r => [r.row.id, r.row.title])).toEqual([
      ['root', 'Chat root'],
      ['d', '']
    ])
    expect(contentRows(hits, [], [row('a')], [row('a')]).map(r => r.row.id)).toEqual(['a'])
  })
})
