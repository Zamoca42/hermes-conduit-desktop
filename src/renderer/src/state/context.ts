/**
 * The open chat's context window and usage, after the phone's Context
 * sheet: how full the window is (Hermes' `usage` on `session.usage` ticks,
 * `message.complete` and the `session.usage` call), what fills it
 * (`session.context_breakdown`), and the chat's tokens and cost from the
 * Conduit plugin's `/sessions/usage` (plugin 0.177.34+).
 */

export interface ContextWindow {
  used: number
  max: number
  /** 0 to 100. */
  percent: number
}

const int = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)

/** Hermes has sent the percent both as 0…1 and as 0…100; the counts win when they're there. */
export function normalizedPercent(percent: number, used: number, max: number): number {
  if (max > 0 && used > 0) return Math.min(100, (used / max) * 100)
  const value = percent > 0 && percent <= 1 ? percent * 100 : percent
  return Math.min(100, Math.max(0, value))
}

/** A usage object's window, or null when the window is unknown (no reading, not an empty one). */
export function contextFromUsage(raw: unknown): ContextWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const usage = raw as Record<string, unknown>
  const max = int(usage.context_max)
  if (!max) return null
  const used = int(usage.context_used)
  const percent = typeof usage.context_percent === 'number' ? usage.context_percent : 0
  return { used, max, percent: normalizedPercent(percent, used, max) }
}

export interface BreakdownCategory {
  id: string
  label: string
  tokens: number
  color: string
}

export interface ContextBreakdown {
  categories: BreakdownCategory[]
  window: ContextWindow | null
}

/** The bar's colors when Hermes' own don't tell the categories apart. */
export const PALETTE = ['#e0ab47', '#6194fa', '#2dd4bf', '#f472b6', '#60a5fa', '#34d399', '#fb923c', '#a78bfa']
const NAMED: Record<string, string> = {
  blue: '#60a5fa',
  green: '#34d399',
  orange: '#fb923c',
  red: '#f87171',
  purple: '#a78bfa',
  pink: '#f472b6',
  cyan: '#22d3ee',
  amber: '#e0ab47',
  yellow: '#e0ab47'
}

export function parseBreakdown(raw: unknown): ContextBreakdown {
  const object = (raw ?? {}) as Record<string, unknown>
  const rows = (Array.isArray(object.categories) ? object.categories : []).flatMap(value => {
    const row = (value ?? {}) as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.label !== 'string') return []
    return [{ id: row.id, label: row.label, tokens: int(row.tokens), name: typeof row.color === 'string' ? row.color.toLowerCase() : 'amber' }]
  })
  // Hermes' colors only when each is one Conduit knows and no two share one; else the palette in turn.
  const useNamed = rows.every(row => NAMED[row.name]) && new Set(rows.map(row => row.name)).size === rows.length
  const categories = rows.map((row, index) => ({ id: row.id, label: row.label, tokens: row.tokens, color: (useNamed ? NAMED[row.name] : undefined) ?? PALETTE[index % PALETTE.length]! }))
  const max = int(object.context_max)
  const used = int(object.context_used) || int(object.estimated_total) || categories.reduce((sum, c) => sum + c.tokens, 0)
  const percent = typeof object.context_percent === 'number' ? object.context_percent : 0
  return { categories, window: max ? { used, max, percent: normalizedPercent(percent, used, max) } : null }
}

export type CostStatus = 'actual' | 'estimated' | 'included' | 'partial' | 'unknown'

export interface SessionUsage {
  input: number
  output: number
  cacheRead: number
  apiCalls: number
  compressions: number
  subagentRuns: number
  /** Null when no call was priced: never shown as $0. */
  costUSD: number | null
  costStatus: CostStatus
}

export const SESSION_USAGE_PATH = '/api/plugins/conduit_push/sessions/usage'

export function sessionUsagePath(sessionId: string, profile?: string | null): string {
  const base = `${SESSION_USAGE_PATH}?session_id=${encodeURIComponent(sessionId)}`
  return profile && profile !== 'default' ? `${base}&profile=${encodeURIComponent(profile)}` : base
}

export function parseSessionUsage(raw: unknown): SessionUsage {
  const object = (raw ?? {}) as Record<string, unknown>
  const status = (['actual', 'estimated', 'included', 'partial', 'unknown'] as const).find(s => s === object.cost_status) ?? 'unknown'
  const cost = typeof object.cost_usd === 'number' && Number.isFinite(object.cost_usd) && status !== 'unknown' ? object.cost_usd : null
  return {
    input: int(object.input_tokens),
    output: int(object.output_tokens),
    cacheRead: int(object.cache_read_tokens),
    apiCalls: int(object.api_call_count),
    compressions: int(object.compressions),
    subagentRuns: int(object.subagent_runs),
    costUSD: cost,
    costStatus: status
  }
}

/** "$0.42", with more digits for a cost under a cent. */
export function money(value: number, locale?: string): string {
  const digits = value > 0 && value < 0.01 ? 4 : 2
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}
