/**
 * The model providers a profile can use, after the phone's Models &
 * providers: an account Hermes signs in to, an API key, or a custom
 * OpenAI-compatible endpoint. Built from Hermes' `/api/env`, its sign-ins
 * (`/api/providers/oauth`), the profile's endpoints and the credential pools.
 *
 * Keys only go up: Conduit never asks Hermes for a saved key, never shows
 * its masked preview and keeps none. A shared key is a row in the main
 * (`default`) profile's credential pool, which a profile with no rows of its
 * own for the provider falls back to; a profile's own key is a row in its own
 * pool, with Hermes' copies of the shared rows taken out, since a copy comes
 * first.
 */
import { t } from '../../../shared/i18n'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(object).filter((r): r is Row => !!r) : [])

export const SHARED_PROFILE = 'default'
export const SHARED_LABEL = 'Conduit (all profiles)'
export const PROFILE_LABEL = 'Conduit (this profile)'

export interface PoolRow {
  id: string
  /** Its 1-based place in the pool, which removal names. */
  index: number
  label: string
  source: string
}

export interface KeyAccess {
  /** Variables Hermes reads the key from, the provider's own first. */
  vars: string[]
  /** The variables set in this profile's `.env`. */
  savedVars: string[]
  /** The main profile's pool rows a key was pasted into (not `.env` rows). */
  sharedRows: PoolRow[]
  /** This profile's own pool rows, in Hermes' order; empty on the main profile. */
  profileRows: PoolRow[]
  /** Sign-ins in this profile's own pool: with them Hermes uses that pool. */
  profileSignIns: number
  signupURL?: string
  /** Its variables are other providers' that it also reads. */
  borrowedOnly: boolean
  /** Saved variables another provider also reads as its own key. */
  heldVars: string[]
  /** The keys and sign-ins Hermes takes turns over on this profile. */
  keysInUse: number
  /** How many of `keysInUse` are sign-ins. */
  signInsInUse: number
}

export type KeyState = 'none' | 'shared' | 'own' | 'oldCopy' | 'mainProfileOnly'

export interface AccountAccess {
  flow: 'device_code' | 'external'
  signedIn: boolean
  command?: string
  docsURL?: string
  signsOutHere: boolean
}

export interface EndpointAccess {
  endpointID: string
  baseURL: string
  model: string
  models: string[]
  keySaved: boolean
  isCurrent: boolean
}

export interface ProviderEntry {
  /** The provider's slug, or `endpoint:<key>` for a custom endpoint. */
  id: string
  name: string
  key?: KeyAccess
  account?: AccountAccess
  endpoint?: EndpointAccess
  /** Settings that aren't keys (a base URL override, a region), saved or not. */
  settings: { variable: string; description: string; saved: boolean }[]
  onMainProfile: boolean
}

export type ProviderStatus = 'customEndpoint' | 'signedIn' | 'sharedKey' | 'ownKey' | 'oldCopy' | 'mainProfileOnly' | 'configured' | 'notConnected'

const sharedIDs = (key: KeyAccess) => new Set(key.sharedRows.map(r => r.id))
export const removableVars = (key: KeyAccess) => key.savedVars.filter(v => !key.heldVars.includes(v))
/** This profile's rows that aren't the shared key: its own keys, `.env` rows, old copies. */
export const ownRows = (key: KeyAccess) => key.profileRows.filter(r => !sharedIDs(key).has(r.id))
/** The own rows Conduit may remove: not one read from a variable another provider also reads. */
export const removableRows = (key: KeyAccess) => ownRows(key).filter(row => !key.heldVars.some(v => row.source === `env:${v}`))

export function keyState(entry: ProviderEntry): KeyState {
  const key = entry.key
  if (!key) return 'none'
  const shared = key.sharedRows.length > 0
  const saved = key.savedVars.length > 0
  if (entry.onMainProfile) return shared ? 'shared' : saved ? 'mainProfileOnly' : 'none'
  const first = key.profileRows[0]
  if (!first) {
    if (key.profileSignIns > 0) return saved ? 'own' : 'none'
    return shared ? 'shared' : saved ? 'own' : 'none'
  }
  if (sharedIDs(key).has(first.id)) return 'shared'
  return first.label === SHARED_LABEL ? 'oldCopy' : 'own'
}

export function providerStatus(entry: ProviderEntry): ProviderStatus {
  if (entry.endpoint) return 'customEndpoint'
  if (entry.account?.signedIn) return 'signedIn'
  switch (keyState(entry)) {
    case 'shared':
      return 'sharedKey'
    case 'own':
      return 'ownKey'
    case 'oldCopy':
      return 'oldCopy'
    case 'mainProfileOnly':
      return 'mainProfileOnly'
    default:
      if ((entry.key?.profileSignIns ?? 0) > 0) return 'signedIn'
      return !entry.account && entry.settings.some(s => s.saved) ? 'configured' : 'notConnected'
  }
}

export const isConnected = (entry: ProviderEntry) => providerStatus(entry) !== 'notConnected'

export function statusTitle(entry: ProviderEntry): string {
  switch (providerStatus(entry)) {
    case 'customEndpoint':
      return t('Custom endpoint')
    case 'signedIn':
      return t('Signed in')
    case 'sharedKey':
      return t('Shared key')
    case 'ownKey':
      return t("This profile's own key")
    case 'oldCopy':
      return t('Old copy of the shared key')
    case 'mainProfileOnly':
      return t('Saved for the main profile only')
    case 'configured':
      return entry.key ? t('Settings saved, no key yet') : t('Settings saved')
    default:
      return entry.account ? t('Not signed in yet.') : t('No key yet')
  }
}

/** A pool answer's API-key rows by provider, in Hermes' order. */
export function poolRows(answer: unknown): Map<string, PoolRow[]> {
  const out = new Map<string, PoolRow[]>()
  for (const provider of rows(object(answer)?.providers)) {
    const id = text(provider.provider)
    if (!id) continue
    out.set(
      id,
      rows(provider.entries)
        .filter(row => (text(row.auth_type) ?? 'api_key') === 'api_key' && text(row.id) && typeof row.index === 'number')
        .map(row => ({
          id: text(row.id)!,
          index: row.index as number,
          label: typeof row.label === 'string' ? row.label : '',
          source: typeof row.source === 'string' ? row.source : ''
        }))
    )
  }
  return out
}

/** Every credential and the sign-ins among them a pool holds, per provider. */
function credentialCounts(answer: unknown): Map<string, { all: number; signIns: number }> {
  const out = new Map<string, { all: number; signIns: number }>()
  for (const provider of rows(object(answer)?.providers)) {
    const id = text(provider.provider)
    if (!id) continue
    const entries = rows(provider.entries)
    out.set(id, { all: entries.length, signIns: entries.filter(row => (text(row.auth_type) ?? 'api_key') !== 'api_key').length })
  }
  return out
}

/** Sign-ins (not keys) a pool holds per provider. */
function signInCounts(answer: unknown): Map<string, number> {
  const out = new Map<string, number>()
  for (const provider of rows(object(answer)?.providers)) {
    const id = text(provider.provider)
    if (id) out.set(id, rows(provider.entries).filter(row => (text(row.auth_type) ?? 'api_key') !== 'api_key').length)
  }
  return out
}

interface ProviderProfile {
  slug: string
  label: string
  url?: string
  primary: boolean
}

/** One credential can serve several providers (`provider_profiles`); each gets it. */
function providerProfiles(row: Row, isPassword: boolean): ProviderProfile[] {
  const listed = rows(row.provider_profiles)
    .filter(p => text(p.provider))
    .map(p => ({ slug: text(p.provider)!, label: text(p.provider_label) ?? text(p.provider)!, url: text(p.url), primary: p.primary === true }))
  if (listed.length) return listed
  const slug = text(row.provider)
  if (!slug) return []
  // Hermes marks only a key as primary: a setting comes with false and is still its own.
  const primary = isPassword ? row.provider_primary !== false : true
  return [{ slug, label: text(row.provider_label) ?? slug, url: text(row.url), primary }]
}

export interface Answers {
  env: unknown
  accounts?: unknown
  endpoints?: unknown
  sharedPool?: unknown
  /** The profile's own pool; none on the main profile. */
  profilePool?: unknown
  onMainProfile: boolean
}

/** Every provider Hermes knows, with each way this profile reaches it, by name. */
export function buildEntries({ env, accounts, endpoints, sharedPool, profilePool, onMainProfile }: Answers): ProviderEntry[] {
  const byID = new Map<string, ProviderEntry>()
  const borrowed = new Map<string, string[]>()
  const owners = new Map<string, number>()
  const update = (id: string, name: string, change: (entry: ProviderEntry) => void) => {
    let entry = byID.get(id)
    if (!entry) {
      entry = { id, name, settings: [], onMainProfile }
      byID.set(id, entry)
    }
    change(entry)
  }
  const blankKey = (): KeyAccess => ({
    vars: [],
    savedVars: [],
    sharedRows: [],
    profileRows: [],
    profileSignIns: 0,
    borrowedOnly: false,
    heldVars: [],
    keysInUse: 0,
    signInsInUse: 0
  })

  for (const [variable, value] of Object.entries(object(env) ?? {})) {
    const row = object(value)
    if (!row || row.category !== 'provider') continue
    const isSet = row.is_set === true
    const isPassword = row.is_password === true
    for (const profile of providerProfiles(row, isPassword)) {
      if (isPassword) {
        update(profile.slug, profile.label, entry => {
          const key = entry.key ?? blankKey()
          if (profile.primary) {
            owners.set(variable, (owners.get(variable) ?? 0) + 1)
            key.vars.push(variable)
            if (isSet) key.savedVars.push(variable)
          } else {
            borrowed.set(profile.slug, [...(borrowed.get(profile.slug) ?? []), variable])
          }
          key.signupURL ??= profile.url
          entry.key = key
        })
      } else if (profile.primary) {
        update(profile.slug, profile.label, entry => {
          entry.settings.push({ variable, description: text(row.description) ?? '', saved: isSet })
        })
      }
    }
  }
  for (const entry of byID.values()) {
    const key = entry.key
    if (!key) continue
    key.vars.sort()
    key.savedVars.sort()
    key.heldVars = key.savedVars.filter(v => (owners.get(v) ?? 0) > 1)
    if (!key.vars.length) {
      key.vars = [...(borrowed.get(entry.id) ?? [])].sort()
      key.borrowedOnly = true
    }
    if (!key.vars.length) entry.key = undefined
  }

  // Rows the main pool read from its own `.env` aren't shared: no other profile has the variable.
  for (const [id, list] of poolRows(sharedPool)) {
    const key = byID.get(id)?.key
    if (key) key.sharedRows = list.filter(row => !row.source.startsWith('env:'))
  }
  if (!onMainProfile) {
    for (const [id, list] of poolRows(profilePool)) {
      const key = byID.get(id)?.key
      if (key) key.profileRows = list
    }
    for (const [id, count] of signInCounts(profilePool)) {
      const key = byID.get(id)?.key
      if (key) key.profileSignIns = count
    }
  }
  // The main profile reads its whole pool, `.env` rows included; another reads its own rows
  // (a sign-in of its own is one), or falls back to the shared ones. Sign-ins count too.
  const sharedCounts = credentialCounts(sharedPool)
  const ownCounts = onMainProfile ? new Map<string, { all: number; signIns: number }>() : credentialCounts(profilePool)
  for (const entry of byID.values()) {
    const key = entry.key
    if (!key) continue
    const shared = sharedCounts.get(entry.id) ?? { all: 0, signIns: 0 }
    const own = ownCounts.get(entry.id) ?? { all: 0, signIns: 0 }
    const usesShared = onMainProfile || own.all === 0
    key.keysInUse = onMainProfile ? shared.all : usesShared ? key.sharedRows.length + shared.signIns : own.all
    key.signInsInUse = usesShared ? shared.signIns : own.signIns
  }
  for (const entry of byID.values()) entry.settings.sort((a, b) => a.variable.localeCompare(b.variable))

  for (const row of rows(object(accounts)?.providers)) {
    const id = text(row.id)
    const flow = row.flow === 'device_code' || row.flow === 'external' ? row.flow : null
    if (!id || !flow) continue
    const name = text(row.name) ?? id
    update(id, name, entry => {
      entry.name = name
      entry.account = {
        flow,
        signedIn: object(row.status)?.logged_in === true,
        command: text(row.cli_command),
        docsURL: text(row.docs_url),
        signsOutHere: row.disconnectable === true
      }
    })
  }

  for (const row of rows(object(endpoints)?.endpoints)) {
    const endpointID = text(row.id)
    const baseURL = text(row.base_url)
    if (!endpointID || !baseURL) continue
    update(`endpoint:${endpointID}`, text(row.name) ?? endpointID, entry => {
      entry.endpoint = {
        endpointID,
        baseURL,
        model: typeof row.model === 'string' ? row.model : '',
        models: Array.isArray(row.models) ? row.models.filter((m): m is string => typeof m === 'string') : [],
        keySaved: row.has_api_key === true,
        isCurrent: row.is_current === true
      }
    })
  }

  return [...byID.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** The names Hermes' model catalog may list this provider under. */
export const catalogNames = (entry: ProviderEntry) => (entry.endpoint ? [entry.endpoint.endpointID, `custom:${entry.endpoint.endpointID}`] : [entry.id])

export interface ProviderCheck {
  ok: boolean
  /** Hermes reached the provider; when it couldn't, the key may still be fine. */
  reachable: boolean
  message: string
  models: string[]
}

export function parseCheck(answer: unknown): ProviderCheck {
  const row = object(answer) ?? {}
  return {
    ok: row.ok === true,
    reachable: row.reachable !== false,
    message: text(row.message) ?? '',
    models: Array.isArray(row.models) ? row.models.filter((m): m is string => typeof m === 'string') : []
  }
}

/** A save waits only for a check that says the key is wrong. */
export const blocksSave = (check: ProviderCheck) => !check.ok && check.reachable

export interface SignIn {
  sessionID: string
  userCode: string
  verificationURL?: string
  pollInterval: number
}

export function parseSignIn(answer: unknown): SignIn | null {
  const row = object(answer)
  const sessionID = text(row?.session_id)
  if (!row || !sessionID) return null
  const url = text(row.verification_url)
  return {
    sessionID,
    userCode: text(row.user_code) ?? '',
    verificationURL: url && /^https?:\/\//i.test(url) ? url : undefined,
    pollInterval: Math.max(1, typeof row.poll_interval === 'number' ? row.poll_interval : 5)
  }
}

export type SignInOutcome = { kind: 'pending' } | { kind: 'approved' } | { kind: 'failed'; message: string }

export function parseOutcome(answer: unknown): SignInOutcome {
  const row = object(answer) ?? {}
  switch (text(row.status) ?? 'pending') {
    case 'pending':
      return { kind: 'pending' }
    case 'approved':
      return { kind: 'approved' }
    case 'denied':
      return { kind: 'failed', message: t('The sign-in was declined.') }
    case 'expired':
      return { kind: 'failed', message: t('The code expired. Start again.') }
    case 'cancelled':
      return { kind: 'failed', message: t('The sign-in was cancelled.') }
    default:
      return { kind: 'failed', message: text(row.error_message) ?? t('The sign-in didn’t finish.') }
  }
}

/** A new endpoint's config key from its name, clear of every taken one. */
export function endpointID(name: string, taken: Set<string>): string {
  const words = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const base = words.length ? words.join('-') : 'endpoint'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** Endpoint key taken: the profile's endpoints, its providers and every catalog name. */
export function takenEndpointIDs(entries: ProviderEntry[], catalog: string[]): Set<string> {
  const taken = new Set<string>()
  for (const entry of entries) taken.add(entry.endpoint ? entry.endpoint.endpointID : entry.id.toLowerCase())
  for (const name of catalog) {
    const n = name.trim().toLowerCase()
    if (!n) continue
    taken.add(n)
    if (n.startsWith('custom:')) taken.add(n.slice(7))
  }
  return taken
}

// MARK: Writes

export type Requester = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number) => Promise<unknown>

/** Every path is named with its profile, the main one too: Hermes refuses an unnamed removal when it serves several. */
export const named = (path: string, profile: string) => `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
const component = (value: string) => encodeURIComponent(value)

export const isMissingRoute = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code
  return code === 404 || code === 405 || code === 410
}

export class ProviderService {
  constructor(
    private readonly request: Requester,
    readonly profile: string,
    /** Every profile on this Hermes, for clearing copies of a replaced shared key. */
    private readonly profiles: string[]
  ) {}

  get onMainProfile() {
    return this.profile === SHARED_PROFILE
  }

  private async optional(path: string | null): Promise<unknown> {
    if (!path) return undefined
    try {
      return await this.request('GET', path)
    } catch (e) {
      if (isMissingRoute(e)) return undefined
      throw e
    }
  }

  /** Hermes' answers, all or none: a dropped pool read never shows a shared key as missing. */
  async read(): Promise<ProviderEntry[]> {
    const main = this.onMainProfile
    const [env, accounts, endpoints, sharedPool, profilePool] = await Promise.all([
      this.request('GET', named('/api/env', this.profile)),
      this.optional(named('/api/providers/oauth', SHARED_PROFILE)),
      this.optional(named('/api/providers/custom-endpoints', this.profile)),
      this.optional(named('/api/credentials/pool', SHARED_PROFILE)),
      this.optional(main ? null : named('/api/credentials/pool', this.profile))
    ])
    return buildEntries({ env, accounts, endpoints, sharedPool, profilePool, onMainProfile: main })
  }

  async check(value: string, variable: string): Promise<ProviderCheck> {
    try {
      return parseCheck(await this.request('POST', '/api/providers/validate', { key: variable, value }))
    } catch (e) {
      return { ok: false, reachable: false, message: e instanceof Error ? e.message : String(e), models: [] }
    }
  }

  /**
   * Shares a key with every profile: a row in the main pool. The shared key
   * it replaces goes, with Hermes' copies of it in other profiles; on the
   * main profile its own `.env` key goes too, which Hermes would read ahead
   * of it; shared from another profile, that profile's own rows go, so it
   * uses it. False when the key saved but a cleanup failed.
   */
  async share(value: string, entry: ProviderEntry): Promise<boolean> {
    const key = value.trim()
    if (!key) return true
    const replaced = new Set(entry.key?.sharedRows.map(r => r.id) ?? [])
    const mainVars = this.onMainProfile && entry.key ? removableVars(entry.key) : []
    const ownHere = !this.onMainProfile && entry.key ? new Set(removableRows(entry.key).map(r => r.id)) : new Set<string>()
    await this.request('POST', named('/api/credentials/pool', SHARED_PROFILE), { provider: entry.id, api_key: key, label: SHARED_LABEL })
    return this.cleanUp(async () => {
      if (replaced.size) {
        await this.removeRows(entry.id, replaced, SHARED_PROFILE)
        await this.removeCopies(entry.id, replaced)
      }
      await this.removeVariables(mainVars)
      await this.removeRows(entry.id, ownHere, this.profile)
    })
  }

  /** Removes the shared key and Hermes' copies of it. */
  async unshare(entry: ProviderEntry): Promise<void> {
    const ids = new Set(entry.key?.sharedRows.map(r => r.id) ?? [])
    if (!ids.size) return
    await this.removeRows(entry.id, ids, SHARED_PROFILE)
    await this.removeCopies(entry.id, ids)
  }

  /** A key only this profile uses: the shared copies and its older rows and `.env` key go. */
  async override(value: string, entry: ProviderEntry): Promise<boolean> {
    const key = value.trim()
    if (!key || this.onMainProfile) return true
    const stale = new Set([...(entry.key?.sharedRows.map(r => r.id) ?? []), ...(entry.key ? removableRows(entry.key).map(r => r.id) : [])])
    const staleVars = entry.key ? removableVars(entry.key) : []
    await this.request('POST', named('/api/credentials/pool', this.profile), { provider: entry.id, api_key: key, label: PROFILE_LABEL })
    return this.cleanUp(async () => {
      await this.removeRows(entry.id, stale, this.profile)
      await this.removeVariables(staleVars)
    })
  }

  /** Back on the shared key: this profile's own rows and `.env` key go. */
  async useShared(entry: ProviderEntry): Promise<void> {
    if (this.onMainProfile || !entry.key) return
    await this.removeRows(entry.id, new Set(removableRows(entry.key).map(r => r.id)), this.profile)
    await this.removeVariables(removableVars(entry.key))
  }

  /** Takes variables out of this profile's `.env`; one already gone is fine. */
  async removeVariables(variables: string[]): Promise<void> {
    let failure: unknown
    for (const variable of variables) {
      try {
        await this.request('DELETE', named('/api/env', this.profile), { key: variable, profile: this.profile })
      } catch (e) {
        if (!isMissingRoute(e)) failure ??= e
      }
    }
    if (failure) throw failure
  }

  /** One of the provider's settings (a base URL override, a region) in this profile's `.env`. */
  async saveSetting(variable: string, value: string): Promise<void> {
    const v = value.trim()
    if (!v || !variable) return
    await this.request('PUT', named('/api/env', this.profile), { key: variable, value: v, profile: this.profile, provider_setup: true })
  }

  private async cleanUp(rest: () => Promise<void>): Promise<boolean> {
    try {
      await rest()
      return true
    } catch {
      return false
    }
  }

  /** Removal names a row by its place, which shifts: read the places again and remove from the last up. */
  private async removeRows(provider: string, ids: Set<string>, profile: string): Promise<void> {
    if (!ids.size) return
    const pool = await this.request('GET', named('/api/credentials/pool', profile))
    const indices = (poolRows(pool).get(provider) ?? []).filter(row => ids.has(row.id)).map(row => row.index)
    for (const index of indices.sort((a, b) => b - a)) {
      await this.request('DELETE', named(`/api/credentials/pool/${component(provider)}/${index}`, profile))
    }
  }

  private async removeCopies(provider: string, ids: Set<string>): Promise<void> {
    let failure: unknown
    for (const name of this.profiles) {
      if (name === SHARED_PROFILE) continue
      try {
        await this.removeRows(provider, ids, name)
      } catch (e) {
        failure ??= e
      }
    }
    if (failure) throw failure
  }

  async startSignIn(providerID: string): Promise<SignIn> {
    const signIn = parseSignIn(await this.request('POST', named(`/api/providers/oauth/${component(providerID)}/start`, SHARED_PROFILE), {}))
    if (!signIn) throw new Error(t('Hermes gave an answer Conduit didn’t expect. Update Hermes and try again.'))
    return signIn
  }

  /** Waits up to about 20 seconds for the sign-in to end. */
  async poll(providerID: string, signIn: SignIn): Promise<SignInOutcome> {
    const path = named(`/api/providers/oauth/${component(providerID)}/poll/${component(signIn.sessionID)}?wait=20`, SHARED_PROFILE)
    return parseOutcome(await this.request('GET', path, undefined, 30_000))
  }

  async cancel(signIn: SignIn): Promise<void> {
    await this.request('DELETE', named(`/api/providers/oauth/sessions/${component(signIn.sessionID)}`, SHARED_PROFILE)).catch(() => undefined)
  }

  async signOut(providerID: string): Promise<void> {
    await this.request('DELETE', named(`/api/providers/oauth/${component(providerID)}`, SHARED_PROFILE))
  }

  async checkEndpoint(body: EndpointDraft): Promise<ProviderCheck> {
    try {
      return parseCheck(await this.request('POST', '/api/providers/custom-endpoints/validate', endpointBody(body, true), 30_000))
    } catch (e) {
      return { ok: false, reachable: false, message: e instanceof Error ? e.message : String(e), models: [] }
    }
  }

  async saveEndpoint(draft: EndpointDraft): Promise<void> {
    await this.request('POST', named('/api/providers/custom-endpoints', this.profile), endpointBody(draft, false), 30_000)
  }

  async removeEndpoint(id: string): Promise<void> {
    await this.request('DELETE', named(`/api/providers/custom-endpoints/${component(id)}`, this.profile))
  }
}

export interface EndpointDraft {
  endpointID: string
  name: string
  baseURL: string
  model: string
  models: string[]
  /** Nothing typed leaves a saved key as it is. */
  key?: string
  makeDefault: boolean
}

export function endpointBody(draft: EndpointDraft, forCheck: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: draft.endpointID,
    name: draft.name.trim(),
    base_url: draft.baseURL.trim(),
    model: draft.model,
    api_mode: '',
    discover_models: true
  }
  const key = draft.key?.trim()
  if (key) body.api_key = key
  if (!forCheck) {
    body.make_default = draft.makeDefault
    if (draft.models.length) body.models = draft.models
  }
  return body
}

// MARK: Key order

/** How Hermes picks among a provider's keys on a profile (`credential_pool_strategies.<provider>`). */
export const KEY_ORDERS = ['fill_first', 'round_robin', 'random', 'least_used'] as const
export type KeyOrder = (typeof KEY_ORDERS)[number]

/** The config key for `provider`, null for an id a dotted key can't name (`custom:together.ai`). */
export const keyOrderKey = (provider: string) => (!provider || provider.includes('.') ? null : `credential_pool_strategies.${provider}`)

/** Hermes' reading of a stored value: anything else is its default, the first key until it runs out. */
export function keyOrderFrom(stored: unknown): KeyOrder {
  const value = typeof stored === 'string' ? stored.trim().toLowerCase() : ''
  return (KEY_ORDERS as readonly string[]).includes(value) ? (value as KeyOrder) : 'fill_first'
}

/** The Key order section shows once a profile has more than one key or sign-in for the provider. */
export const showsKeyOrder = (entry: ProviderEntry) => (entry.key?.keysInUse ?? 0) > 1 && keyOrderKey(entry.id) !== null

export const isBaseURL = (variable: string) => variable.endsWith('_BASE_URL')
