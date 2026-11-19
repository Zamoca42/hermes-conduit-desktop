/**
 * Capabilities > Connectors' Apps, after the phone's (HostedApps.swift): the
 * apps Hermes reaches through Nous Portal's hosted connectors (Gmail, Slack,
 * Notion...), for the profile's own account. The catalog, the statuses, the
 * accounts and the rules are joined here into one row per app; the calls are
 * the gateway's `connectors.*`.
 */
import { t } from '../../../shared/i18n'

type Row = Record<string, unknown>
const obj = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj).filter((r): r is Row => !!r) : [])
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
/** Text with something in it, trimmed; otherwise null. */
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export interface CatalogEntry {
  slug: string
  name: string
  description: string
  category: string
  logo: string | null
}

export interface AppStatus {
  connector: string
  enabled: boolean
  connected: boolean
  connectionStatus: string | null
  statusReason: string | null
  gatewayDisabledTools: string[]
}

export interface AppAccount {
  connectionId: string
  connector: string
  status: string
  statusReason: string | null
  label: string
  alias: string | null
  active: boolean
  /** Hermes turned it off (`disabled`): not one of the app's accounts any more. */
  retired: boolean
  createdAt: string
}

/** One layer of the rules: unrestricted, deny-all, allow or deny. */
export interface Rules {
  revision: string
  /** Only these apps, when set (allow; deny-all is an empty list). */
  allowed: string[] | null
  denied: string[]
  tools: Record<string, string[]>
  enabledTags: string[]
  disabledTags: string[]
}

/** The member's own rules, which the switches write, and the organization's above them. */
export interface Policy {
  member: Rules | null
  others: Rules[]
}

export type Facet = 'read' | 'write' | 'destructive' | 'unclassified'

export interface AppTool {
  slug: string
  name: string
  description: string
  facet: Facet
  hints: string[]
  deprecated: boolean
}

export interface OperationTarget {
  name: string
  state: string
  connectUrl: string | null
  connectionId: string | null
  detail: string | null
}

export interface Operation {
  id: string
  seq: number
  settled: boolean
  /** When Hermes stops waiting on the sign-in, in ms since the epoch (0 when it didn't say). */
  deadline: number
  targets: OperationTarget[]
}

export interface Snapshot {
  available: boolean
  catalog: CatalogEntry[]
  statuses: AppStatus[]
  accounts: AppAccount[]
  policy: Policy | null
  /** The rules couldn't be read: the switches can't change. */
  rulesFailed: boolean
}

export type AppState = 'connected' | 'expired' | 'broken' | 'connecting' | 'available' | 'off' | 'offByOrganization' | 'unknown'

export interface HostedApp {
  slug: string
  title: string
  description: string
  category: string
  logo: string | null
  state: AppState
  connected: boolean
  accounts: AppAccount[]
  disabledTools: string[]
  statusReason: string | null
}

export const UNAVAILABLE: Snapshot = { available: false, catalog: [], statuses: [], accounts: [], policy: null, rulesFailed: false }

/** A slug as a title: `google_drive` reads Google Drive, and Mcp reads MCP. */
export function titleOf(slug: string): string {
  return slug
    .split(/[_-]/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/\bMcp\b/g, 'MCP')
}

export function webUrl(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host ? url.href : null
  } catch {
    return null
  }
}

/** The catalog's logo when it's https, otherwise Composio's logo for the slug. */
export function logoUrl(slug: string, catalogLogo: string | null): string {
  const url = catalogLogo ? webUrl(catalogLogo) : null
  if (url && url.startsWith('https:')) return url
  return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`
}

export function parseCatalog(raw: unknown): CatalogEntry[] {
  return rows(obj(raw)?.connectors).flatMap(row => {
    const slug = text(row.slug)
    if (!slug) return []
    return [
      { slug, name: text(row.name) ?? titleOf(slug), description: text(row.description) ?? '', category: text(row.category) ?? '', logo: text(row.logo_url) }
    ]
  })
}

export function parseStatuses(raw: unknown): { available: boolean; statuses: AppStatus[] } {
  const answer = obj(raw)
  const statuses = rows(answer?.connectors).flatMap(row => {
    const connector = text(row.connector)
    if (!connector) return []
    return [
      {
        connector,
        enabled: row.enabled !== false,
        connected: row.connected === true,
        connectionStatus: text(row.connection_status),
        statusReason: text(row.status_reason),
        gatewayDisabledTools: strings(row.gateway_disabled_tools)
      }
    ]
  })
  return { available: answer?.available === true, statuses }
}

export function parseAccount(row: Row): AppAccount | null {
  const connectionId = text(row.connection_id)
  const connector = text(row.connector)
  if (!connectionId || !connector) return null
  return {
    connectionId,
    connector,
    status: text(row.status) ?? 'active',
    statusReason: text(row.status_reason),
    label: typeof row.label === 'string' ? row.label : connector,
    alias: typeof row.alias === 'string' ? row.alias : null,
    active: row.active === true,
    retired: row.disabled === true,
    createdAt: typeof row.created_at === 'string' ? row.created_at : ''
  }
}

export function parseAccounts(raw: unknown): AppAccount[] {
  return rows(obj(raw)?.accounts).flatMap(row => parseAccount(row) ?? [])
}

/** An account's name: what it was called, otherwise the vendor's label. */
export const accountName = (account: AppAccount) => text(account.alias) ?? account.label

function parseRules(layer: Row): Rules | null {
  const body = obj(layer.body)
  const mode = body?.mode
  if (!body || typeof mode !== 'string') return null
  const revision = typeof layer.revision === 'string' ? layer.revision : ''
  const tools: Record<string, string[]> = {}
  for (const [slug, list] of Object.entries(obj(body.tools) ?? {})) tools[slug] = strings(list)
  const tags = obj(body.tags)
  const base = { revision, allowed: null, denied: [], tools: {}, enabledTags: [], disabledTags: [] }
  const tagged = { tools, enabledTags: strings(tags?.enable), disabledTags: strings(tags?.disable) }
  if (mode === 'unrestricted') return base
  if (mode === 'deny-all') return { ...base, allowed: [] }
  if (mode === 'allow') return { ...base, ...tagged, allowed: strings(body.connectors) }
  if (mode === 'deny') return { ...base, ...tagged, denied: strings(body.disabled_connectors) }
  return null
}

/** `connectors.policy.get`: the member's layer and the rest. A layer it can't read makes the whole answer unreadable. */
export function parsePolicy(raw: unknown): Policy | null {
  const layers = obj(raw)?.layers
  if (!Array.isArray(layers)) return null
  let member: Rules | null = null
  const others: Rules[] = []
  for (const entry of layers) {
    const layer = obj(entry)
    const rules = layer && parseRules(layer)
    if (!layer || !rules) return null
    if (layer.kind === 'member') member = member ?? rules
    else others.push(rules)
  }
  return { member, others }
}

const allows = (rules: Rules, slug: string) => (rules.allowed ? rules.allowed.includes(slug) : true) && !rules.denied.includes(slug)
export const memberEnables = (policy: Policy, slug: string) => (policy.member ? allows(policy.member, slug) : true)
export const organizationLocks = (policy: Policy, slug: string) => policy.others.some(rules => !allows(rules, slug))
export const memberDisabledTools = (policy: Policy, slug: string) => policy.member?.tools[slug] ?? []
/** The revision a switch writes against: none when the organization manages the switches. */
export const policyRevision = (policy: Policy | null) => policy?.member?.revision ?? null

/** The tools the organization keeps off: by name, by a tag it turns off, or by missing every tag it allows. */
export function organizationLockedTools(policy: Policy, slug: string, tools: AppTool[]): Set<string> {
  const locked = new Set<string>()
  for (const rules of policy.others) {
    for (const tool of rules.tools[slug] ?? []) locked.add(tool)
    for (const tool of tools) {
      const offByTag = rules.disabledTags.some(tag => tool.hints.includes(tag))
      const missingEveryOnTag = rules.enabledTags.length > 0 && !rules.enabledTags.some(tag => tool.hints.includes(tag))
      if (offByTag || missingEveryOnTag) locked.add(tool.slug)
    }
  }
  return locked
}

export function parseTools(raw: unknown): AppTool[] {
  return rows(obj(raw)?.tools).flatMap(row => {
    const slug = text(row.slug)
    if (!slug) return []
    const facet: Facet = row.facet === 'read' || row.facet === 'write' || row.facet === 'destructive' ? row.facet : 'unclassified'
    return [
      {
        slug,
        name: text(row.name) ?? slug,
        description: typeof row.description === 'string' ? row.description : '',
        facet,
        hints: strings(row.hints),
        deprecated: row.deprecated === true
      }
    ]
  })
}

export function parseOperation(raw: unknown): Operation | null {
  const answer = obj(raw)
  const id = text(answer?.op_id)
  if (!answer || !id) return null
  const targets = rows(answer.targets).flatMap(target => {
    if (typeof target.name !== 'string') return []
    return [
      {
        name: target.name,
        state: text(target.state) ?? 'pending',
        connectUrl: webUrl(target.connect_url),
        connectionId: text(target.connection_id),
        detail: text(target.detail)
      }
    ]
  })
  const deadline = typeof answer.deadline_at === 'number' ? answer.deadline_at * (answer.deadline_at < 1e12 ? 1000 : 1) : 0
  return { id, seq: typeof answer.seq === 'number' ? answer.seq : 0, settled: answer.settled === true, deadline, targets }
}

export const targetOf = (operation: Operation, slug: string) => operation.targets.find(target => target.name === slug) ?? null
export const isConnected = (target: OperationTarget | null) => target?.state === 'connected'
export const isRetryable = (target: OperationTarget | null) => target?.state === 'failed' || target?.state === 'expired'

/** A later status keeps the page an earlier one gave when it names none, unless the sign-in started over. */
export function carryingLink(operation: Operation, earlier: Operation): Operation {
  return {
    ...operation,
    targets: operation.targets.map(target => {
      const held = targetOf(earlier, target.name)
      if (target.connectUrl || !held || (target.state === 'initiated' && held.state !== 'initiated')) return target
      return { ...target, connectUrl: held.connectUrl, connectionId: target.connectionId ?? held.connectionId }
    })
  }
}

function stateOf(status: string): AppState {
  switch (status) {
    case 'active':
      return 'connected'
    case 'expired':
    case 'inactive':
    case 'revoked':
      return 'expired'
    case 'failed':
      return 'broken'
    case 'pending':
      return 'connecting'
    default:
      return 'unknown'
  }
}

export const accountState = (account: AppAccount) => stateOf(account.status)

/** One app, from the catalog, its status, the profile's accounts and the rules. */
export function appOf(snapshot: Snapshot, slug: string): HostedApp {
  const entry = snapshot.catalog.find(e => e.slug === slug)
  const status = snapshot.statuses.find(s => s.connector === slug)
  // The account in use first, then the newest.
  const mine = snapshot.accounts
    .filter(a => a.connector === slug && !a.retired)
    .sort((a, b) => (a.active === b.active ? b.createdAt.localeCompare(a.createdAt) : a.active ? -1 : 1))
  const account = mine[0]
  const policy = snapshot.policy
  const disabledTools = policy ? memberDisabledTools(policy, slug) : (status?.gatewayDisabledTools ?? [])
  const connected = !!account || status?.connected === true
  const enabled = (policy ? memberEnables(policy, slug) : true) && status?.enabled !== false
  const state: AppState =
    policy && organizationLocks(policy, slug)
      ? 'offByOrganization'
      : !enabled
        ? 'off'
        : !connected
          ? 'available'
          : stateOf(account?.status ?? status?.connectionStatus ?? 'active')
  return {
    slug,
    title: entry?.name ?? titleOf(slug),
    description: entry?.description ?? '',
    category: entry?.category ?? '',
    logo: logoUrl(slug, entry?.logo ?? null),
    state,
    connected,
    accounts: mine,
    disabledTools,
    statusReason: account?.statusReason ?? status?.statusReason ?? null
  }
}

/** Every app: the catalog's, then any Hermes lists a status for and the catalog doesn't. */
export function appsOf(snapshot: Snapshot): HostedApp[] {
  const slugs = snapshot.catalog.map(e => e.slug)
  for (const status of snapshot.statuses) if (!slugs.includes(status.connector)) slugs.push(status.connector)
  return slugs.map(slug => appOf(snapshot, slug))
}

/** Yours: connected, or turned off with its sign-in kept. */
export const isYours = (app: HostedApp) => app.connected || app.state === 'off'
export const needsReconnect = (app: HostedApp) => app.state === 'expired' || app.state === 'broken'

export function matches(app: HostedApp, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [app.title, app.slug, app.category, app.description].some(field => field.toLowerCase().includes(q))
}

/** The section's rows: yours (those to sign in again first), then up to 8 others the search finds. */
export function sectionRows(apps: HostedApp[], query: string): { yours: HostedApp[]; found: HostedApp[] } {
  const yours = apps
    .filter(app => isYours(app) && matches(app, query))
    .sort((a, b) => Number(!needsReconnect(a)) - Number(!needsReconnect(b)) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
  const found = query.trim() ? apps.filter(app => !isYours(app) && matches(app, query)).slice(0, 8) : []
  return { yours, found }
}

export const categoryTitle = (category: string) => (category ? titleOf(category) : t('Other'))

/** The directory: every app the search finds, by category, each sorted by title. */
export function directoryGroups(apps: HostedApp[], query: string): { category: string; apps: HostedApp[] }[] {
  const groups = new Map<string, HostedApp[]>()
  for (const app of apps) {
    if (!matches(app, query)) continue
    const key = categoryTitle(app.category)
    groups.set(key, [...(groups.get(key) ?? []), app])
  }
  return [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map(category => ({ category, apps: groups.get(category)!.sort((a, b) => a.title.localeCompare(b.title)) }))
}

export function stateWord(state: AppState): string | null {
  switch (state) {
    case 'connected':
      return t('Connected')
    case 'expired':
      return t('Sign in again')
    case 'broken':
      return t('Couldn’t connect')
    case 'connecting':
      return t('Finishing sign-in')
    case 'off':
      return t('Off')
    case 'offByOrganization':
      return t('Off by your organization')
    case 'unknown':
      return t('Checking')
    default:
      return null
  }
}

/** The row's second line: the account, how many, and how many tools are off; or the description. */
export function rowDetail(app: HostedApp): string | null {
  if (!app.connected) return app.description || null
  const parts: string[] = []
  if (app.accounts[0]) parts.push(accountName(app.accounts[0]))
  if (app.accounts.length > 1) parts.push(t('{count} accounts', { count: app.accounts.length }))
  if (app.disabledTools.length) parts.push(t('{count} tools off', { count: app.disabledTools.length }))
  return parts.length ? parts.join(' · ') : null
}

export function facetWord(facet: Facet): { text: string; tone: 'warn' | 'danger' } | null {
  if (facet === 'write') return { text: t('Writes'), tone: 'warn' }
  if (facet === 'destructive') return { text: t('Deletes'), tone: 'danger' }
  return null
}

const ACCOUNT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

/** Why a typed account name won't do, or null. */
export function accountNameProblem(name: string, accounts: AppAccount[], renaming?: string): string | null {
  if (!ACCOUNT_NAME.test(name)) return t('Use lowercase letters, digits and dashes, up to 32, starting with a letter or digit.')
  if (accounts.some(a => a.alias === name && a.connectionId !== renaming)) return t('Another account of this app already has that name.')
  return null
}
