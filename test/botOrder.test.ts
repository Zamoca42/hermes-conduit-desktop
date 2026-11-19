import { describe, expect, it } from 'vitest'
import {
  arrange,
  cleanOrder,
  dropping,
  droppingMixed,
  hostBotOrder,
  hostOrder,
  mixedBotKey,
  mixedTiles,
  neighbour,
  orderedBots
} from '../src/renderer/src/state/botOrder'
import type { Bot } from '../src/renderer/src/state/bots'

const bot = (name: string, pinned = false) => ({ name, title: name, pinned, face: 0 }) as unknown as Bot
const names = (bots: { name: string }[]) => bots.map(b => b.name)

describe('the bots order', () => {
  it('follows Hermes until set, then the order, with bots it does not name last', () => {
    const bots = [bot('a'), bot('b'), bot('c'), bot('d')]
    expect(names(arrange(bots, [], b => b.name))).toEqual(['a', 'b', 'c', 'd'])
    expect(names(arrange(bots, ['C', 'a'], b => b.name))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('puts pinned bots first, each group in the order', () => {
    const bots = [bot('a'), bot('b', true), bot('c')]
    expect(names(orderedBots(bots, ['c', 'a', 'b']))).toEqual(['b', 'c', 'a'])
  })

  it('takes the target place as on the Home Screen, so neighbours swap', () => {
    const shown = ['a', 'b', 'c']
    expect(dropping([], 'a', 'b', shown)).toEqual(['b', 'a', 'c'])
    expect(dropping([], 'c', 'b', shown)).toEqual(['a', 'c', 'b'])
    expect(dropping([], 'a', null, shown)).toEqual(['b', 'c', 'a'])
    expect(dropping(['a', 'b', 'c'], 'b', 'b', shown)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a hidden bot its place', () => {
    // x is hidden: not shown, but kept where it was.
    expect(dropping(['a', 'x', 'b', 'c'], 'c', 'a', ['a', 'b', 'c'])).toEqual(['c', 'a', 'x', 'b'])
  })

  it('reads the host copy and drops blanks and repeats', () => {
    expect(hostBotOrder({ values: { 'bots.order': { value: ['a', '', 'A', 'b', 3] } } })).toEqual(['a', 'b'])
    expect(hostBotOrder({ values: {} })).toBeNull()
    expect(cleanOrder('x')).toEqual([])
  })

  it('steps a bot past its neighbour, nothing past either end', () => {
    expect(neighbour(['a', 'b', 'c'], 'b', -1)).toBe('a')
    expect(neighbour(['a', 'b', 'c'], 'c', 1)).toBeNull()
  })
})

describe('the combined group mixed order', () => {
  const own = [bot('a'), bot('b')]
  const others = [{ host: 'https://two', bot: bot('x') }, { host: 'https://three', bot: bot('y') }]

  it('follows Saved Dashboards order until arranged, so a switch moves nothing', () => {
    const saved = ['https://three', 'https://one', 'https://two']
    const keys = mixedTiles('https://one', own, others, saved, []).map(t => t.key)
    expect(keys).toEqual([
      mixedBotKey('https://three', 'y'),
      mixedBotKey('https://one', 'a'),
      mixedBotKey('https://one', 'b'),
      mixedBotKey('https://two', 'x')
    ])
  })

  it('mixes the hosts once arranged, and marks this host bots as its own', () => {
    const shown = mixedTiles('https://one', own, others, ['https://one', 'https://two', 'https://three'], []).map(t => t.key)
    const order = droppingMixed([], mixedBotKey('https://three', 'y'), mixedBotKey('https://one', 'a'), shown)
    const tiles = mixedTiles('https://one', own, others, ['https://one', 'https://two', 'https://three'], order)
    expect(tiles.map(t => t.bot.name)).toEqual(['y', 'a', 'b', 'x'])
    expect(tiles.map(t => t.own)).toEqual([false, true, true, false])
  })

  it('lets a host that left the group leave the order', () => {
    const gone = mixedBotKey('https://gone', 'z')
    const shown = [mixedBotKey('https://one', 'a'), mixedBotKey('https://one', 'b')]
    expect(droppingMixed([gone, ...shown], shown[1]!, shown[0]!, shown)).toEqual([shown[1], shown[0]])
  })
})

describe('the group chats order', () => {
  const rooms = [{ roomId: 'r1' }, { roomId: 'r2' }, { roomId: 'R3' }]
  const ids = (list: { roomId: string }[]) => list.map(r => r.roomId)

  it('puts a room it does not name yet first, where Hermes lists one just made', () => {
    expect(ids(arrange(rooms, ['r2', 'R3', 'r1'], r => r.roomId, 'rooms'))).toEqual(['r2', 'R3', 'r1'])
    expect(ids(arrange([{ roomId: 'new' }, ...rooms], ['r2', 'R3', 'r1'], r => r.roomId, 'rooms'))).toEqual(['new', 'r2', 'R3', 'r1'])
  })

  it('matches room ids exactly', () => {
    expect(ids(arrange(rooms, ['r3', 'r2'], r => r.roomId, 'rooms'))).toEqual(['r1', 'R3', 'r2'])
    expect(cleanOrder(['a', 'A'], 'rooms')).toEqual(['a', 'A'])
  })

  it('takes the target place, with unnamed rooms before the order', () => {
    expect(dropping(['r2'], 'r1', 'r2', ['r1', 'R3', 'r2'], 'rooms')).toEqual(['R3', 'r2', 'r1'])
    expect(hostOrder({ values: { 'groups.order': { value: ['x', 'X'] } } }, 'groups.order', 'rooms')).toEqual(['x', 'X'])
  })
})
