/**
 * A chat another app holds, after the phone's ChatTakeover (#304, #1061,
 * #1261): Hermes refuses a send with SESSION_NOT_OWNED while Hermes
 * Desktop, a terminal or the gateway's ledger holds the chat, and the
 * conduit_push plugin's takeover route drops the other app's claim once any
 * reply it's running finishes, so the next send goes.
 */
import { t } from '../../../shared/i18n'

export const TAKEOVER_PATH = '/api/plugins/conduit_push/sessions/takeover'
/** The route takes at most this many of one chat's ids. */
export const TAKEOVER_MAX_IDS = 4
/** Asked again this often while the other app's reply runs. */
export const TAKEOVER_POLL_MS = 3000
/** How long a typed message waits for that reply before Conduit says it's still busy. */
export const TAKEOVER_WAIT_MS = 15 * 60 * 1000
/** How long a call's request waits. */
export const CALL_TAKEOVER_WAIT_MS = 20 * 1000
const TRANSIENT_LIMIT = 5

/** Device-only, on until turned off: a reply running in the other app always finishes first, so taking over costs little. */
export const AUTOMATIC_KEY = 'conduit.takeOverChatsAutomatically'

export function takesOverAutomatically(): boolean {
  try {
    return localStorage.getItem(AUTOMATIC_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setTakesOverAutomatically(on: boolean): void {
  try {
    if (on) localStorage.removeItem(AUTOMATIC_KEY)
    else localStorage.setItem(AUTOMATIC_KEY, 'false')
  } catch {
    // Kept for this window only.
  }
}

export type Owner = 'desktop' | 'terminal' | 'otherBot' | 'otherWindow'

export function owner(surface?: string | null): Owner {
  switch ((surface ?? '').toLowerCase()) {
    case 'desktop':
      return 'desktop'
    case 'cli':
    case 'tui':
      return 'terminal'
    case 'bot':
      return 'otherBot'
    default:
      return 'otherWindow'
  }
}

/** Whether Hermes refused a send because another live app holds the chat. */
export const isSessionNotOwned = (error: unknown) => (error as { reason?: unknown } | null)?.reason === 'SESSION_NOT_OWNED'

/** The stored id and surface from a refusal's "Details: session <id> opened by <surface> 5m ago." */
export function refusalDetails(message: string): { sessionId?: string; surface?: string } {
  const at = message.indexOf('Details: session ')
  if (at < 0) return {}
  const words = message
    .slice(at + 'Details: session '.length)
    .split(/[ \n]+/)
    .filter(Boolean)
  const sessionId = words[0]
  if (words.length < 4 || words[1] !== 'opened' || words[2] !== 'by') return { sessionId }
  const surface = words[3]!.replace(/\.$/, '')
  return { sessionId, surface: surface || undefined }
}

// Each sentence names its owner whole, as the phone's do: languages with case endings can't take a name dropped in.
export function openElsewhereMessage(who: Owner): string {
  switch (who) {
    case 'desktop':
      return t('This chat is open in Hermes Desktop. Take it over to send from here.')
    case 'terminal':
      return t('This chat is open in a Hermes terminal. Take it over to send from here.')
    case 'otherBot':
      return t('This bot is answering a message from another bot. Take the chat over, and Conduit sends yours when it finishes.')
    default:
      return t('This chat is open in another Hermes window. Take it over to send from here.')
  }
}

export function takingOverMessage(who: Owner): string {
  switch (who) {
    case 'desktop':
      return t("Taking this chat over from Hermes Desktop. If it's replying, Conduit waits for the reply to finish.")
    case 'terminal':
      return t("Taking this chat over from a Hermes terminal. If it's replying, Conduit waits for the reply to finish.")
    case 'otherBot':
      return t('This bot is answering a message from another bot. Conduit sends yours when it finishes.')
    default:
      return t("Taking this chat over from another Hermes window. If it's replying, Conduit waits for the reply to finish.")
  }
}

export function stillReplyingMessage(who: Owner): string {
  switch (who) {
    case 'desktop':
      return t('Hermes Desktop is still replying in this chat. Try again when it finishes.')
    case 'terminal':
      return t('A Hermes terminal is still replying in this chat. Try again when it finishes.')
    case 'otherBot':
      return t('This bot is still answering a message from another bot. Try again when it finishes.')
    default:
      return t('Another Hermes window is still replying in this chat. Try again when it finishes.')
  }
}

export const heldHereMessage = () =>
  t('This chat is open in Conduit on another device or in the Hermes web chat. Send from there, or close it there and try again.')

export type TakeoverAnswer = { kind: 'ready' } | { kind: 'busy'; surface?: string } | { kind: 'sameHost' }

/** The route's answer: free or taken_over sends again, busy asks again, same_host is this dashboard's own claim. */
export function takeoverAnswer(body: unknown): TakeoverAnswer {
  const row = (body ?? {}) as { status?: unknown; surface?: unknown }
  const surface = typeof row.surface === 'string' && row.surface ? row.surface : undefined
  switch (row.status) {
    case 'taken_over':
    case 'free':
      return { kind: 'ready' }
    case 'busy':
      return { kind: 'busy', surface }
    case 'same_host':
      return { kind: 'sameHost' }
    default:
      throw Object.assign(new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.')), { code: -1 })
  }
}

export type TakeoverEnd = { kind: 'ready' } | { kind: 'failed'; message: string }

const isTransient = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code
  if (code === -1) return false
  return typeof code !== 'number' || code === 0 || code === 408 || code === 429 || (code >= 500 && code !== 501)
}

function failureMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 404 || code === 405) return t('Update the Conduit notifier plugin on your Hermes host to take chats over.')
  if (code === 501) return t("This Hermes version can't hand a chat over.")
  if (code === -1 && error instanceof Error) return error.message
  const detail = error instanceof Error ? error.message.trim() : String(error).trim()
  return detail
    ? t("Couldn't take this chat over: {detail}", { detail })
    : t("Couldn't take this chat over. Check the connection to your Hermes host and try again.")
}

/**
 * Asks the route until the chat is Conduit's, the other app's reply has run
 * past `waitMs`, or something can't be taken over. `onOwner` hears who holds
 * the chat when a busy answer names it; `keepWaiting` false ends it quietly.
 */
export async function runTakeover(
  ask: () => Promise<unknown>,
  options: {
    surface?: string
    waitMs?: number
    pollMs?: number
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    keepWaiting?: () => boolean
    onOwner?: (surface: string) => void
  } = {}
): Promise<TakeoverEnd | null> {
  const { waitMs = TAKEOVER_WAIT_MS, pollMs = TAKEOVER_POLL_MS, now = Date.now, keepWaiting = () => true } = options
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = now() + waitMs
  let surface = options.surface
  let transient = 0
  while (keepWaiting()) {
    try {
      const answer = takeoverAnswer(await ask())
      if (answer.kind === 'ready') return answer
      if (answer.kind === 'sameHost') return { kind: 'failed', message: heldHereMessage() }
      transient = 0
      if (answer.surface) {
        surface = answer.surface
        options.onOwner?.(answer.surface)
      }
      if (now() >= deadline) return { kind: 'failed', message: stillReplyingMessage(owner(surface)) }
    } catch (error) {
      transient++
      if (!isTransient(error) || transient >= TRANSIENT_LIMIT || now() >= deadline) return { kind: 'failed', message: failureMessage(error) }
    }
    await sleep(pollMs)
  }
  return null
}
