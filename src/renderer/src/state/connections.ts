/**
 * The card Hermes waits on in a chat when the model connects something
 * (`manage_connections`, `manage_catalog`), after the phone's
 * ConnectionActivity (#1988, #1993): an app to sign in to through Nous
 * Portal, an MCP server to set up with the keys it asks for, a catalog
 * plugin or skill to install, or the apps directory with Hermes' picks.
 * `connection.request` opens it, every change comes as `connection.update`
 * with the whole snapshot, and the card answers through `connection.respond`.
 *
 * Live-only: a resume brings an open one back from `pending_connection`. A
 * key typed for an MCP server lives in the card's view state and goes once
 * onto the socket.
 */

export interface ConnectionField {
  name: string
  required: boolean
  secret: boolean
  /** A plain field's starting value; never a secret's. */
  defaultValue: string
  prompt?: string
}

export type TargetKind = 'connector' | 'mcp' | 'plugin' | 'skill'
export type TargetState = 'pending' | 'initiated' | 'connected' | 'skipped' | 'failed' | 'expired' | 'not_connected'

export interface ConnectionTarget {
  name: string
  kind: TargetKind
  /** authorize, connect, enable, install or reconnect. */
  action: string
  state: TargetState
  detail?: string
  instructions?: string
  /** The page to open, a web address only. */
  connectUrl?: string
  connectionId?: string
  fields: ConnectionField[]
  displayName?: string
  summary?: string
  tier?: string
  scanStatus?: string
  scanSummary?: string
  /** Signed in, but Hermes couldn't list its tools. */
  discoveryError?: string
  alreadyInstalled: boolean
}

export interface ConnectionCard {
  opId: string
  /** The chat's runtime session. */
  sessionId: string
  /** Hermes' write counter: a frame with a lower one is older. */
  seq: number
  deadline?: number
  targets: ConnectionTarget[]
  /** The apps directory card: no targets, these apps first. */
  suggested?: string[]
  settled: boolean
  /** all_resolved, continue, deadline or interrupt. */
  settledBy?: string
}

const KINDS: TargetKind[] = ['connector', 'mcp', 'plugin', 'skill']
const STATES: TargetState[] = ['pending', 'initiated', 'connected', 'skipped', 'failed', 'expired', 'not_connected']

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const obj = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)
const webUrl = (value: unknown) => {
  const url = text(value)
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/** "google_drive" → "Google Drive", as the phone's HostedApps.title. */
export function appTitle(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(word => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

export const targetTitle = (target: ConnectionTarget) => target.displayName ?? appTitle(target.name)

/** Nothing more for the user to do on this row. */
export const isResolved = (target: ConnectionTarget) => target.state === 'connected' || target.state === 'skipped'

/** An app's page to open: Connect. */
export const opensPage = (target: ConnectionTarget) =>
  (target.state === 'pending' || target.state === 'initiated') && !!target.connectUrl && (target.kind === 'connector' || target.kind === 'mcp')

/** An app sign-in whose page went dead: Try Again has Hermes mint a new one. */
export const reissues = (target: ConnectionTarget) => target.kind === 'connector' && (target.state === 'failed' || target.state === 'expired')

/** An install or setup to approve or skip, with the keys it asks for. A pending sign-in is Hermes still minting its page. */
export function asksApproval(target: ConnectionTarget): boolean {
  if (target.kind === 'connector') return false
  if (target.state !== 'pending' && target.state !== 'failed' && target.state !== 'expired') return false
  return !(target.state === 'pending' && target.action === 'authorize')
}

function target(row: Record<string, unknown>): ConnectionTarget | null {
  const name = text(row.name)
  if (!name) return null
  const fields = (Array.isArray(row.required_env) ? row.required_env : []).flatMap(value => {
    const field = obj(value)
    const fieldName = text(field?.name)
    if (!field || !fieldName) return []
    const secret = typeof field.secret === 'boolean' ? field.secret : field.type === 'secret'
    return [
      {
        name: fieldName,
        required: field.required === true,
        secret,
        defaultValue: secret ? '' : typeof field.default === 'string' ? field.default : '',
        prompt: text(field.prompt)
      }
    ]
  })
  const scan = obj(row.scan)
  return {
    name,
    kind: KINDS.includes(row.kind as TargetKind) ? (row.kind as TargetKind) : 'connector',
    action: typeof row.action === 'string' ? row.action : 'connect',
    state: STATES.includes(row.state as TargetState) ? (row.state as TargetState) : 'pending',
    detail: text(row.detail),
    instructions: text(row.instructions),
    connectUrl: webUrl(row.connect_url),
    connectionId: text(row.connection_id),
    fields,
    displayName: text(row.display),
    summary: text(row.description),
    tier: text(row.tier),
    scanStatus: text(scan?.status),
    scanSummary: text(scan?.summary),
    discoveryError: text(row.discovery_error),
    alreadyInstalled: row.already_installed === true
  }
}

/** A `connection.request` or `connection.update` payload, or a resume's `pending_connection`. An update names its own chat in `owner`. */
export function connectionFrom(payload: unknown, sessionId: string): ConnectionCard | null {
  const row = obj(payload)
  const opId = text(row?.op_id)
  if (!row || !opId) return null
  const owner = obj(row.owner)
  if (owner && typeof owner.type === 'string' && owner.type !== 'session') return null
  const session = text(owner?.session_id) ?? sessionId
  if (!session) return null
  const display = obj(row.display)
  const deadline = typeof row.deadline_at === 'number' && row.deadline_at > 0 ? row.deadline_at * 1000 : undefined
  return {
    opId,
    sessionId: session,
    seq: typeof row.seq === 'number' ? row.seq : 0,
    deadline,
    targets: (Array.isArray(row.targets) ? row.targets : []).flatMap(value => {
      const parsed = obj(value) && target(obj(value)!)
      return parsed ? [parsed] : []
    }),
    suggested: display ? (Array.isArray(display.suggested) ? display.suggested : []).flatMap(name => (text(name) ? [text(name)!] : [])) : undefined,
    settled: typeof row.settled === 'boolean' ? row.settled : typeof row.settled_at === 'number',
    settledBy: text(row.settled_by)
  }
}

/**
 * This frame over the card already shown, or null when it changes nothing:
 * an older frame never does. A directory card stays one, and a page a later
 * frame left out stays while the row still waits on it.
 */
export function appliedOver(frame: ConnectionCard, shown: ConnectionCard): ConnectionCard | null {
  if (frame.opId !== shown.opId || frame.seq < shown.seq) return null
  if (frame.seq === shown.seq && frame.settled === shown.settled && JSON.stringify(frame.targets) === JSON.stringify(shown.targets)) return null
  const suggested = frame.suggested ?? (frame.targets.length ? undefined : shown.suggested)
  const targets = frame.targets.map(next => {
    if (next.connectUrl || next.state !== 'initiated') return next
    const held = shown.targets.find(t => t.name === next.name)
    return held?.state === 'initiated' && held.connectUrl
      ? { ...next, connectUrl: held.connectUrl, connectionId: next.connectionId ?? held.connectionId }
      : next
  })
  return { ...frame, suggested, targets }
}

/** One row's answer: approved with the keys typed (only those with a value), or skipped. */
export function rowAnswer(name: string, approve: boolean, env: Record<string, string> = {}): Record<string, unknown> {
  const answer: Record<string, unknown> = { name, status: approve ? 'approved' : 'skipped' }
  const values = Object.fromEntries(Object.entries(env).filter(([, value]) => value.trim()))
  if (approve && Object.keys(values).length) answer.env = values
  return answer
}

/** Every required key has a value. */
export const hasRequiredValues = (fields: ConnectionField[], env: Record<string, string>) => fields.every(f => !f.required || !!(env[f.name] ?? '').trim())

export const connectionOwner = (sessionId: string) => ({ type: 'session', session_id: sessionId })
