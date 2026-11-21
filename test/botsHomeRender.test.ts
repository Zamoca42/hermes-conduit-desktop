import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window ?? {}, { conduit: new Proxy({ platform: 'linux' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => () => {}) }), addEventListener() {}, removeEventListener() {} }),
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

const bot = (name: string) => ({ name, hasAvatar: false })

describe("Bots' group chats in a combined group (desktop#231)", () => {
  it("show this host's copies and another host's rooms while this host's rooms aren't read", async () => {
    // A path the node typecheck doesn't follow: the component is the renderer's, checked by tsconfig.web.json.
    const path = '../src/renderer/src/components/BotsHome.tsx'
    const { BotsHome } = (await import(/* @vite-ignore */ path)) as { BotsHome: unknown }
    const copy = {
      id: 'link1\u0000c1',
      roomId: 'c1',
      name: 'Copy room',
      link: 'link1',
      from: 'Sam',
      members: [{ memberId: 'nahida' }],
      yours: [{ memberId: 'nahida', profile: 'nahida' }],
      justMe: false,
      status: 'started',
      reason: null,
      working: false,
      activity: [],
      lastSeq: 1,
      updatedAt: 1,
      out: {}
    }
    const html = renderToStaticMarkup(
      createElement(BotsHome as never, {
        bots: [bot('nahida')],
        error: null,
        runningProfiles: new Set(),
        rooms: null,
        canStartRooms: true,
        onOpen: () => {},
        onOpenRoom: () => {},
        onCreateRoom: async () => ({}),
        copies: [copy],
        otherBots: [{ host: 'https://far', bot: bot('furina') }],
        otherRooms: [{ host: 'https://far', kind: 'room', room: { roomId: 'r9', name: 'Far room', members: [{ memberId: 'furina', profile: 'furina' }] } }],
        side: {}
      } as never)
    )
    expect(html).toContain('Copy room')
    expect(html).toContain('Far room')
    // The far room's tile draws its host's bot.
    const far = html.slice(html.indexOf('Far room') - 2000, html.indexOf('Far room'))
    expect(far).toMatch(/room-faces/)
    expect(far.slice(far.lastIndexOf('room-faces'))).toContain('bot-avatar')
  })
})
