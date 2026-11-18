import { describe, expect, it } from 'vitest'
import { chatListPath, mergeRows, refreshFirstPage, responseCount, rowsFromResponse, sectionRows, toMillis } from '../src/renderer/src/state/chats'

const now = new Date(2026, 10, 18, 15, 0).getTime()
const hoursAgo = (h: number) => (now - h * 3_600_000) / 1000

describe('chat rows', () => {
  it('reads dashboard rows, leaves out non-chats and duplicates', () => {
    const rows = rowsFromResponse({
      sessions: [
        { id: 'a', title: 'Q3 spending', preview: 'Total\nthe quarter', last_active: hoursAgo(1), profile: 'default', pinned: false },
        { id: 'a', title: 'duplicate' },
        { id: 'b', title: '', preview: 'Untitled one', started_at: hoursAgo(30), profile: 'furina', pinned: 1 },
        { id: 'c', title: 'Nightly backup', source: 'cron', last_active: hoursAgo(2) }
      ]
    })
    expect(rows).toEqual([
      { id: 'a', title: 'Q3 spending', preview: 'Total the quarter', activeAt: now - 3_600_000, profile: 'default', pinned: false, source: undefined, messageCount: undefined },
      { id: 'b', title: 'Untitled one', preview: undefined, activeAt: now - 30 * 3_600_000, profile: 'furina', pinned: true, source: undefined, messageCount: undefined }
    ])
  })

  it('reads the gateway list shape too', () => {
    expect(rowsFromResponse({ sessions: [{ id: 'x', title: 'Hi', started_at: 1 }] })[0]?.id).toBe('x')
  })

  it('takes seconds, milliseconds and finer units', () => {
    expect(toMillis(1_763_000_000)).toBe(1_763_000_000_000)
    expect(toMillis(1_763_000_000_000)).toBe(1_763_000_000_000)
    expect(toMillis(1_763_000_000_000_000)).toBeCloseTo(1_763_000_000_000)
    expect(toMillis(0)).toBeUndefined()
  })

  it('groups pinned first, then by day', () => {
    const rows = rowsFromResponse({
      sessions: [
        { id: 'old', title: 'Old', last_active: hoursAgo(24 * 20) },
        { id: 'today', title: 'Today', last_active: hoursAgo(2) },
        { id: 'pin', title: 'Pinned', last_active: hoursAgo(24 * 40), pinned: true },
        { id: 'yday', title: 'Yesterday', last_active: hoursAgo(20) },
        { id: 'week', title: 'Week', last_active: hoursAgo(24 * 4) }
      ]
    })
    expect(sectionRows(rows, now).map(s => [s.title, s.rows.map(r => r.id)])).toEqual([
      ['Pinned', ['pin']],
      ['Today', ['today']],
      ['Yesterday', ['yday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old']]
    ])
  })
})

describe('chat list pages', () => {
  const row = (id: string, activeAt: number) => ({ id, title: id, pinned: false, activeAt })

  it('asks for each page by offset', () => {
    expect(chatListPath(400)).toContain('limit=200&offset=400')
  })

  it('counts a page before any rows are left out', () => {
    expect(responseCount({ sessions: [{ id: 'a', source: 'cron' }, { id: 'b' }] })).toBe(2)
    expect(responseCount([{}, {}, {}])).toBe(3)
    expect(responseCount(null)).toBe(0)
  })

  it('adds a later page without repeating a chat that moved up', () => {
    expect(mergeRows([row('a', 3), row('b', 2)], [row('b', 2), row('c', 1)]).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('refreshes the first page over the older pages already read', () => {
    const existing = [row('a', 50), row('b', 40), row('c', 10), row('d', 5)]
    const page = [row('new', 60), row('a', 55), row('b', 40)]
    expect(refreshFirstPage(existing, page, true).map(r => r.id)).toEqual(['new', 'a', 'b', 'c', 'd'])
    expect(refreshFirstPage(existing, page, false).map(r => r.id)).toEqual(['new', 'a', 'b'])
  })

  it('cleans previews', () => {
    const [r] = rowsFromResponse([{ id: 'x', title: 'Report', preview: '@file:/tmp/q.pdf\nSummarize this' }])
    expect(r?.preview).toBe('Summarize this')
  })
})
