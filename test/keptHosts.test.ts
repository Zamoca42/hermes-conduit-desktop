import { describe, expect, it } from 'vitest'
import type { Fetch } from '../src/main/auth'
import { createHostList } from '../src/main/hosts'
import { KEPT_BACKOFF, KeptHosts, MAX_KEPT } from '../src/main/keptHosts'
import type { SavedConnection } from '../src/main/connection'
import type { ConnectionStatus, KeptHost } from '../src/shared/ipc'
import type { WebSocketLike } from '../src/vendor/hermes-shared/json-rpc-gateway'
import {
  badgeColor,
  BADGE_PALETTE,
  hostBadge,
  openAfterSwitch,
  openBotAfterSwitch,
  openChatAfterSwitch,
  otherHostsChats,
  otherHostsWaiting,
  profileNames,
  takeBotAfterSwitch,
  takeChatAfterSwitch,
  takeOpenAfterSwitch,
  type KeptWaitingRow,
  type OtherChatRow
} from '../src/renderer/src/state/keptHosts'
import type { WaitingRow } from '../src/renderer/src/state/needsYou'

class FakeSocket extends EventTarget {
  readyState = 0
  constructor(readonly url: string) {
    super()
    setTimeout(() => {
      if (this.readyState === 3) return
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    }, 0)
  }
  send() {}
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }))
  }
  drop() {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) await tick()
}

const host = (url: string, extra: Partial<SavedConnection> = {}): SavedConnection => ({ url, method: 'token', token: 't', combined: true, ...extra })
const open = (url: string): ConnectionStatus => ({ phase: 'open', url })

function harness(hosts: SavedConnection[], opts: { refuse?: string[]; down?: string[] } = {}) {
  const written: SavedConnection[][] = []
  const store = createHostList(list => written.push(list), { hosts, active: hosts[0]?.url ?? null })
  const sockets: FakeSocket[] = []
  const changes: KeptHost[][] = []
  const timers: { fn: () => void; ms: number }[] = []
  const fetchImpl: Fetch = async input => {
    const url = new URL(String(input))
    const origin = url.origin
    if (opts.down?.includes(origin)) throw new TypeError('fetch failed')
    if (url.pathname === '/auth/password-login') {
      if (opts.refuse?.includes(origin)) return json({ detail: 'Bad password' }, 401)
      return json({ ok: true }, 200, { 'Set-Cookie': 'hermes_session=s1; Path=/' })
    }
    if (url.pathname === '/api/auth/ws-ticket') return opts.refuse?.includes(origin) ? json({ detail: 'Not authenticated' }, 401) : json({ ticket: 'T' })
    if (url.pathname === '/api/profiles') return json({ profiles: [{ name: 'default' }, { name: 'mira' }] })
    return json({ detail: 'Not Found' }, 404)
  }
  const kept = new KeptHosts({
    fetch: fetchImpl,
    store,
    createSocket: url => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    },
    onChange: list => changes.push(list),
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => undefined
  })
  const state = (url: string) => kept.list().find(h => h.url === url)?.state
  return { kept, store, sockets, changes, timers, written, state }
}

describe('combined dashboards in the main process', () => {
  it("connects the group's others once the one on screen has, and drops their events", async () => {
    const h = harness([host('https://a.example'), host('https://b.example'), host('https://c.example')])
    h.kept.sync({ phase: 'connecting', url: 'https://a.example' })
    expect(h.kept.list()).toEqual([])
    h.kept.sync(open('https://a.example'))
    expect(h.kept.list().map(k => k.url)).toEqual(['https://b.example', 'https://c.example'])
    await until(() => h.state('https://b.example') === 'live' && h.state('https://c.example') === 'live')
    expect(h.kept.list()).toEqual([
      { url: 'https://b.example', state: 'live' },
      { url: 'https://c.example', state: 'live' }
    ])
    expect(h.sockets.map(s => new URL(s.url).host)).toEqual(['b.example', 'c.example'])
    // Reads go through the kept connection.
    expect(await h.kept.http('https://b.example', '/api/profiles')).toEqual({ profiles: [{ name: 'default' }, { name: 'mira' }] })
    // Only reads go over a kept socket.
    await expect(h.kept.rpc('https://b.example', 'prompt.submit', {})).rejects.toThrow(/Only reads/)
    await expect(h.kept.rpc('https://d.example', 'profiles.list')).rejects.toThrow(/Not connected/)
  })

  it('needs two in the group, keeps at most three beside the one on screen, and connects beside one left out', async () => {
    const one = harness([host('https://a.example', { combined: undefined }), host('https://b.example')])
    one.kept.sync(open('https://a.example'))
    expect(one.kept.list()).toEqual([])

    const urls = ['a', 'b', 'c', 'd', 'e', 'f'].map(n => `https://${n}.example`)
    const many = harness([host('https://z.example', { combined: undefined }), ...urls.map(u => host(u))])
    many.kept.sync(open('https://z.example'))
    expect(many.kept.list().map(k => k.url)).toEqual(urls.slice(0, MAX_KEPT))
  })

  it('lets the switch target go and keeps the one left, once the new one has connected', async () => {
    const h = harness([host('https://a.example'), host('https://b.example')])
    h.kept.sync(open('https://a.example'))
    await until(() => h.state('https://b.example') === 'live')
    const socket = h.sockets[0]!
    h.kept.sync({ phase: 'connecting', url: 'https://b.example' })
    expect(h.kept.list()).toEqual([])
    expect(socket.readyState).toBe(3)
    h.kept.sync(open('https://b.example'))
    expect(h.kept.list().map(k => k.url)).toEqual(['https://a.example'])
  })

  it('lets everything go on sign-out, a lock, or the group dropping under two', async () => {
    const h = harness([host('https://a.example'), host('https://b.example')])
    h.kept.sync(open('https://a.example'))
    await until(() => h.state('https://b.example') === 'live')
    h.kept.sync({ phase: 'locked' })
    expect(h.kept.list()).toEqual([])
    h.kept.sync(open('https://a.example'))
    expect(h.kept.list()).toHaveLength(1)
    h.store.setCombined!('https://b.example', false)
    h.kept.sync(open('https://a.example'))
    expect(h.kept.list()).toEqual([])
    expect(h.changes.at(-1)).toEqual([])
  })

  it('says a refused sign-in needs a tap, and tries one that is down again on the long backoff', async () => {
    const h = harness([host('https://a.example'), host('https://b.example', { method: 'password', username: 'e', password: 'x', token: undefined }), host('https://c.example', { method: 'open', token: undefined })], {
      refuse: ['https://b.example'],
      down: ['https://c.example']
    })
    h.kept.sync(open('https://a.example'))
    await until(() => h.state('https://b.example') === 'signIn' && h.state('https://c.example') === 'down')
    expect(h.state('https://b.example')).toBe('signIn')
    expect(h.state('https://c.example')).toBe('down')
    // Only the one that's down waits on a retry, 30 s first.
    expect(h.timers.map(t => t.ms)).toEqual([KEPT_BACKOFF.baseDelayMs])
  })

  it('saves a kept host’s new cookies without opening it, and a sign-in again keeps it combined', () => {
    const h = harness([host('https://a.example'), host('https://b.example')])
    h.store.update!({ ...host('https://b.example'), combined: undefined, cookies: { s: '2' } })
    expect(h.store.load()!.url).toBe('https://a.example')
    expect(h.store.get!('https://b.example')).toMatchObject({ cookies: { s: '2' }, combined: true })
    h.store.save({ url: 'https://b.example', method: 'token', token: 'new' })
    expect(h.store.list!().find(x => x.url === 'https://b.example')).toMatchObject({ combined: true })
  })
})

describe('combined dashboards in the window', () => {
  const hosts = [
    { url: 'https://home.example', method: 'open' as const, combined: true },
    { url: 'https://alone.example', method: 'open' as const },
    { url: 'https://studio.example', method: 'open' as const, combined: true }
  ]
  const name = (url: string) => new URL(url).host

  it('badges only the group, by place in the saved order', () => {
    expect(hostBadge(hosts, 'https://home.example', name)).toEqual({ letter: 'H', color: BADGE_PALETTE[0], name: 'home.example' })
    expect(hostBadge(hosts, 'https://studio.example', name)).toMatchObject({ letter: 'S', color: BADGE_PALETTE[1] })
    expect(hostBadge(hosts, 'https://alone.example', name)).toBeNull()
    expect(hostBadge([hosts[0]!], 'https://home.example', name)).toBeNull()
  })

  it('gives a seventh member a hue of its own', () => {
    const seventh = badgeColor(6)
    expect(seventh).toMatch(/^hsl\(/)
    expect(badgeColor(7)).not.toBe(seventh)
  })

  it('reads profile names, adding default, and treats an empty list as no answer', () => {
    expect(profileNames({ profiles: [{ name: 'mira' }, 'kai'] })).toEqual(['default', 'mira', 'kai'])
    expect(profileNames({ profiles: [] })).toBeNull()
    expect(profileNames({ detail: 'x' })).toBeNull()
  })

  const row = (id: string, host?: string): WaitingRow & { host?: string } => ({ id, kind: 'question', sessionIds: ['s'], title: 'T', summary: '', questions: 1, at: 1, ...(host ? { host } : {}) })

  it('shows a wait once when two hosts are one Hermes, as this host’s', () => {
    const kept = [row('w1', 'https://studio.example'), row('w2', 'https://studio.example'), row('w2', 'https://other.example')] as KeptWaitingRow[]
    expect(otherHostsWaiting(kept, [row('w1')]).map(r => `${r.id}@${r.host}`)).toEqual(['w2@https://studio.example'])
  })

  it('hands a wait opened on another host to that host’s window after the switch', () => {
    openAfterSwitch(row('w9', 'https://studio.example') as KeptWaitingRow)
    expect(takeOpenAfterSwitch('https://home.example')).toBeNull()
    expect(takeOpenAfterSwitch('https://studio.example')).toEqual(row('w9'))
    expect(takeOpenAfterSwitch('https://studio.example')).toBeNull()
  })

  const chat = (id: string, host?: string) => ({ id, title: id, pinned: false, ...(host ? { host } : {}) })

  it('lists another host’s chat once, and not one this host lists too', () => {
    const other = [chat('c1', 'https://studio.example'), chat('c2', 'https://studio.example'), chat('c2', 'https://third.example')] as OtherChatRow[]
    expect(otherHostsChats(other, [chat('c1')]).map(r => `${r.id}@${r.host}`)).toEqual(['c2@https://studio.example'])
    expect(otherHostsChats(other, null)).toHaveLength(2)
  })

  it('opens another host’s chat in that host’s window after the switch', () => {
    openChatAfterSwitch(chat('c3', 'https://studio.example') as OtherChatRow)
    expect(takeChatAfterSwitch('https://home.example')).toBeNull()
    expect(takeChatAfterSwitch('https://studio.example')).toEqual(chat('c3'))
    expect(takeChatAfterSwitch('https://studio.example')).toBeNull()
  })

  it('opens another host’s bot once that host’s bots are read', () => {
    const bot = { name: 'mira', title: 'Mira' } as never
    openBotAfterSwitch({ host: 'https://studio.example', bot })
    expect(takeBotAfterSwitch('https://studio.example', null)).toBeNull()
    expect(takeBotAfterSwitch('https://home.example', [bot])).toBeNull()
    expect(takeBotAfterSwitch('https://studio.example', [bot])).toBe(bot)
    expect(takeBotAfterSwitch('https://studio.example', [bot])).toBeNull()
  })
})
