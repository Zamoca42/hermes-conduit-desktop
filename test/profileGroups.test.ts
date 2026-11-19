import { describe, expect, it } from 'vitest'
import { GROUP_PREVIEW_COUNT, profileGroups } from '../src/renderer/src/state/profileGroups'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, profile: string | undefined, activeAt: number, pinned = false): ChatRow => ({ id, title: id, pinned, profile, activeAt })
const ids = (rows: ChatRow[]) => rows.map(r => r.id)

describe('all profiles grouped by profile', () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => row(`d${i}`, undefined, 100 - i)),
    row('dp', undefined, 1, true),
    row('f1', 'Furina', 50),
    row('x1', 'Stray', 40)
  ]

  it('lists each profile in the strip’s order, its pinned chats then its five newest, with what Show more brings', () => {
    const groups = profileGroups(rows, ['default', 'furina'], { capped: true, showsAll: () => false, openId: null })
    expect(groups.map(g => g.profile)).toEqual(['default', 'furina', 'stray'])
    expect(ids(groups[0]!.rows)).toEqual(['dp', 'd0', 'd1', 'd2', 'd3', 'd4'])
    expect(groups[0]!.hidden).toBe(8 - GROUP_PREVIEW_COUNT)
    expect(groups[1]!.hidden).toBe(0)
  })

  it('keeps the open chat listed past the five, and Show more lists every one with Show fewer', () => {
    const open = profileGroups(rows, ['default'], { capped: true, showsAll: () => false, openId: 'd7' })
    expect(ids(open[0]!.rows)).toContain('d7')
    expect(open[0]!.hidden).toBe(2)
    const all = profileGroups(rows, ['default'], { capped: true, showsAll: p => p === 'default', openId: null })
    expect(all[0]!.rows).toHaveLength(9)
    expect(all[0]!.extra).toBe(3)
  })

  it('lists every match uncapped for a search or a status filter', () => {
    const groups = profileGroups(rows, ['default'], { capped: false, showsAll: () => false, openId: null })
    expect(groups[0]!.rows).toHaveLength(9)
    expect(groups[0]!.hidden).toBe(0)
  })
})
