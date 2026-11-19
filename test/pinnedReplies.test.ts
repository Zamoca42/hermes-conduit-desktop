import { describe, expect, it } from 'vitest'
import {
  barOrder,
  excerptOf,
  newPin,
  nextBarIndex,
  normalizedLabel,
  overview,
  pinFor,
  pinsOfChat,
  refreshed,
  resolved,
  withoutChat,
  type PinnedReply
} from '../src/renderer/src/state/pinnedReplies'

const reply = (key: string, text: string) => ({ kind: 'assistant', key, text })

describe('pinned replies', () => {
  it('keeps a reply’s start on one line, and labels trimmed', () => {
    expect(excerptOf('  First line\n\n  second   line ')).toBe('First line second line')
    expect(excerptOf('x'.repeat(400))).toHaveLength(280)
    expect(normalizedLabel('  ')).toBeUndefined()
    expect(normalizedLabel(' Security\nrecommendations ')).toBe('Security recommendations')
  })

  it('finds a pin by row id, and a reply pinned as it arrived by its words', () => {
    const items = [reply('row-1', 'Same start'), { kind: 'user', key: 'row-2', text: 'more' }, reply('row-3', 'Same start')]
    const byRow = newPin(reply('row-1', 'Same start'), 'c', undefined, 'Chat', 1)
    expect(byRow.rowId).toBe(1)
    const live = newPin(reply('a-9', 'Same start'), 'c', undefined, 'Chat', 2)
    expect(live.rowId).toBeNull()
    const ids = resolved([byRow, live], items)
    // The row id claims its reply; the live pin takes the latest other one reading the same.
    expect(ids.get(byRow.id)).toBe('row-1')
    expect(ids.get(live.id)).toBe('row-3')
    expect(pinFor(items[2]!, [byRow, live], items)?.id).toBe(live.id)
    expect(refreshed([byRow, live], items)!.map(p => p.rowId)).toEqual([1, 3])
    expect(refreshed([byRow], items)).toBeNull()
  })

  it('orders the bar as the replies sit, and cycles back from the first', () => {
    const items = [reply('row-1', 'one'), reply('row-5', 'five')]
    const late = { ...newPin(items[0]!, 'c', 'default', 'Chat', 20) }
    const early = { ...newPin(items[1]!, 'c', 'default', 'Chat', 10) }
    const gone = { ...newPin(reply('row-99', 'gone'), 'c', 'default', 'Chat', 30) }
    expect(barOrder([early, late, gone], items).map(p => p.id)).toEqual([gone.id, late.id, early.id])
    expect(nextBarIndex(2, 3)).toBe(1)
    expect(nextBarIndex(0, 3)).toBe(2)
  })

  it('lists a section per chat, the open one first, and drops a deleted chat’s pins', () => {
    const pin = (chat: string, at: number, profile = 'default'): PinnedReply => ({ ...newPin(reply(`row-${at}`, 't'), chat, profile, chat, at) })
    const pins = [pin('a', 1), pin('b', 5), pin('a', 3), pin('c', 2, 'furina')]
    expect(overview(pins).map(s => s.pins[0]!.chat)).toEqual(['b', 'a', 'c'])
    expect(overview(pins, { chat: 'c', profile: 'Furina' }).map(s => s.pins[0]!.chat)).toEqual(['c', 'b', 'a'])
    expect(overview(pins)[1]!.pins.map(p => p.pinnedAt)).toEqual([3, 1])
    expect(pinsOfChat(pins, undefined, 'a')).toHaveLength(2)
    expect(pinsOfChat(pins, 'default', 'c')).toHaveLength(0)
    expect(withoutChat(pins, 'default', 'a').map(p => p.chat)).toEqual(['b', 'c'])
  })
})
