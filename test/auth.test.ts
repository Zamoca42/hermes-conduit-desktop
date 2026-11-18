import { describe, expect, it } from 'vitest'
import {
  AuthError,
  absorbCookies,
  cookieHeader,
  mintTicket,
  normalizeBaseUrl,
  passwordLogin,
  probeHost,
  readOpenSessionToken,
  signInMethods,
  webSocketUrl,
  type Fetch
} from '../src/main/auth'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

/** A stand-in dashboard: each path answers with its handler; every request is recorded. */
function dashboard(routes: Record<string, Handler>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl: Fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const path = new URL(url).pathname
    const handler = routes[path]
    if (!handler) return new Response('{"detail":"Not Found"}', { status: 404 })
    return handler(url, init)
  }
  return { fetchImpl, calls }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

describe('dashboard addresses', () => {
  it('adds a scheme, keeps a proxy prefix and drops the rest', () => {
    expect(normalizeBaseUrl('hermes.example.com')).toBe('https://hermes.example.com')
    expect(normalizeBaseUrl('192.168.1.20:9119/')).toBe('http://192.168.1.20:9119')
    expect(normalizeBaseUrl('localhost:9119')).toBe('http://localhost:9119')
    expect(normalizeBaseUrl('100.101.5.6:9119')).toBe('http://100.101.5.6:9119')
    expect(normalizeBaseUrl('https://me:pw@example.com/hermes/?x=1#y')).toBe('https://example.com/hermes')
    expect(() => normalizeBaseUrl('ftp://example.com')).toThrow(AuthError)
    expect(() => normalizeBaseUrl('  ')).toThrow('Enter your dashboard address.')
  })

  it('builds the socket address under the same prefix', () => {
    expect(webSocketUrl('https://example.com/hermes', { ticket: 'a b' })).toBe('wss://example.com/hermes/api/ws?ticket=a+b')
    expect(webSocketUrl('http://127.0.0.1:9119', { token: 't' })).toBe('ws://127.0.0.1:9119/api/ws?token=t')
  })
})

describe('sign-in methods', () => {
  it('reads them from the status', () => {
    expect(signInMethods({ auth_required: false })).toEqual(['open'])
    expect(signInMethods({ auth_required: true, auth_providers: ['basic', 'session-token'] })).toEqual(['password', 'token'])
    expect(signInMethods({ auth_required: true, auth_providers: ['session-token'] })).toEqual(['token'])
    expect(signInMethods({ auth_required: true, auth_providers: ['github'] })).toEqual(['password'])
  })

  it('probes /api/status', async () => {
    const { fetchImpl, calls } = dashboard({ '/api/status': () => json({ version: '0.22.5', auth_required: true, auth_providers: ['basic'] }) })
    expect(await probeHost('example.com', fetchImpl)).toEqual({ ok: true, url: 'https://example.com', methods: ['password'], version: '0.22.5' })
    expect(calls[0]?.url).toBe('https://example.com/api/status')
  })

  it('says when something else answers', async () => {
    const { fetchImpl } = dashboard({})
    const probe = await probeHost('example.com', fetchImpl)
    expect(probe.ok).toBe(false)
  })

  it('says when nothing answers', async () => {
    const probe = await probeHost('example.com', async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') })
    })
    expect(probe).toEqual({ ok: false, error: 'Couldn’t reach example.com (ECONNREFUSED).' })
  })
})

describe('open dashboards', () => {
  it('read the session token from the page', async () => {
    const { fetchImpl } = dashboard({
      '/': () => new Response('<head><script>window.__HERMES_SESSION_TOKEN__="abc_123";window.x=1</script></head>')
    })
    expect(await readOpenSessionToken('http://h', fetchImpl)).toBe('abc_123')
  })

  it('send a gated one to the sign-in', async () => {
    const { fetchImpl } = dashboard({ '/': () => new Response('<head><script>window.__HERMES_AUTH_REQUIRED__=true</script></head>') })
    await expect(readOpenSessionToken('http://h', fetchImpl)).rejects.toThrow('asks for a sign-in')
  })
})

describe('password sign-in', () => {
  it('keeps cookies set along a redirect and mints a ticket with them', async () => {
    const { fetchImpl, calls } = dashboard({
      '/auth/password-login': () =>
        new Response(null, { status: 303, headers: [['Location', '/auth/landing'], ['Set-Cookie', 'hermes_session=s1; Path=/; HttpOnly']] }),
      '/auth/landing': () => json({ ok: true }, { headers: { 'Set-Cookie': 'hermes_csrf=c1; Path=/' } }),
      '/api/auth/ws-ticket': (_url, init) => {
        const cookie = new Headers(init.headers).get('Cookie')
        return cookie === 'hermes_session=s1; hermes_csrf=c1' ? json({ ticket: 'T1', ttl_seconds: 30 }) : json({ detail: 'no' }, { status: 401 })
      }
    })
    const jar = await passwordLogin('https://h', 'eric', 'pw', fetchImpl)
    expect(jar).toEqual({ hermes_session: 's1', hermes_csrf: 'c1' })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ provider: 'basic', username: 'eric', password: 'pw' })
    expect(calls[1]?.init.method).toBe('GET')
    expect(await mintTicket('https://h', jar, fetchImpl)).toEqual({ ticket: 'T1', jar })
  })

  it('says when the password is wrong', async () => {
    const { fetchImpl } = dashboard({ '/auth/password-login': () => json({ detail: 'Invalid credentials' }, { status: 401 }) })
    await expect(passwordLogin('https://h', 'eric', 'bad', fetchImpl)).rejects.toThrow('That user name and password didn’t work.')
  })

  it('says when no cookie came back', async () => {
    const { fetchImpl } = dashboard({ '/auth/password-login': () => json({ ok: true }) })
    await expect(passwordLogin('https://h', 'eric', 'pw', fetchImpl)).rejects.toThrow('no session cookie')
  })

  it('marks a refused ticket as signed out', async () => {
    const { fetchImpl } = dashboard({ '/api/auth/ws-ticket': () => json({ detail: 'Not authenticated' }, { status: 401 }) })
    const error = await mintTicket('https://h', { s: '1' }, fetchImpl).catch(e => e)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).signedOut).toBe(true)
  })
})

describe('cookies', () => {
  it('drop expired and emptied ones', () => {
    const response = new Response(null, {
      headers: [
        ['Set-Cookie', 'a=; Max-Age=0'],
        ['Set-Cookie', 'b=2; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],
        ['Set-Cookie', 'c=3; Path=/']
      ]
    })
    expect(cookieHeader(absorbCookies({ a: '1', b: '1' }, response))).toBe('c=3')
  })
})
