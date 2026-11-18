/**
 * Settings > Capabilities > Plugins, after the phone's (CapabilitiesStore's
 * plugins, AgentPluginRow, PluginCatalogEntry): the agent plugins Hermes has,
 * from `/api/dashboard/plugins/hub`, and its curated catalog, from
 * `/api/dashboard/plugins/catalog`. Hermes' plugin routes act on the
 * dashboard's own (default) profile, so other profiles only read.
 */
export const HUB_PATH = '/api/dashboard/plugins/hub'
export const CATALOG_PATH = '/api/dashboard/plugins/catalog'
export const INSTALL_PATH = '/api/dashboard/agent-plugins/install'

export interface InstalledPlugin {
  name: string
  version?: string
  description: string
  /** bundled, user, git, project or entrypoint. */
  source: string
  /** enabled, disabled or inactive. */
  status: string
  canRemove: boolean
  canUpdate: boolean
  /** The folder name Hermes' update and remove routes look it up by. */
  folder: string
  authCommand?: string
}

export type Tier = 'official' | 'verified' | 'community'

export interface CatalogPlugin {
  name: string
  title: string
  description: string
  tier: Tier
  installed: boolean
  updateAvailable: boolean
  maintainer: string
  category: string
  version: string
  repo?: string
  docs?: string
  image?: string
  screenshots: string[]
  tools: string[]
  hooks: string[]
  middleware: string[]
  requiresEnv: string[]
  knownIssues: string[]
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s) : [])

/** Hermes Desktop's filter: bundled plugins stay out but the two a person turns on, and provider plumbing stays out. */
const LISTED_BUNDLED = new Set(['disk-cleanup', 'security-guidance'])
const HIDDEN_PREFIXES = ['dashboard_auth/', 'model-providers/', 'platforms/']

export function parseInstalled(response: unknown): InstalledPlugin[] {
  const list = ((response ?? {}) as Row).plugins
  if (!Array.isArray(list)) throw new Error('plugins')
  return list
    .flatMap((raw): InstalledPlugin[] => {
      const r = (raw ?? {}) as Row
      const name = str(r.name)
      if (!name) return []
      const source = str(r.source)
      if (HIDDEN_PREFIXES.some(p => name.startsWith(p)) || (source === 'bundled' && !LISTED_BUNDLED.has(name))) return []
      const canRemove = r.can_remove === true
      const path = str(r.path)
      return [
        {
          name,
          version: str(r.version) || undefined,
          description: str(r.description),
          source,
          status: str(r.runtime_status) || 'inactive',
          canRemove,
          canUpdate: canRemove || r.can_update_git === true,
          folder: path.split('/').filter(Boolean).pop() ?? name,
          authCommand: r.auth_required === true ? str(r.auth_command) || undefined : undefined
        }
      ]
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function web(text: string): string | undefined {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/** A picture on GitHub's hosts over https, as Hermes' catalog check allows; else none. */
export function catalogImage(text: string): string | undefined {
  try {
    const url = new URL(text.trim())
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:') return undefined
    return host === 'raw.githubusercontent.com' || host === 'github.com' || host.endsWith('.githubusercontent.com') ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export const tierOf = (tier: unknown): Tier => (tier === 'official' || tier === 'bundled' ? 'official' : tier === 'verified' ? 'verified' : 'community')

export function parseCatalog(response: unknown): CatalogPlugin[] {
  const list = ((response ?? {}) as Row).entries
  if (!Array.isArray(list)) throw new Error('catalog')
  return list.flatMap((raw): CatalogPlugin[] => {
    const r = (raw ?? {}) as Row
    const name = str(r.name)
    if (!name) return []
    const caps = (r.capabilities ?? {}) as Row
    return [
      {
        name,
        title: str(r.title).trim() || name,
        description: str(r.description),
        tier: tierOf(r.tier),
        installed: r.installed === true,
        updateAvailable: r.update_available === true,
        maintainer: str(r.maintainer),
        category: str(r.category),
        version: str(r.version),
        repo: web(str(r.repo)),
        docs: web(str(r.docs_url)),
        image: catalogImage(str(r.image)),
        screenshots: strings(r.screenshots).flatMap(s => catalogImage(s) ?? []),
        tools: strings(caps.provides_tools),
        hooks: strings(caps.provides_hooks),
        middleware: strings(caps.provides_middleware),
        requiresEnv: strings(caps.requires_env),
        knownIssues: strings(r.known_issues)
      }
    ]
  })
}

const has = (query: string, ...values: string[]) => {
  const q = query.trim().toLowerCase()
  return !q || values.some(v => v.toLowerCase().includes(q))
}

export const filterInstalled = (plugins: InstalledPlugin[], query: string) => plugins.filter(p => has(query, p.name, p.description))

const RANK: Record<Tier, number> = { official: 0, verified: 1, community: 2 }

/** Not installed yet, official first, then verified, then A-Z. */
export const filterCatalog = (catalog: CatalogPlugin[], query: string) =>
  catalog
    .filter(p => !p.installed && has(query, p.title, p.name, p.description))
    .sort((a, b) => RANK[a.tier] - RANK[b.tier] || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))

/** The catalog entry an installed plugin came from, by name or folder. */
export const sourceEntry = (plugin: InstalledPlugin, catalog: CatalogPlugin[]) =>
  catalog.find(e => e.installed && (e.name === plugin.name || e.name === plugin.folder))

/** A plugin's route: each part of its name encoded on its own. */
export const pluginPath = (name: string) => `/api/dashboard/agent-plugins/${name.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`

export const installBody = (entry: CatalogPlugin) => ({ identifier: '', catalog_name: entry.name, enable: true })

export interface InstallOutcome {
  name: string
  missingEnv: string[]
  restart: boolean
}

export function parseInstall(response: unknown, entry: CatalogPlugin): InstallOutcome {
  const r = (response ?? {}) as Row
  const missing = Array.isArray(r.missing_env) ? r.missing_env.flatMap(v => (typeof v === 'string' ? v : str((v as Row | null)?.name)) || []) : []
  return { name: str(r.plugin_name) || entry.title, missingEnv: missing, restart: r.restart_required === true }
}

export type UpdateOutcome = { kind: 'consent'; lines: string[] } | { kind: 'upToDate' } | { kind: 'updated'; restart: boolean }

export function parseUpdate(response: unknown): UpdateOutcome {
  const r = (response ?? {}) as Row
  if (r.consent_required === true) {
    const lines = strings(r.delta_lines)
    return { kind: 'consent', lines: lines.length ? lines : strings([r.error]) }
  }
  if (r.unchanged === true) return { kind: 'upToDate' }
  return { kind: 'updated', restart: r.restart_required !== false }
}
