/**
 * The one connection to a Hermes dashboard: signs in, opens the gateway
 * socket with the vendored Hermes client, redials with backoff when it drops,
 * and passes events on to the window.
 */
import {
  ANSWERED_REQUEST_METHODS,
  type AnsweredRequestMethod,
  type ConnectionStatus,
  type GatewayEventMessage,
  type PendingRequest,
  type SignInMethod,
  type SignInRequest,
  type HostSummary
} from '../shared/ipc'
import type { ServerRequest } from '../vendor/hermes-shared/json-rpc-channel'
import { JsonRpcGatewayClient, type WebSocketLike } from '../vendor/hermes-shared/json-rpc-gateway'
import { reconnectBackoffDelayMs, isStableOpen } from '../vendor/hermes-shared/reconnect-backoff'
import {
  AuthError,
  CONDUIT_CLIENT_HEADER,
  SESSION_TOKEN_HEADER,
  type CookieJar,
  endpoint,
  type Fetch,
  cookieHeader,
  mintTicket,
  normalizeBaseUrl,
  passwordLogin,
  readOpenSessionToken,
  webSocketUrl
} from './auth'
import { cleanHeaders, httpsIssue, proxyFetch, withProxyHeaders, type ProxyHeaders } from './proxyHeaders'
import { t } from '../shared/i18n'

/** What we keep between launches. Secrets are encrypted by the store. */
export interface SavedConnection {
  url: string
  method: SignInMethod
  username?: string
  password?: string
  token?: string
  cookies?: CookieJar
  /** For a proxy in front of the dashboard (Cloudflare Access, Pangolin…); sent over HTTPS only. */
  headers?: ProxyHeaders
}

export interface ConnectionStore {
  /** The open host. */
  load(): SavedConnection | null
  /** Adds or updates a host and makes it the open one. */
  save(connection: SavedConnection): void
  /** Forgets the open host; the next one saved, if any, becomes the open one. */
  clear(): void
  /** Every saved host, without its secrets. */
  list?(): HostSummary[]
  activate?(url: string): boolean
  remove?(url: string): void
}

export type SocketFactory = (url: string, headers: Record<string, string>) => WebSocketLike

export interface ConnectionDeps {
  fetch: Fetch
  store: ConnectionStore
  createSocket: SocketFactory
  onStatus: (status: ConnectionStatus) => void
  onEvent: (event: GatewayEventMessage) => void
  /** The questions Hermes is waiting on, whenever they change. */
  onRequests?: (requests: PendingRequest[]) => void
  /** Timers, replaceable in tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export class Connection {
  private saved: SavedConnection | null = null
  private client: JsonRpcGatewayClient | null = null
  private status: ConnectionStatus = { phase: 'signed-out' }
  private attempt = 0
  private openedAt: number | null = null
  private retryTimer: unknown = null
  /** An ungated dashboard's session token, read from its page at each dial. */
  private openToken: string | null = null
  /** Bumped on every sign-in and sign-out, so a late dial from an earlier one is dropped. */
  private generation = 0
  /** Approvals and questions waiting on an answer from this window, by request id. */
  private readonly pending = new Map<string, { request: ServerRequest; entry: PendingRequest }>()
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly deps: ConnectionDeps) {
    this.setTimer = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  current(): ConnectionStatus {
    return this.status
  }

  requests(): PendingRequest[] {
    return [...this.pending.values()].map(p => p.entry).sort((a, b) => a.receivedAt - b.receivedAt)
  }

  /** Sends the answer to the backend that asked; false when the request is gone. */
  answerRequest(id: string, result: Record<string, unknown>): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false
    pending.request.respond(result)
    this.dropRequest(id)
    return true
  }

  dropRequest(id: string): void {
    if (this.pending.delete(id)) this.deps.onRequests?.(this.requests())
  }

  private clearRequests(): void {
    if (!this.pending.size) return
    this.pending.clear()
    this.deps.onRequests?.([])
  }

  /** Reconnects with what was saved last time, if anything. */
  async restore(): Promise<void> {
    const saved = this.deps.store.load()
    if (!saved) return
    this.saved = saved
    const generation = ++this.generation
    this.setStatus({ ...this.identity(), phase: 'connecting' })
    await this.dial(generation)
  }

  async signIn(request: SignInRequest): Promise<{ ok: true } | { ok: false; error: string }> {
    const previous = this.saved
    const result = await this.trySignIn(request)
    // A failed sign-in to another host goes back to the one that was open.
    if (!result.ok && previous && !this.saved) this.open(previous)
    return result
  }

  private async trySignIn(request: SignInRequest): Promise<{ ok: true } | { ok: false; error: string }> {
    const generation = ++this.generation
    this.teardown()
    let url: string
    try {
      url = normalizeBaseUrl(request.url)
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
    const cleaned = cleanHeaders(request.headers)
    if (!cleaned.ok) return { ok: false, error: cleaned.error }
    const insecure = httpsIssue(url, cleaned.headers)
    if (insecure) return { ok: false, error: insecure }
    const saved: SavedConnection = { url, method: request.method, headers: cleaned.headers }
    try {
      if (request.method === 'password') {
        const username = request.username?.trim() ?? ''
        if (!username || !request.password) return { ok: false, error: t('Enter your user name and password.') }
        saved.username = username
        saved.password = request.password
        saved.cookies = await passwordLogin(url, username, request.password, this.fetchFor(saved))
      } else if (request.method === 'token') {
        const token = request.token?.trim() ?? ''
        if (!token) return { ok: false, error: t('Paste the dashboard’s session token.') }
        saved.token = token
      }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
    if (generation !== this.generation) return { ok: false, error: t('Cancelled.') }
    this.saved = saved
    this.setStatus({ ...this.identity(), phase: 'connecting' })
    const error = await this.dial(generation)
    if (error) {
      this.saved = null
      this.teardown()
      this.setStatus({ phase: 'signed-out' })
      return { ok: false, error }
    }
    this.deps.store.save(saved)
    // The host list now holds it.
    this.setStatus({ ...this.status, hosts: this.hosts() })
    return { ok: true }
  }

  /** Signs out of the open host; the next saved one, if any, opens. */
  signOut(): void {
    this.generation++
    this.teardown()
    this.saved = null
    this.openToken = null
    this.deps.store.clear()
    const next = this.deps.store.load()
    if (next) this.open(next)
    else this.setStatus({ phase: 'signed-out' })
  }

  /** Every saved host, without secrets. */
  hosts(): HostSummary[] {
    return this.deps.store.list?.() ?? (this.saved ? [{ url: this.saved.url, method: this.saved.method, username: this.saved.username }] : [])
  }

  /** Opens another saved host in place of this one. */
  switchHost(url: string): boolean {
    if (this.saved?.url === url) return true
    if (!this.deps.store.activate?.(url)) return false
    const next = this.deps.store.load()
    if (!next) return false
    this.open(next)
    return true
  }

  /** Forgets a saved host; the open one signs out (and the next opens). */
  removeHost(url: string): void {
    if (this.saved?.url === url) return this.signOut()
    this.deps.store.remove?.(url)
    this.setStatus({ ...this.identity(), phase: this.status.phase, error: this.status.error, retryInSeconds: this.status.retryInSeconds })
  }

  private open(saved: SavedConnection): void {
    const generation = ++this.generation
    this.teardown()
    this.saved = saved
    this.openToken = null
    this.attempt = 0
    this.setStatus({ phase: 'connecting', ...this.identityOf(saved) })
    void this.dial(generation)
  }

  /** Dials now instead of waiting for the next retry. */
  reconnectNow(): void {
    if (!this.saved || this.status.phase === 'open' || this.status.phase === 'connecting') return
    this.attempt = 0
    const generation = ++this.generation
    this.teardown()
    this.setStatus({ ...this.identity(), phase: 'connecting' })
    void this.dial(generation)
  }

  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.client || this.status.phase !== 'open') throw new Error(t('Not connected to Hermes.'))
    return this.client.request<T>(method, params, uploadTimeoutMs(params))
  }

  /**
   * A dashboard REST call (`/api/...`) with this sign-in's credential. A
   * password sign-in whose session ran out signs in again once.
   */
  async http<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const saved = this.saved
    if (!saved) throw new Error(t('Not signed in.'))
    if (!path.startsWith('/api/')) throw new Error('Only dashboard API paths can be called.')
    const send = async (): Promise<Response> => {
      const headers: Record<string, string> = { Accept: 'application/json', [CONDUIT_CLIENT_HEADER]: 'conduit' }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (saved.method === 'password' && saved.cookies) headers.Cookie = cookieHeader(saved.cookies)
      if (saved.method === 'token' && saved.token) headers[SESSION_TOKEN_HEADER] = saved.token
      if (saved.method === 'open') {
        this.openToken ??= await readOpenSessionToken(saved.url, this.fetchFor(saved))
        headers[SESSION_TOKEN_HEADER] = this.openToken
      }
      return this.fetchFor(saved)(endpoint(saved.url, path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    }
    let response = await send()
    if (response.status === 401 && saved.method === 'password' && saved.username && saved.password) {
      this.keepCookies(saved, await passwordLogin(saved.url, saved.username, saved.password, this.fetchFor(saved)))
      response = await send()
    } else if (response.status === 401 && saved.method === 'open') {
      this.openToken = null
      response = await send()
    }
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    if (!response.ok) {
      throw Object.assign(new Error(httpErrorText((parsed as { detail?: unknown } | null)?.detail, response.status)), { code: response.status })
    }
    return parsed as T
  }

  private identity(): ConnectionStatus {
    const saved = this.saved
    if (!saved) return { phase: 'signed-out', hosts: this.hosts() }
    return { phase: this.status.phase, ...this.identityOf(saved), sessionAuthority: this.status.sessionAuthority }
  }

  private identityOf(saved: SavedConnection): Omit<ConnectionStatus, 'phase'> {
    const hosts = this.hosts()
    const here = new URL(saved.url)
    // The port too when another saved host shares the name.
    const shared = hosts.some(h => h.url !== saved.url && new URL(h.url).hostname === here.hostname)
    return { url: saved.url, hostLabel: shared ? here.host : here.hostname, username: saved.username, method: saved.method, hosts }
  }

  /** Opens one socket. Returns an error message when it couldn't, after scheduling a retry. */
  private async dial(generation: number): Promise<string | null> {
    const saved = this.saved
    if (!saved) return t('Not signed in.')
    let wsUrl: string
    try {
      wsUrl = await this.socketUrl(saved)
    } catch (error) {
      if (generation !== this.generation) return 'Cancelled.'
      return this.failed(generation, error)
    }
    if (generation !== this.generation) return 'Cancelled.'

    const headers: Record<string, string> = { [CONDUIT_CLIENT_HEADER]: 'conduit' }
    if (saved.method === 'password' && saved.cookies) headers.Cookie = cookieHeader(saved.cookies)
    const client = new JsonRpcGatewayClient({
      socketFactory: url => this.deps.createSocket(url, withProxyHeaders(headers, url, saved.url, saved.headers)),
      requestIdPrefix: 'c'
    })
    this.client = client
    client.onAny(event => {
      if (this.client !== client) return
      if (event.type === 'gateway.ready') {
        const ready = event.payload as { session_authority?: boolean | null } | undefined
        this.setStatus({ ...this.status, sessionAuthority: ready?.session_authority === true })
      }
      if (event.type === 'request.cancel') {
        // Answered on another client, timed out, or the turn stopped.
        const id = (event.payload as { id?: unknown } | undefined)?.id
        if (typeof id === 'string') this.dropRequest(id)
      }
      this.deps.onEvent({
        type: event.type,
        session_id: event.session_id,
        payload: event.payload,
        seq: event.seq,
        replayed: event.replayed
      })
    })
    // Approvals and questions wait in Needs you. Anything else (the TUI's
    // own prompts) is left to the clients that show it: a backend that
    // counts declines hears that no window here does.
    client.onRequest(request => {
      if (this.client !== client) return true
      if (!ANSWERED_REQUEST_METHODS.includes(request.method as AnsweredRequestMethod)) {
        request.decline?.('Conduit desktop doesn’t answer this kind of request')
        return true
      }
      const { session_id: sessionId, ...params } = request.params
      this.pending.set(request.id, {
        request,
        entry: {
          id: request.id,
          method: request.method as AnsweredRequestMethod,
          sessionId: typeof sessionId === 'string' ? sessionId : '',
          params,
          receivedAt: this.pending.get(request.id)?.entry.receivedAt ?? Date.now()
        }
      })
      this.deps.onRequests?.(this.requests())
      return true
    })
    client.onState(state => {
      if (this.client !== client) return
      if (state === 'open') {
        this.openedAt = Date.now()
        this.setStatus({ ...this.identity(), phase: 'open', sessionAuthority: this.status.sessionAuthority })
      } else if ((state === 'closed' || state === 'error') && this.status.phase === 'open') {
        if (isStableOpen(this.openedAt)) this.attempt = 0
        this.openedAt = null
        this.scheduleRetry(generation, t('The connection to Hermes dropped.'))
      }
    })
    try {
      await client.connect(wsUrl)
      if (generation !== this.generation) return 'Cancelled.'
      return null
    } catch (error) {
      if (generation !== this.generation) return 'Cancelled.'
      return this.failed(generation, error)
    }
  }

  private failed(generation: number, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof AuthError && error.signedOut && this.saved?.method !== 'password') {
      // A token that stopped working won't start again: ask to sign in.
      this.teardown()
      this.setStatus({ ...this.identity(), phase: 'failed', error: t('Hermes signed this computer out. Sign in again.') })
      return message
    }
    this.scheduleRetry(generation, message)
    return message
  }

  private scheduleRetry(generation: number, error: string): void {
    if (generation !== this.generation) return
    this.client?.close()
    this.client = null
    const delay = reconnectBackoffDelayMs(this.attempt++, { baseDelayMs: 1_000, capMs: 30_000 })
    this.setStatus({ ...this.identity(), phase: 'reconnecting', error, retryInSeconds: Math.ceil(delay / 1000) })
    if (this.retryTimer) this.clearTimer(this.retryTimer)
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null
      if (generation !== this.generation) return
      this.setStatus({ ...this.identity(), phase: 'connecting' })
      void this.dial(generation)
    }, delay)
  }

  /** The socket address with a fresh credential: a ticket per socket for a password sign-in. */
  /** The fetch for this host: with its proxy's headers, when it has any. */
  private fetchFor(saved: SavedConnection): Fetch {
    return proxyFetch(this.deps.fetch, saved.url, saved.headers)
  }

  private async socketUrl(saved: SavedConnection): Promise<string> {
    switch (saved.method) {
      case 'open':
        this.openToken = await readOpenSessionToken(saved.url, this.fetchFor(saved))
        return webSocketUrl(saved.url, { token: this.openToken })
      case 'token':
        return webSocketUrl(saved.url, { token: saved.token ?? '' })
      case 'password': {
        let jar = saved.cookies ?? {}
        try {
          const minted = await mintTicket(saved.url, jar, this.fetchFor(saved))
          jar = minted.jar
          this.keepCookies(saved, jar)
          return webSocketUrl(saved.url, { ticket: minted.ticket })
        } catch (error) {
          if (!(error instanceof AuthError && error.signedOut) || !saved.username || !saved.password) throw error
          // The session ran out: sign in again with the saved password.
          jar = await passwordLogin(saved.url, saved.username, saved.password, this.fetchFor(saved))
          const minted = await mintTicket(saved.url, jar, this.fetchFor(saved))
          this.keepCookies(saved, minted.jar)
          return webSocketUrl(saved.url, { ticket: minted.ticket })
        }
      }
    }
  }

  private keepCookies(saved: SavedConnection, jar: CookieJar): void {
    if (cookieHeader(jar) === cookieHeader(saved.cookies ?? {})) return
    saved.cookies = jar
    if (this.saved === saved && this.deps.store.load()) this.deps.store.save(saved)
  }

  private teardown(): void {
    // A request belongs to the socket it came on; the next one replays what's still open.
    this.clearRequests()
    if (this.retryTimer) this.clearTimer(this.retryTimer)
    this.retryTimer = null
    const client = this.client
    this.client = null
    client?.close()
    this.openedAt = null
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status
    this.deps.onStatus(status)
  }
}

/**
 * A request's budget: two minutes (three for a room's upload), or for an
 * upload about 1 s for every 64 KB it carries if that is longer (about
 * 0.5 Mbit/s), as on the phone.
 */
/** A refusal's words: Hermes' `detail`, which can be a string or `{ code, message }`. */
export function httpErrorText(detail: unknown, status: number): string {
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail === 'object') {
    const row = detail as { code?: unknown; error?: unknown; message?: unknown }
    const words = [row.code ?? row.error, row.message].filter((part): part is string => typeof part === 'string' && !!part)
    if (words.length) return words.join(': ')
  }
  return `HTTP ${status}`
}

export function uploadTimeoutMs(params: Record<string, unknown>): number {
  let characters = 0
  for (const key of ['content_base64', 'data_url', 'data', 'data_base64']) {
    const value = params[key]
    if (typeof value === 'string') characters += value.length
  }
  // A group room's upload has a three-minute floor.
  const floor = typeof params.data_base64 === 'string' ? 180_000 : 120_000
  return Math.max(floor, Math.ceil(characters / 64))
}
