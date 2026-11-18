/**
 * Settings > Capabilities, after the phone's: the profile's installed skills
 * (/api/skills), its toolsets (/api/tools/toolsets) and its MCP servers
 * (/api/mcp/servers), each with its switch, and a server's test. Changes
 * apply to new sessions.
 */
import { t } from '../../../shared/i18n'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object') : [])

export type CapabilityTab = 'skills' | 'tools' | 'connectors' | 'plugins'

/** The route for a profile: the default profile is the dashboard's own. */
export function scoped(path: string, profile: string): string {
  if (!profile || profile === 'default') return path
  return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
}

export interface Skill {
  name: string
  description: string
  category: string
  enabled: boolean
  /** hub, bundled, external or agent (learned). */
  provenance: string
  usage: number
}

export function parseSkills(raw: unknown): Skill[] {
  const list = Array.isArray(raw) ? raw : rows((raw as Row | null)?.skills)
  const seen = new Set<string>()
  return rows(list)
    .map(r => ({
      name: str(r.name),
      description: str(r.description),
      category: str(r.category),
      enabled: r.enabled !== false,
      provenance: str(r.provenance),
      usage: typeof r.usage === 'number' && Number.isFinite(r.usage) ? r.usage : 0
    }))
    .filter(s => s.name && !seen.has(s.name) && seen.add(s.name))
}

export interface Toolset {
  name: string
  label: string
  description: string
  enabled: boolean
  /** Has the keys it needs. */
  configured: boolean
  tools: string[]
}

export function parseToolsets(raw: unknown): Toolset[] {
  const list = Array.isArray(raw) ? raw : rows((raw as Row | null)?.toolsets)
  return rows(list)
    .map(r => ({
      name: str(r.name),
      label: str(r.label) || str(r.name),
      description: str(r.description),
      enabled: r.enabled === true,
      configured: r.configured !== false,
      tools: (Array.isArray(r.tools) ? r.tools : []).filter((x): x is string => typeof x === 'string')
    }))
    .filter(s => s.name)
}

export interface Server {
  name: string
  transport: string
  /** The address, or the command and its arguments. */
  runs: string
  auth: string
  enabled: boolean
  /** The plugin that provides it, which owns its switch. */
  plugin: string
}

export function parseServers(raw: unknown): Server[] {
  return rows((raw as Row | null)?.servers)
    .map(r => {
      const args = (Array.isArray(r.args) ? r.args : []).map(a => String(a))
      return {
        name: str(r.name),
        transport: str(r.transport),
        runs: str(r.url) || [str(r.command), ...args].filter(Boolean).join(' '),
        auth: str(r.auth),
        enabled: r.enabled !== false,
        plugin: r.source === 'plugin' ? str(r.plugin) || t('Plugin') : ''
      }
    })
    .filter(s => s.name)
}

export type ServerTest = { kind: 'testing' } | { kind: 'ok'; tools: { name: string; description: string }[] } | { kind: 'failed'; error: string }

export function parseTest(raw: unknown): ServerTest {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  if (o.ok === true)
    return {
      kind: 'ok',
      tools: rows(o.tools)
        .map(r => ({ name: str(r.name), description: str(r.description) }))
        .filter(x => x.name)
    }
  return { kind: 'failed', error: str(o.error) || t('Error') }
}

/** A category's shown name: "mlops/training" reads "MLOps / Training"; AI, MCP and the like in capitals. */
export function prettyCategory(category: string): string {
  if (!category) return t('Other')
  const caps = new Set(['ai', 'mcp', 'api', 'ml', 'llm', 'ui', 'ux', 'cli', 'pdf', 'sql', 'aws', 'gcp', 'ios', 'seo'])
  return category
    .split('/')
    .map(part =>
      part
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map(word => (caps.has(word.toLowerCase()) ? word.toUpperCase() : word === 'mlops' ? 'MLOps' : word.charAt(0).toUpperCase() + word.slice(1)))
        .join(' ')
    )
    .join(' / ')
}

/** Skills by category, A-Z by the shown name, each A-Z. */
export function skillGroups(skills: Skill[]): { category: string; title: string; skills: Skill[] }[] {
  const groups = new Map<string, Skill[]>()
  for (const skill of skills) groups.set(skill.category, [...(groups.get(skill.category) ?? []), skill])
  return [...groups.entries()]
    .map(([category, list]) => ({ category, title: prettyCategory(category), skills: list.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

const matches = (query: string, ...texts: string[]) => {
  const q = query.trim().toLowerCase()
  return !q || texts.some(text => text.toLowerCase().includes(q))
}

export const filterSkills = (skills: Skill[], query: string) => skills.filter(s => matches(query, s.name, s.description, s.category))
export const filterToolsets = (toolsets: Toolset[], query: string) => toolsets.filter(s => matches(query, s.name, s.label, s.description, ...s.tools))
export const filterServers = (servers: Server[], query: string) => servers.filter(s => matches(query, s.name, s.runs))

export function provenanceLabel(provenance: string): string | null {
  switch (provenance) {
    case 'hub':
      return t('Hub')
    case 'agent':
      return t('Learned')
    default:
      return null
  }
}

/** A switch flipped on a list: the list with that row's new state. */
export function flipped<T extends { name: string; enabled: boolean }>(list: T[], name: string, enabled: boolean): T[] {
  return list.map(item => (item.name === name ? { ...item, enabled } : item))
}
