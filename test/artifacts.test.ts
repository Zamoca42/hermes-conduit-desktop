import { describe, expect, it } from 'vitest'
import { cleanNote, days, feedItems, includes, listPath, matches, merged, nextStore, parseItem, parsePage, parsePins, pinBody, unpinPath } from '../src/renderer/src/state/artifacts'

const row = (over: Record<string, unknown> = {}) => ({
  kind: 'image',
  source: 'delivered',
  session_id: 's1',
  session_title: 'Fake chat',
  message_id: 7,
  timestamp: 1_700_000_000,
  path: '/home/me/robot.png',
  size: 12,
  ...over
})

describe('artifacts', () => {
  it('reads a row, naming it by its path when it has no name', () => {
    const item = parseItem(row())!
    expect(item).toMatchObject({ id: '/home/me/robot.png', name: 'robot.png', exists: true, at: 1_700_000_000_000, sessionTitle: 'Fake chat' })
  })

  it('drops a file without a path and a link without a web address', () => {
    expect(parseItem(row({ path: '' }))).toBeNull()
    expect(parseItem(row({ kind: 'link', source: 'link', path: undefined, url: 'javascript:alert(1)' }))).toBeNull()
    const link = parseItem(row({ kind: 'link', source: 'link', path: undefined, url: 'https://example.com/a', exists: false }))!
    expect(link).toMatchObject({ id: 'https://example.com/a', name: 'example.com', exists: true })
  })

  it('keeps each artifact once, its newest mention first', () => {
    const page = parsePage({ ok: true, items: [row({ message_id: 9 }), row({ message_id: 3 }), row({ path: '/x.txt', kind: 'file' })], next_before: 3 })
    expect(page.items.map(i => i.messageId)).toEqual([9, 7])
    expect(page.nextBefore).toBe(3)
    expect(merged(page.items, [parseItem(row({ message_id: 1 }))!])).toHaveLength(2)
    expect(() => parsePage({ ok: false })).toThrow()
  })

  it('asks the host for a chat, a chip, a search and a page', () => {
    expect(listPath({ profile: 'yelan', sessionIds: ['a b'], filter: 'images', query: ' cat ', before: 40 })).toBe(
      '/api/plugins/conduit_push/artifacts?limit=60&session_id=a%20b&kind=images&q=cat&before=40&profile=yelan'
    )
    expect(listPath({})).toBe('/api/plugins/conduit_push/artifacts?limit=60')
  })

  it('saves the row with a cleaned note, and unsaves by path', () => {
    const item = parseItem(row())!
    expect(pinBody(item, '  a   short\nnote ')).toEqual({
      item: { kind: 'image', source: 'delivered', name: 'robot.png', session_id: 's1', session_title: 'Fake chat', message_id: 7, timestamp: 1_700_000_000, path: '/home/me/robot.png' },
      note: 'a short note'
    })
    expect(cleanNote('x'.repeat(250))).toHaveLength(200)
    expect(unpinPath(item)).toBe('/api/plugins/conduit_push/artifacts/pins?id=%2Fhome%2Fme%2Frobot.png')
  })

  it('lists saved ones saved last first, with their notes and kept copies', () => {
    const pins = parsePins({ ok: true, pins: [row({ pinned_at: 10 }), row({ path: '/b.txt', kind: 'file', pinned_at: 20, note: 'keep', kept_path: '/kept/b.txt', exists: false })] })
    expect(pins.map(p => p.name)).toEqual(['b.txt', 'robot.png'])
    expect(pins[0]).toMatchObject({ note: 'keep', keptPath: '/kept/b.txt', exists: false })
    expect(matches(pins[0]!, 'KEEP')).toBe(true)
  })

  it('groups by day and filters by chip', () => {
    const a = parseItem(row())!
    const b = parseItem(row({ path: '/c.png', timestamp: 1_700_000_000 - 3 * 86_400 }))!
    expect(days([a, b]).map(g => g.items.length)).toEqual([1, 1])
    expect(includes('images', 'video')).toBe(true)
    expect(includes('files', 'audio')).toBe(true)
    expect(includes('pages', 'file')).toBe(false)
  })

  describe('feed', () => {
    const at = (path: string, seconds: number) => parseItem(row({ path, timestamp: seconds }))!
    const names = (items: { id: string }[]) => items.map(i => i.id)

    it('merges stores newest first, each artifact once', () => {
      const stores = [
        { read: [at('/a', 100), at('/b', 50)], cursor: null },
        { read: [at('/c', 90), at('/a', 40)], cursor: null }
      ]
      expect(names(feedItems(stores))).toEqual(['/a', '/c', '/b'])
      expect(nextStore(stores)).toBeNull()
    })

    it('holds back rows a store still paging could beat, and pages the one reaching least far back', () => {
      const stores = [
        { read: [at('/w1', 100), at('/w2', 80)], cursor: 7 },
        { read: [at('/b1', 90), at('/b2', 50)], cursor: null }
      ]
      // /b2 waits: the first store's next page may hold rows newer than it.
      expect(names(feedItems(stores))).toEqual(['/w1', '/b1', '/w2'])
      expect(nextStore(stores)).toBe(0)
    })

    it("pages a store whose page held none of the chip's before showing another's older rows", () => {
      // This host's newest page of a long history had no images; another host's old ones wait for it.
      const stores = [
        { read: [], cursor: 30 },
        { read: [at('/old', 10)], cursor: null }
      ]
      expect(feedItems(stores)).toEqual([])
      expect(nextStore(stores)).toBe(0)
      stores[0] = { read: [at('/new', 500)], cursor: null }
      expect(names(feedItems(stores))).toEqual(['/new', '/old'])
    })
  })
})
