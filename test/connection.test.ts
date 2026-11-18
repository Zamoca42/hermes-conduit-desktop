import { describe, expect, it } from 'vitest'
import { Connection, type SavedConnection } from '../src/main/connection'
import type { Fetch } from '../src/main/auth'
import type { ConnectionStatus } from '../src/shared/ipc'
import type { WebSocketLike } from '../src/vendor/hermes-shared/json-rpc-gateway'

/** A socket that opens on the next tick and records what's sent. */
class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
    opens = true
  ) {
    super()
    setTimeout(() => {
      if (!opens) {
        this.readyState = 3
        this.dispatchEvent(new Event('error'))
        this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
        return
      }
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
      this.serverSends({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { session_authority: true, replay_epoch: 'e1', change_events: true } } })
    }, 0)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }))
  }
  serverSends(frame: unknown) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(frame) }))
  }
  serverDrops() {
    this.readyState = 3
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }))
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const tick = () => new Promise(resolve => setTimeout(resolve, 5))

function harness(opts: { ticketsBeforeExpiry?: number } = {}) {
  let session = 0
  let tickets = 0
  const log: string[] = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const path = new URL(String(input)).pathname
    log.push(path)
    if (path === '/auth/password-login') {
      session++
      return json({ ok: true }, 200, { 'Set-Cookie': `hermes_session=s${session}; Path=/` })
    }
    if (path === '/api/auth/ws-ticket') {
      const cookie = new Headers(init.headers).get('Cookie') ?? ''
      tickets++
      if (opts.ticketsBeforeExpiry !== undefined && tickets > opts.ticketsBeforeExpiry && cookie === 'hermes_session=s1') {
        return json({ detail: 'Not authenticated' }, 401)
      }
      return json({ ticket: `T${tickets}` })
    }
    if (path === '/api/profiles/sessions') return json({ sessions: [] })
    return json({ detail: 'Not Found' }, 404)
  }
  const sockets: FakeSocket[] = []
  const statuses: ConnectionStatus[] = []
  let saved: SavedConnection | null = null
  const timers: (() => void)[] = []
  const connection = new Connection({
    fetch: fetchImpl,
    store: { load: () => saved, save: s => (saved = { ...s }), clear: () => (saved = null) },
    createSocket: (url, headers) => {
      const socket = new FakeSocket(url, headers)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    },
    onStatus: s => statuses.push(s),
    onEvent: () => undefined,
    setTimeout: fn => timers.push(fn),
    clearTimeout: () => undefined
  })
  return { connection, sockets, statuses, log, timers, saved: () => saved }
}

describe('the connection', () => {
  it('signs in with a password and opens the socket with a ticket and the cookie', async () => {
    const h = harness()
    const result = await h.connection.signIn({ url: 'https://hermes.example.com/', method: 'password', username: 'eric', password: 'pw' })
    expect(result).toEqual({ ok: true })
    await tick()
    expect(h.sockets).toHaveLength(1)
    expect(h.sockets[0]!.url).toBe('wss://hermes.example.com/api/ws?ticket=T1')
    expect(h.sockets[0]!.headers).toEqual({ 'X-Conduit-Client': 'conduit', Cookie: 'hermes_session=s1' })
    expect(h.connection.current()).toMatchObject({ phase: 'open', hostLabel: 'hermes.example.com', username: 'eric', sessionAuthority: true })
    expect(h.saved()).toMatchObject({ url: 'https://hermes.example.com', method: 'password', password: 'pw', cookies: { hermes_session: 's1' } })
    // It says it answers server requests, as Hermes' own clients do.
    expect(h.sockets[0]!.sent.some(f => f.includes('client.capabilities'))).toBe(true)
  })

  it('redials after a drop, signing in again when the session ran out', async () => {
    const h = harness({ ticketsBeforeExpiry: 1 })
    await h.connection.signIn({ url: 'https://h', method: 'password', username: 'eric', password: 'pw' })
    await tick()
    h.sockets[0]!.serverDrops()
    expect(h.connection.current().phase).toBe('reconnecting')
    expect(h.timers).toHaveLength(1)
    h.timers[0]!()
    await tick()
    await tick()
    expect(h.log).toEqual(['/auth/password-login', '/api/auth/ws-ticket', '/api/auth/ws-ticket', '/auth/password-login', '/api/auth/ws-ticket'])
    expect(h.sockets).toHaveLength(2)
    expect(h.sockets[1]!.url).toBe('wss://h/api/ws?ticket=T3')
    expect(h.sockets[1]!.headers.Cookie).toBe('hermes_session=s2')
    expect(h.connection.current().phase).toBe('open')
    expect(h.saved()?.cookies).toEqual({ hermes_session: 's2' })
  })

  it('refuses a wrong password without saving anything', async () => {
    const h = harness()
    const result = await h.connection.signIn({ url: 'https://h', method: 'password', username: 'eric', password: '' })
    expect(result).toEqual({ ok: false, error: 'Enter your user name and password.' })
    expect(h.saved()).toBeNull()
  })

  it('signs out: closes the socket and forgets the sign-in', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://h', method: 'token', token: 'tok' })
    await tick()
    expect(h.sockets[0]!.url).toBe('wss://h/api/ws?token=tok')
    h.connection.signOut()
    expect(h.sockets[0]!.readyState).toBe(3)
    expect(h.saved()).toBeNull()
    expect(h.connection.current()).toEqual({ phase: 'signed-out' })
    await expect(h.connection.rpc('session.list')).rejects.toThrow('Not connected')
  })

  it('makes REST calls with the sign-in, only under /api/', async () => {
    const h = harness()
    await h.connection.signIn({ url: 'https://h', method: 'password', username: 'eric', password: 'pw' })
    await expect(h.connection.http('GET', '/api/profiles/sessions?limit=1')).resolves.toEqual({ sessions: [] })
    await expect(h.connection.http('GET', '/auth/logout')).rejects.toThrow('Only dashboard API paths')
  })
})
