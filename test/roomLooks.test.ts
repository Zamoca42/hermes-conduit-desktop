import { describe, expect, it } from 'vitest'
import {
  base64Bytes,
  lookPictureUrl,
  looksBody,
  looksDigest,
  memberLook,
  parseLook,
  parseLooks,
  personLook,
  roomLooksClient,
  smallestPicture
} from '../src/renderer/src/state/roomLooks'

const JPEG = '/9j/4AAQSkZJRg=='
const PNG = 'iVBORw0KGgoAAAA='

describe('how everyone in a room over Links looks', () => {
  it('takes a JPEG or PNG and a #RRGGBB color, either alone', () => {
    expect(parseLook({ picture: JPEG, color: '#ff8800' })).toEqual({ picture: JPEG, color: '#FF8800' })
    expect(parseLook({ picture: PNG, color: null })).toEqual({ picture: PNG })
    expect(parseLook({ picture: null, color: '#00AA11' })).toEqual({ color: '#00AA11' })
    expect(parseLook({ picture: 'R0lGODlh', color: 'red' })).toBeNull()
    expect(parseLook({ picture: null, color: null })).toBeNull()
    expect(parseLook('x')).toBeNull()
    expect(lookPictureUrl({ picture: PNG })).toBe(`data:image/png;base64,${PNG}`)
    expect(lookPictureUrl({ color: '#000000' })).toBeNull()
  })

  it('reads a room’s looks: agents by member id, people by name and poster, and the host’s', () => {
    const looks = parseLooks({
      ok: true,
      members: { 'bo:default': { picture: JPEG, color: '#112233' }, broken: { picture: 'nope' } },
      people: [{ name: 'Bo', poster: 'Bo B', look: { picture: PNG, color: null } }, { name: 'Cy', poster: 'Cy', look: null }],
      home: { picture: JPEG, color: null }
    })!
    expect(Object.keys(looks.members)).toEqual(['bo:default'])
    expect(Object.keys(looks.people).sort()).toEqual(['Bo', 'Bo B'])
    expect(memberLook(looks, { memberId: 'bo:default', peer: true })?.color).toBe('#112233')
    // Your own bot is drawn as yours, whatever the looks say.
    expect(memberLook(looks, { memberId: 'bo:default' })).toBeUndefined()
    expect(personLook(looks, ' Bo B ')?.picture).toBe(PNG)
    expect(personLook(looks, 'Dee', 'Dee')?.picture).toBe(JPEG)
    expect(personLook(looks, 'Dee')).toBeUndefined()
    expect(parseLooks({ ok: false })).toBeNull()
  })

  it('gives your Hermes your bots’ looks, and yours unless it keeps it', () => {
    const agents = { work: { picture: JPEG, color: '#ABCDEF' }, default: { color: '#000000' } }
    expect(looksBody(agents, { picture: PNG }, false)).toEqual({
      agents: { work: { picture: JPEG, color: '#ABCDEF' }, default: { picture: null, color: '#000000' } },
      person: { picture: PNG, color: null }
    })
    expect(looksBody(agents, null, false).person).toBeNull()
    expect('person' in looksBody(agents, { picture: PNG }, true)).toBe(false)
    expect(looksDigest(agents, null, false)).toBe(looksDigest({ default: agents.default, work: agents.work }, null, false))
    expect(looksDigest(agents, null, false)).not.toBe(looksDigest(agents, { picture: PNG }, false))
    expect(looksDigest(agents, { picture: PNG }, true)).toBe(looksDigest(agents, null, true))
  })

  it('makes a picture small enough, trying smaller edges and qualities', () => {
    const big = 'A'.repeat(12_000)
    const small = 'A'.repeat(8_000)
    const tried: [number, number][] = []
    expect(
      smallestPicture((edge, quality) => {
        tried.push([edge, quality])
        return edge === 72 && quality === 0.55 ? small : big
      })
    ).toBe(small)
    expect(tried).toEqual([[96, 0.72], [96, 0.55], [96, 0.4], [96, 0.28], [72, 0.72], [72, 0.55]])
    expect(smallestPicture(() => big)).toBeNull()
    expect(smallestPicture(() => null)).toBeNull()
    expect(base64Bytes('AAAA')).toBe(3)
    expect(base64Bytes('AA==')).toBe(1)
  })

  it('reads, shares and keeps your picture through the plugin', async () => {
    const calls: unknown[] = []
    const client = roomLooksClient(async (method, path, body) => {
      calls.push([method, path, body])
      return (method === 'GET' && path.endsWith('/looks') ? { ok: true, person: { picture: PNG, color: null } } : { ok: true, members: {}, people: [] }) as never
    })
    expect(await client.read('conduit 1')).toEqual({ members: {}, people: {} })
    expect(await client.you()).toBe(PNG)
    await client.setYou(null)
    await client.setYou(JPEG)
    await client.share({ agents: {} })
    expect(calls).toEqual([
      ['GET', '/api/plugins/conduit_push/rooms/looks?room_id=conduit%201', undefined],
      ['GET', '/api/plugins/conduit_push/rooms/looks', undefined],
      ['PUT', '/api/plugins/conduit_push/rooms/looks', { person: null }],
      ['PUT', '/api/plugins/conduit_push/rooms/looks', { person: { picture: JPEG, color: null } }],
      ['PUT', '/api/plugins/conduit_push/rooms/looks', { agents: {} }]
    ])
    const refused = roomLooksClient(async () => ({ ok: false }) as never)
    await expect(refused.share({ agents: {} })).rejects.toThrow()
  })
})
