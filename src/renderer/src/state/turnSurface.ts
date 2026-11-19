/**
 * Where a message was sent from, after the phone's TurnSurface (#888): just
 * before a send, the plugin hears the surface (`mac` on a Mac, `windows` on
 * a Windows PC), how the message was entered and the SHA-256 of the exact
 * text `prompt.submit` carries, and that turn gets one line saying so. A
 * send waits for the report at most 600 ms. A send Hermes refused drops its
 * report, tried again after 1, 3 and 9 seconds, so the same words sent from
 * another app in that chat don't take its line; a send whose answer was only
 * lost keeps it. The routes are the dashboard's own, never a profile's.
 */
import { gateway, GatewayError } from '../gateway'
import { STATUS_PATH, pluginStatus } from './plugin'

export const TURN_SURFACE_PATH = '/api/plugins/conduit_push/turn-surface'
export const DISCARD_PATH = '/api/plugins/conduit_push/turn-surface/discard'
export const REPORT_WAIT_MS = 600
export const DISCARD_RETRY_MS = [1000, 3000, 9000]
/** How long a capabilities answer stands before it's read again. */
const CAPABILITIES_MS = 10 * 60_000

export type Surface = 'mac' | 'windows'
export type Input = 'typed' | 'spoken'

/** The surface this computer reports, or null when the plugin wouldn't take it. */
export function surfaceFor(platform: string, capabilities: string[]): Surface | null {
  if (!capabilities.includes('turn-surface')) return null
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32' && capabilities.includes('turn-surface-windows')) return 'windows'
  return null
}

export async function sha256Hex(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(hash, b => b.toString(16).padStart(2, '0')).join('')
}

export function reportBody(sessionId: string, digest: string, surface: Surface, input: Input, heard: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { session_id: sessionId, text_sha256: digest, surface, input }
  if (heard && input !== 'spoken') body.heard = true
  return body
}

/** A send Hermes refused (it answered with an error), so no turn of it is coming; a timeout or a dropped socket may have delivered it. */
export function refusedSend(error: unknown): boolean {
  return error instanceof GatewayError && typeof error.code === 'number'
}

let capabilities: { host: string; at: number; list: Promise<string[]> } | null = null

/** The plugin's capabilities on this host, read once in a while. */
function pluginCapabilities(host: string): Promise<string[]> {
  if (capabilities && capabilities.host === host && Date.now() - capabilities.at < CAPABILITIES_MS) return capabilities.list
  const list = gateway
    .http('GET', STATUS_PATH, undefined, 8_000)
    .then(body => {
      const status = pluginStatus(body)
      return status.state === 'reported' ? status.capabilities : []
    })
    .catch(() => {
      capabilities = null
      return [] as string[]
    })
  capabilities = { host, at: Date.now(), list }
  return list
}

let host = ''

/** The dashboard signed in to; another one's capabilities are read again. */
export function setTurnSurfaceHost(next: string): void {
  if (next === host) return
  host = next
  capabilities = null
}

/** Reports where `text` was sent from, ending once the plugin answered or 600 ms passed. */
export async function reportTurnSurface(sessionId: string, text: string, input: Input, heard: boolean): Promise<void> {
  const report = (async () => {
    const surface = surfaceFor(window.conduit.platform, await pluginCapabilities(host))
    if (!surface) return
    const body = reportBody(sessionId, await sha256Hex(text), surface, input, heard)
    await gateway.http('POST', TURN_SURFACE_PATH, body, 5_000)
  })().catch(() => undefined)
  await Promise.race([report, new Promise(resolve => setTimeout(resolve, REPORT_WAIT_MS))])
}

/** Drops the report of a send Hermes refused, on the dashboard it was made on. */
export function discardTurnSurface(sessionId: string, text: string, error: unknown): void {
  if (!refusedSend(error)) return
  const madeOn = host
  void (async () => {
    if (!(await pluginCapabilities(madeOn)).includes('turn-surface-discard')) return
    const body = { session_id: sessionId, text_sha256: await sha256Hex(text) }
    for (let attempt = 0; ; attempt++) {
      if (host !== madeOn) return
      try {
        await gateway.http('POST', DISCARD_PATH, body, 5_000)
        return
      } catch (e) {
        if (!mayGoLater(e) || attempt >= DISCARD_RETRY_MS.length) return
        await new Promise(resolve => setTimeout(resolve, DISCARD_RETRY_MS[attempt]))
      }
    }
  })()
}

/** A discard that didn't go: no answer, a 408 or 429, or a 5xx; a plugin's other refusal stands. */
export function mayGoLater(error: unknown): boolean {
  if (!(error instanceof GatewayError) || typeof error.code !== 'number') return true
  return error.code === 0 || error.code === 408 || error.code === 429 || error.code >= 500
}
