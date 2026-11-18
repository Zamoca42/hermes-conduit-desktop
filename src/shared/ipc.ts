/**
 * What the main process and the window say to each other. The window never
 * holds a password, cookie or token: it asks the main process, which owns the
 * connection to Hermes, to sign in and to make gateway calls for it.
 */
import type { Language } from './i18n'

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
  /** Headers for a proxy in front of the dashboard, sent over HTTPS only. */
  headers?: Record<string, string>
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
  /** Every Hermes host signed in on this computer. */
  hosts?: HostSummary[]
}

/** A host the phone sent while pairing, shown before signing in. */
export interface PairHost {
  url: string
  method: SignInMethod
  username?: string
  /** What the phone calls it. */
  name?: string
}

/** How pairing from the phone is going. */
export interface PairEvent {
  phase: 'received' | 'signing-in' | 'done' | 'failed' | 'expired'
  /** The four words both screens show. */
  words?: string[]
  hosts?: PairHost[]
  error?: string
}

/** A signed-in Hermes host, without its secrets. */
export interface HostSummary {
  url: string
  method: SignInMethod
  username?: string
}

/** One gateway `event` notification, as the window receives it. */
export interface GatewayEventMessage {
  type: string
  session_id?: string
  payload?: unknown
  seq?: number
  replayed?: boolean
}

/** Server→client requests the window answers: Needs you. */
export type AnsweredRequestMethod = 'approval' | 'clarify'

export const ANSWERED_REQUEST_METHODS: readonly AnsweredRequestMethod[] = ['approval', 'clarify']

/** A question Hermes is waiting on: a command to approve, or questions to answer. */
export interface PendingRequest {
  id: string
  method: AnsweredRequestMethod
  /** The live session blocked on the answer. */
  sessionId: string
  params: Record<string, unknown>
  receivedAt: number
}

export type RpcOutcome<T = unknown> = { ok: true; result: T } | { ok: false; error: string; code?: number }

/** What main of hermes-conduit-notifier holds: nulls when GitHub didn't answer. */
export interface PluginRelease {
  version: string | null
  changelog: string | null
}

export type Platform = 'win32' | 'darwin' | 'linux'

/** "system" follows the computer's language. */
export type LanguageChoice = 'system' | Language
/** "system" follows the computer's light or dark mode. */
export type ThemeChoice = 'system' | 'dark' | 'light'

export interface ConduitApi {
  platform: Platform
  /** What the user picked in Settings, and the language that gives. */
  language: { choice: LanguageChoice; resolved: Language }
  /** Saves a new choice; every window reloads in it. */
  setLanguage(choice: LanguageChoice): void
  /** Light or dark, as picked in Settings > Appearance when the window opened. */
  theme: ThemeChoice
  /** Saves a new choice; the window follows it at once. */
  setTheme(choice: ThemeChoice): void
  /** `headers` are for a proxy in front of the dashboard (Cloudflare Access and the like). */
  probe(url: string, headers?: Record<string, string>): Promise<HostProbe>
  signIn(request: SignInRequest): Promise<{ ok: true } | { ok: false; error: string }>
  signOut(): Promise<void>
  /** Opens another signed-in host in place of this one. */
  switchHost(url: string): Promise<boolean>
  /** Forgets a signed-in host (the open one signs out). */
  removeHost(url: string): Promise<void>
  status(): Promise<ConnectionStatus>
  /** Pairing from the phone: the QR code's link, then events as the phone answers. */
  pairStart(): Promise<{ ok: true; link: string; expires: number } | { ok: false; error: string }>
  pairConfirm(): Promise<void>
  pairCancel(): Promise<void>
  onPair(listener: (event: PairEvent) => void): () => void
  /** Retry now, while reconnecting or failed. */
  reconnect(): Promise<void>
  rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>
  /**
   * The same calls, answering with the outcome rather than throwing: an error
   * thrown across the context bridge keeps only its message, and the window
   * needs the code too (a 404, a revision conflict). Use the renderer's
   * `gateway`, which throws with both.
   */
  rpcOutcome<T = unknown>(method: string, params?: Record<string, unknown>): Promise<RpcOutcome<T>>
  httpOutcome<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number): Promise<RpcOutcome<T>>
  /** A dashboard REST call; `path` starts with `/api/`. */
  http<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
  /** The Conduit plugin's newest version and changelog on its main branch, read by the main process (the window can't reach GitHub). */
  pluginRelease(): Promise<PluginRelease>
  /**
   * A live call's socket to a plugin route (`/api/plugins/...`), opened by the
   * main process with this sign-in's credential; its events come on `onLive`.
   */
  liveOpen(path: string, query?: Record<string, string>): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  /** A live call's socket opened with a single-use token the host mints at `path` (Gemini Live); the token stays in the main process. */
  liveOpenMinted(path: string): Promise<{ ok: true; id: string; model: string | null; voice: string | null } | { ok: false; error: string; code?: number }>
  liveSend(id: string, text: string): void
  liveClose(id: string, code?: number): void
  onLive(listener: (event: LiveSocketEvent) => void): () => void
  onStatus(listener: (status: ConnectionStatus) => void): () => void
  onEvent(listener: (event: GatewayEventMessage) => void): () => void
  /** The questions Hermes is waiting on, now and whenever they change. */
  requests(): Promise<PendingRequest[]>
  onRequests(listener: (requests: PendingRequest[]) => void): () => void
  /** Answers a request with its result; false when it's already gone. */
  answerRequest(id: string, result: Record<string, unknown>): Promise<boolean>
  /** Drops a request the gateway settled some other way (a batch's last `clarify.lock`). */
  dismissRequest(id: string): Promise<void>
  /** Shows a chat in the main window (quick ask's Open in Conduit). */
  openChat(chat: OpenChatRequest): void
  onOpenChat(listener: (chat: OpenChatRequest) => void): () => void
  /** The quick ask window was just shown: focus its field. */
  onQuickAskShown(listener: () => void): () => void
  /** Sizes the quick ask window: true for a reply, false for the field alone, or the px the field and its staged files need. */
  setQuickAskExpanded(expanded: boolean | number): void
  /** Puts text on the system clipboard (a message's Copy). */
  copyText(text: string): void
  /** Hides the quick ask window. */
  hideQuickAsk(): void
  /** The quick ask shortcut, and whether the system let Conduit have it. */
  quickAskShortcut(): Promise<{ accelerator: string; registered: boolean }>
  /** How many things wait on the user, for the tray and the Dock's badge. */
  setWaiting(count: number): void
  /** A menu bar command (the Mac's File > New Chat). */
  onMenu(listener: (action: MenuAction) => void): () => void
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    /** Brings the window back from the tray and focuses it (a notification's click). */
    show(): void
  }
}

/** Commands the menu bar sends the window. */
export type MenuAction =
  | 'new-chat'
  | 'needs-you'
  | 'search'
  | 'stop'
  | 'settings'
  | 'text-bigger'
  | 'text-smaller'
  | 'text-normal'
  | 'shortcuts'
  | 'go-1'
  | 'go-2'
  | 'go-3'
  | 'go-4'
  | 'go-5'

export interface OpenChatRequest {
  storedId: string
  profile?: string
  title?: string
}

export const IPC = {
  menu: 'conduit:menu',
  requests: 'conduit:requests',
  requestsChanged: 'conduit:requests-changed',
  answerRequest: 'conduit:answer-request',
  dismissRequest: 'conduit:dismiss-request',
  setWaiting: 'conduit:set-waiting',
  openChat: 'conduit:open-chat',
  hideQuickAsk: 'conduit:hide-quick-ask',
  copyText: 'conduit:copy-text',
  quickAskShown: 'conduit:quick-ask-shown',
  quickAskExpanded: 'conduit:quick-ask-expanded',
  quickAskShortcut: 'conduit:quick-ask-shortcut',
  windowShow: 'conduit:window-show',
  probe: 'conduit:probe',
  signIn: 'conduit:sign-in',
  signOut: 'conduit:sign-out',
  switchHost: 'conduit:switch-host',
  pairStart: 'conduit:pair-start',
  pairConfirm: 'conduit:pair-confirm',
  pairCancel: 'conduit:pair-cancel',
  pairEvent: 'conduit:pair-event',
  removeHost: 'conduit:remove-host',
  status: 'conduit:status',
  reconnect: 'conduit:reconnect',
  rpc: 'conduit:rpc',
  http: 'conduit:http',
  statusChanged: 'conduit:status-changed',
  event: 'conduit:event',
  windowMinimize: 'conduit:window-minimize',
  windowToggleMaximize: 'conduit:window-toggle-maximize',
  windowClose: 'conduit:window-close',
  language: 'conduit:language',
  setLanguage: 'conduit:set-language',
  theme: 'conduit:theme',
  setTheme: 'conduit:set-theme',
  pluginRelease: 'conduit:plugin-release',
  liveOpen: 'conduit:live-open',
  liveOpenMinted: 'conduit:live-open-minted',
  liveSend: 'conduit:live-send',
  liveClose: 'conduit:live-close',
  liveEvent: 'conduit:live-event'
} as const

/** What a live call's socket (opened by the main process) reports. */
export type LiveSocketEvent =
  | { id: string; type: 'open' }
  | { id: string; type: 'message'; data: string }
  | { id: string; type: 'close'; code: number; reason: string }
  | { id: string; type: 'error'; message: string }

/** The token routes whose minted socket the main process opens (Gemini Live's). */
export const LIVE_TOKEN_PATHS = ['/api/plugins/conduit_push/gemini-live/token']

/**
 * A minted token's socket: the host's `websocket_url` (wss only) with the
 * single-use token as `access_token`, after the phone's GeminiLiveToken.
 */
export function mintedSocket(response: unknown): { ok: true; url: string; model: string | null; voice: string | null } | { ok: false; error: string } {
  const r = (response ?? {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (r.ok !== true) return { ok: false, error: text(r.reason) ?? text(r.error) ?? 'unavailable' }
  const token = text(r.token)
  let url: URL | null = null
  try {
    url = new URL(text(r.websocket_url) ?? '')
  } catch {
    url = null
  }
  if (!token || !url || url.protocol !== 'wss:') return { ok: false, error: 'malformed' }
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token)
  return { ok: true, url: url.toString(), model: text(r.model), voice: text(r.voice) }
}
