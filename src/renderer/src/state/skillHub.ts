/**
 * Settings > Capabilities > Skills > Skill Hub, after the phone's: the Hermes
 * Index's featured skills (/api/skills/hub/sources), a search across the
 * profile's sources (/search), and a skill's page with Hermes' install-time
 * security scan (/scan), its SKILL.md (/preview) and Install (/install). A hub
 * skill comes off from its page (/uninstall). Install and Remove run as
 * Hermes actions, followed to their end in the action's log.
 */
import { t } from '../../../shared/i18n'
import { prettyCategory } from './capabilities'
import { latestLine, parseActionStatus, type ActionStatus } from './hostActions'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === 'object') : [])

export interface HubSkill {
  name: string
  description: string
  source: string
  identifier: string
  /** builtin, trusted or community. */
  trust: string
  repo: string
  tags: string[]
}

export function parseHubSkill(r: Row): HubSkill | null {
  const identifier = str(r.identifier)
  if (!identifier) return null
  return {
    name: str(r.name) || identifier.split('/').pop() || identifier,
    description: str(r.description),
    source: str(r.source),
    identifier,
    trust: str(r.trust_level) || 'community',
    repo: str(r.repo),
    tags: (Array.isArray(r.tags) ? r.tags : []).filter((x): x is string => typeof x === 'string')
  }
}

const skills = (v: unknown) => {
  const seen = new Set<string>()
  return rows(v)
    .map(parseHubSkill)
    .filter((s): s is HubSkill => !!s && !seen.has(s.identifier) && !!seen.add(s.identifier))
}

/** The official catalog's skills, with their category and whether this profile has them. */
export interface OfficialSkill extends HubSkill {
  category: string
  installed: boolean
}

export function parseOfficial(raw: unknown): OfficialSkill[] {
  const seen = new Set<string>()
  return rows((raw as Row | null)?.skills)
    .map(r => {
      const skill = parseHubSkill(r)
      return skill ? { ...skill, category: str(r.category) || 'general', installed: r.installed === true } : null
    })
    .filter((s): s is OfficialSkill => !!s && !seen.has(s.identifier) && !!seen.add(s.identifier))
}

/** Grouped by category, A-Z by the category's shown name, each A-Z (Eric, 2026-11-08). */
export function officialGroups(skills: OfficialSkill[]): { category: string; title: string; skills: OfficialSkill[] }[] {
  const groups = new Map<string, OfficialSkill[]>()
  for (const skill of skills) groups.set(skill.category, [...(groups.get(skill.category) ?? []), skill])
  return [...groups.entries()]
    .map(([category, list]) => ({ category, title: prettyCategory(category), skills: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Installed hub skills: identifier to the name Hermes keeps them under. */
export function parseInstalled(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [identifier, entry] of Object.entries(v as Row)) {
    const name = entry && typeof entry === 'object' ? str((entry as Row).name) : ''
    out[identifier] = name || identifier.split('/').pop() || identifier
  }
  return out
}

export interface HubSnapshot {
  featured: HubSkill[]
  sources: { id: string; label: string }[]
  installed: Record<string, string>
  indexAvailable: boolean
}

export function parseSources(raw: unknown): HubSnapshot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  return {
    featured: skills(o.featured),
    sources: rows(o.sources)
      .filter(r => r.searchable !== false)
      .map(r => ({ id: str(r.id), label: str(r.label) || str(r.id) }))
      .filter(s => s.id),
    installed: parseInstalled(o.installed),
    indexAvailable: o.index_available === true
  }
}

export interface HubResults {
  results: HubSkill[]
  installed: Record<string, string>
  /** Sources that didn't answer in time. */
  timedOut: string[]
}

export function parseResults(raw: unknown): HubResults {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  return {
    results: skills(o.results),
    installed: parseInstalled(o.installed),
    timedOut: (Array.isArray(o.timed_out) ? o.timed_out : []).map(String)
  }
}

export interface ScanFinding {
  severity: string
  category: string
  file: string
  line?: number
  description: string
}

export interface HubScan {
  /** What Hermes would do: install, ask first, or refuse. */
  policy: 'allow' | 'ask' | 'block'
  reason: string
  summary: string
  findings: ScanFinding[]
}

const SEVERITY = ['critical', 'high', 'medium', 'low']

export function parseScan(raw: unknown): HubScan {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  const policy = o.policy === 'allow' || o.policy === 'ask' ? o.policy : 'block'
  const rank = (s: string) => (SEVERITY.includes(s) ? SEVERITY.indexOf(s) : SEVERITY.length)
  return {
    policy,
    reason: str(o.policy_reason),
    summary: str(o.summary),
    findings: rows(o.findings)
      .map(f => ({
        severity: str(f.severity).toLowerCase(),
        category: str(f.category),
        file: str(f.file),
        line: typeof f.line === 'number' ? f.line : undefined,
        description: str(f.description)
      }))
      .sort((a, b) => rank(a.severity) - rank(b.severity))
  }
}

export function policyTitle(policy: HubScan['policy']): string {
  if (policy === 'allow') return t('No problems found')
  if (policy === 'ask') return t('Worth a look before you install it')
  return t("Hermes won't install this skill")
}

export function trustLabel(trust: string): string {
  if (trust === 'builtin') return t('Official')
  if (trust === 'trusted') return t('Trusted')
  return t('Community')
}

/** A source page opens only as a web address; owner/name alone reads as GitHub. */
export function repoURL(repo: string): string | null {
  if (/^https?:\/\//i.test(repo)) return repo
  if (/^[\w.-]+\/[\w.-]+$/.test(repo)) return `https://github.com/${repo}`
  return null
}

/** Follows a Hermes action until it ends: its status, or a timeout. */
export async function waitForAction(
  request: (path: string) => Promise<unknown>,
  name: string,
  opts: { pollMs?: number; limitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; live?: () => boolean } = {}
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const sleep = opts.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const now = opts.now ?? (() => Date.now())
  const deadline = now() + (opts.limitMs ?? 900_000)
  let failures = 0
  for (;;) {
    await sleep(opts.pollMs ?? 1500)
    if (opts.live && !opts.live()) return { ok: false, reason: '' }
    let status: ActionStatus | null = null
    try {
      status = parseActionStatus(await request(`/api/actions/${encodeURIComponent(name)}/status?lines=200`))
      failures = 0
    } catch (e) {
      if (++failures >= 4) return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
    if (status && !status.running) {
      return status.exitCode === 0 ? { ok: true } : { ok: false, reason: latestLine(status) ?? t("The install didn't finish.") }
    }
    if (now() > deadline) return { ok: false, reason: t('Hermes is still working on it. Check again in a moment.') }
  }
}
