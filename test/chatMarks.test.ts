import { describe, expect, it } from 'vitest'
import { filterRows, isStarred, isUnread, markRead, markUnread, toggleStar, type ChatMarks } from '../src/renderer/src/state/chatMarks'

const marks = (): ChatMarks => ({ stars: [], seen: {}, baseline: 1000, unread: [] })
const row = (id: string, activeAt: number, profile?: string) => ({ id, title: id, activeAt, profile, pinned: false })

describe('stars and read state', () => {
  it('counts chats from before the first look as read, and later activity as unread until opened', () => {
    let m = marks()
    expect(isUnread(m, row('old', 900))).toBe(false)
    expect(isUnread(m, row('new', 2000))).toBe(true)
    m = markRead(m, row('new', 2000))
    expect(isUnread(m, row('new', 2000))).toBe(false)
    expect(isUnread(m, row('new', 3000))).toBe(true)
    expect(markRead(m, row('old', 900))).toBe(m)
  })

  it('marks one chat unread by hand without touching the others', () => {
    let m = markUnread(marks(), row('old', 900))
    expect(isUnread(m, row('old', 900))).toBe(true)
    expect(isUnread(m, row('other', 950))).toBe(false)
    m = markRead(m, row('old', 900))
    expect(isUnread(m, row('old', 900))).toBe(false)
  })

  it('honors Hermes’ read flag until the chat is seen here', () => {
    const flagged = { ...row('old', 900), unread: true }
    let m = marks()
    expect(isUnread(m, flagged)).toBe(true)
    m = markRead(m, flagged)
    expect(isUnread(m, flagged)).toBe(false)
  })

  it('stars a chat in its profile, and filters by star, unread and running', () => {
    let m = toggleStar(marks(), row('a', 900, 'work'))
    expect(isStarred(m, row('a', 900, 'work'))).toBe(true)
    expect(isStarred(m, row('a', 900))).toBe(false)
    const rows = [row('a', 900, 'work'), row('b', 2000), row('c', 900)]
    expect(filterRows(rows, 'starred', m, new Set()).map(r => r.id)).toEqual(['a'])
    expect(filterRows(rows, 'unread', m, new Set()).map(r => r.id)).toEqual(['b'])
    expect(filterRows(rows, 'running', m, new Set(['c'])).map(r => r.id)).toEqual(['c'])
    m = toggleStar(m, row('a', 900, 'work'))
    expect(m.stars).toEqual([])
  })
})
