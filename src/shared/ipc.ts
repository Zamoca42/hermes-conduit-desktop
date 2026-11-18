/**
 * What the main process and the window say to each other. The window never
 * holds a password, cookie or token: it asks the main process, which owns the
 * connection to Hermes, to sign in and to make gateway calls for it.
 */

/** How a dashboard lets us in, from its public `/api/status`. */
export type SignInMethod = 'password' | 'token' | 'open'

export type HostProbe =
  | {
      ok: true
      /** The address as we'll save it: scheme, host, port and any path prefix, no trailing slash. */
      url: string
      /** Sign-in methods the dashboard offers, best first. */
      methods: SignInMethod[]
      version?: string
    }
  | { ok: false; error: string }

export interface SignInRequest {
  url: string
  method: SignInMethod
  username?: string
  password?: string
  token?: string
}

export type ConnectionPhase = 'signed-out' | 'connecting' | 'open' | 'reconnecting' | 'failed'

export interface ConnectionStatus {
  phase: ConnectionPhase
  /** The saved dashboard address, once signed in. */
  url?: string
  /** A short name for the host (its hostname). */
  hostLabel?: string
  /** The user name we signed in with, for Settings. */
  username?: string
  method?: SignInMethod
  /** Shown under the title bar while not open. */
  error?: string
  /** The gateway's session authority answers (`gateway.ready`), which changes some request shapes. */
  sessionAuthority?: boolean
  /** Seconds until the next reconnect attempt, while reconnecting. */
  retryInSeconds?: number
}

/** One gateway `event` notification, as the window receives it. */
export interface GatewayEventMessage {
  type: string
  session_id?: string
  payload?: unknown
  seq?: number
  replayed?: boolean
}

export type RpcOutcome<T = unknown> = { ok: true; result: T } | { ok: false; error: string; code?: number }

export type Platform = 'win32' | 'darwin' | 'linux'

export interface ConduitApi {
  platform: Platform
  probe(url: string): Promise<HostProbe>
  signIn(request: SignInRequest): Promise<{ ok: true } | { ok: false; error: string }>
  signOut(): Promise<void>
  status(): Promise<ConnectionStatus>
  /** Retry now, while reconnecting or failed. */
  reconnect(): Promise<void>
  rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /** A dashboard REST call; `path` starts with `/api/`. */
  http<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
  onStatus(listener: (status: ConnectionStatus) => void): () => void
  onEvent(listener: (event: GatewayEventMessage) => void): () => void
  /** A menu bar command (the Mac's File > New Chat). */
  onMenu(listener: (action: MenuAction) => void): () => void
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
  }
}

/** Commands the menu bar sends the window. */
export type MenuAction = 'new-chat'

export const IPC = {
  menu: 'conduit:menu',
  probe: 'conduit:probe',
  signIn: 'conduit:sign-in',
  signOut: 'conduit:sign-out',
  status: 'conduit:status',
  reconnect: 'conduit:reconnect',
  rpc: 'conduit:rpc',
  http: 'conduit:http',
  statusChanged: 'conduit:status-changed',
  event: 'conduit:event',
  windowMinimize: 'conduit:window-minimize',
  windowToggleMaximize: 'conduit:window-toggle-maximize',
  windowClose: 'conduit:window-close'
} as const
