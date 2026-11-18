/**
 * Settings > Usage, after the phone's: what a profile spent over 7, 30 or
 * 90 days, read from the dashboard's analytics routes (/api/analytics/usage
 * for the totals and days, /api/analytics/models for the per-model rows),
 * and each signed-in provider's subscription quota from model.options.
 * Hermes keeps all of it; Conduit only reads it, on open and on refresh.
 */
import { t } from '../../../shared/i18n'

export const PERIODS = [7, 30, 90] as const

export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  reasoning: number
  estimatedCost: number
  actualCost: number
  sessions: number
  apiCalls: number
}

export interface UsageDay {
  /** The host's calendar day, "2026-11-18". */
  day: string
  usage: UsageTokens
}

export interface ModelUsage {
  model: string
  /** Empty when Hermes didn't record one. */
  provider: string
  usage: UsageTokens
}

export interface UsageReport {
  days: number
  totals: UsageTokens
  daily: UsageDay[]
  models: ModelUsage[]
}

type Row = Record<string, unknown>

/** The most one count holds, so adding three can't lose precision. */
const COUNT_CAP = Math.floor(Number.MAX_SAFE_INTEGER / 4)

export function count(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(Math.max(0, Math.floor(n)), COUNT_CAP) : 0
}

export function amount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((v): v is Row => !!v && typeof v === 'object') : [])

/** One `daily`, `by_model` or `models` row: the same column names on both routes. */
export function tokensFromRow(row: Row): UsageTokens {
  return {
    input: count(row.input_tokens),
    output: count(row.output_tokens),
    cacheRead: count(row.cache_read_tokens),
    reasoning: count(row.reasoning_tokens),
    estimatedCost: amount(row.estimated_cost),
    actualCost: amount(row.actual_cost),
    sessions: count(row.sessions),
    apiCalls: count(row.api_calls)
  }
}

/** The `totals` object, whose columns carry a `total_` prefix. */
export function tokensFromTotals(row: Row): UsageTokens {
  return {
    input: count(row.total_input),
    output: count(row.total_output),
    cacheRead: count(row.total_cache_read),
    reasoning: count(row.total_reasoning),
    estimatedCost: amount(row.total_estimated_cost),
    actualCost: amount(row.total_actual_cost),
    sessions: count(row.total_sessions),
    apiCalls: count(row.total_api_calls)
  }
}

/** Input and output; reasoning is inside output already. */
export const totalTokens = (u: UsageTokens) => u.input + u.output
/** Every token the period counted: input, output and cache reads. */
export const allTokens = (u: UsageTokens) => u.input + u.output + u.cacheRead
/** What the provider billed when Hermes knows it, else Hermes' estimate. Hermes sums a missing bill as 0. */
export const tokensCost = (u: UsageTokens) => (u.actualCost > 0 ? u.actualCost : u.estimatedCost)
export const costIsEstimate = (u: UsageTokens) => u.actualCost <= 0

/**
 * `usage` is /api/analytics/usage's answer; `models`, when the host has
 * that route, is /api/analytics/models'. Its rows split a chat that
 * switched models between them, so they're preferred over the usage
 * route's `by_model`, which credits a chat to its last model.
 */
export function parseUsage(usage: unknown, models: unknown, days: number): UsageReport {
  const u = (usage && typeof usage === 'object' ? usage : {}) as Row
  const m = (models && typeof models === 'object' ? models : null) as Row | null
  const totals = u.totals && typeof u.totals === 'object' ? tokensFromTotals(u.totals as Row) : tokensFromTotals({})
  const seenDays = new Set<string>()
  const daily = rows(u.daily)
    .filter(row => typeof row.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.day) && !seenDays.has(row.day) && !!seenDays.add(row.day))
    .map(row => ({ day: row.day as string, usage: tokensFromRow(row) }))
    .sort((a, b) => a.day.localeCompare(b.day))
  const modelRows = m && Array.isArray(m.models) ? rows(m.models) : rows(u.by_model)
  const seen = new Set<string>()
  const perModel: ModelUsage[] = []
  for (const row of modelRows) {
    const model = typeof row.model === 'string' ? row.model.trim() : ''
    if (!model) continue
    const provider = (typeof row.provider === 'string' ? row.provider : typeof row.billing_provider === 'string' ? row.billing_provider : '').trim()
    const key = `${provider}/${model}`
    if (seen.has(key)) continue
    seen.add(key)
    perModel.push({ model, provider, usage: tokensFromRow(row) })
  }
  perModel.sort((a, b) => totalTokens(b.usage) - totalTokens(a.usage))
  const period = count(u.period_days)
  return { days: period > 0 ? period : days, totals, daily, models: perModel }
}

/**
 * The period's cost. With per-model rows, their sum: Hermes' billed total
 * covers only the models a provider billed, so a period that mixes billed
 * and estimated models must not show it as the whole.
 */
export function reportCost(report: UsageReport): number {
  return report.models.length ? report.models.reduce((sum, entry) => sum + tokensCost(entry.usage), 0) : tokensCost(report.totals)
}

/** True when any of that cost is Hermes' estimate. */
export function reportCostIsEstimate(report: UsageReport): boolean {
  if (!report.models.length) return costIsEstimate(report.totals)
  return report.models.every(entry => costIsEstimate(entry.usage)) || report.models.some(entry => costIsEstimate(entry.usage) && tokensCost(entry.usage) > 0)
}

/**
 * A bar for every day of the period, ending today or on the report's last
 * day if that's later (the host's clock may run ahead), so one busy day
 * reads as one day rather than the whole chart.
 */
export function periodDays(report: UsageReport, now = new Date()): UsageDay[] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const byDay = new Map(report.daily.map(day => [day.day, day]))
  const today = key(now)
  const lastDay = report.daily.length ? report.daily[report.daily.length - 1]!.day : today
  const [y, m, d] = (lastDay > today ? lastDay : today).split('-').map(Number) as [number, number, number]
  const out: UsageDay[] = []
  for (let i = report.days - 1; i >= 0; i--) {
    const day = key(new Date(y, m - 1, d - i))
    out.push(byDay.get(day) ?? { day, usage: tokensFromRow({}) })
  }
  return out
}

export const isEmptyReport = (report: UsageReport) => report.totals.sessions === 0 && allTokens(report.totals) === 0

// Provider quota

export interface QuotaWindow {
  /** Hermes' own name for the window ("Session", "Weekly"). */
  label: string
  /** 0 through 100. */
  usedPercent: number
  resetsAt?: number
  modelScoped: boolean
}

export type AccountState = 'ready' | 'limited' | 'unknown' | 'unavailable'

export interface QuotaAccount {
  id: string
  label: string
  windows: QuotaWindow[]
  state: AccountState
  resetsAt?: number
}

export type RateLimit = { scope: 'account'; resetsAt?: number } | { scope: 'models'; models: { model: string; resetsAt?: number }[] }

export interface ProviderQuota {
  slug: string
  title: string
  windows: QuotaWindow[]
  accounts: QuotaAccount[]
  limit: RateLimit | null
}

export const windowFraction = (w: QuotaWindow) => Math.min(Math.max(w.usedPercent / 100, 0), 1)

function date(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

function windows(value: unknown): QuotaWindow[] {
  const seen = new Set<string>()
  const out: QuotaWindow[] = []
  for (const row of rows(value)) {
    const label = typeof row.label === 'string' ? row.label.trim() : ''
    if (!label || seen.has(label) || typeof row.used_percent !== 'number' || !Number.isFinite(row.used_percent)) continue
    seen.add(label)
    out.push({ label, usedPercent: row.used_percent, resetsAt: date(row.resets_at), modelScoped: row.scope === 'model' })
  }
  return out
}

function limit(value: unknown): RateLimit | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Row
  if (o.scope === 'account') return { scope: 'account', resetsAt: date(o.resets_at) }
  if (o.scope === 'models' && o.models && typeof o.models === 'object') {
    const models = Object.entries(o.models as Row)
      .map(([model, at]) => ({ model, resetsAt: date(at) }))
      .sort((a, b) => a.model.localeCompare(b.model))
    return models.length ? { scope: 'models', models } : null
  }
  return null
}

const STATES: AccountState[] = ['ready', 'limited', 'unknown', 'unavailable']

/** One model.options provider row's quota, or null when it reports none. */
export function quotaFromRow(row: Row): ProviderQuota | null {
  const slugValue = [row.slug, row.id, row.name].find(v => typeof v === 'string' && v.trim()) as string | undefined
  const slug = slugValue?.trim()
  if (!slug) return null
  const usage = (row.usage && typeof row.usage === 'object' ? row.usage : {}) as Row
  const ids = new Set<string>()
  const accounts = rows(usage.accounts).map((account, index): QuotaAccount => {
    const given = typeof account.id === 'string' && account.id ? account.id : ''
    let id = given && !ids.has(given) ? given : `account-${index}`
    let suffix = 1
    while (ids.has(id)) id = `account-${index}-${++suffix}`
    ids.add(id)
    return {
      id,
      label: typeof account.label === 'string' ? account.label.trim() : '',
      windows: windows(account.windows),
      state: STATES.includes(account.state as AccountState) ? (account.state as AccountState) : 'unknown',
      resetsAt: date(account.resets_at)
    }
  })
  const own = windows(usage.windows)
  const rateLimit = limit(row.limit)
  if (!own.length && !accounts.length && !rateLimit) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  return { slug, title: name || slug, windows: own, accounts, limit: rateLimit }
}

/** model.options' providers that report a quota or a limit, in the catalog's order. */
export function parseQuotas(options: unknown): ProviderQuota[] {
  const seen = new Set<string>()
  const out: ProviderQuota[] = []
  for (const row of rows((options as { providers?: unknown } | null)?.providers)) {
    const quota = quotaFromRow(row)
    if (quota && !seen.has(quota.slug)) {
      seen.add(quota.slug)
      out.push(quota)
    }
  }
  return out
}

// Text

export function periodLabel(days: number): string {
  return days === 7 ? t('7 days') : days === 90 ? t('90 days') : t('30 days')
}

/** "1.2M", "34K", "980". */
export function tokensLabel(value: number, language?: string): string {
  return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function countLabel(value: number, language?: string): string {
  return new Intl.NumberFormat(language).format(value)
}

/** "$0.42", "$12.30", and "<$0.01" for a sliver. */
export function moneyLabel(value: number, language?: string): string {
  if (value > 0 && value < 0.01) return `<${new Intl.NumberFormat(language, { style: 'currency', currency: 'USD' }).format(0.01)}`
  return new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function percentLabel(fraction: number, language?: string): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(fraction)
}

/** "in 3 hours", "tomorrow". */
export function relativeLabel(at: number, now: number, language?: string): string {
  const seconds = Math.round((at - now) / 1000)
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return format.format(seconds, 'second')
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86400), 'day')
}

export function absoluteLabel(at: number, language?: string): string {
  return new Date(at).toLocaleString(language, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function accountStateText(account: QuotaAccount, language?: string): string | null {
  switch (account.state) {
    case 'ready':
      return null
    case 'limited':
      return account.resetsAt ? t('Limited until {time}', { time: absoluteLabel(account.resetsAt, language) }) : t('Limited')
    case 'unknown':
      return account.windows.length ? null : t('Not reported yet')
    case 'unavailable':
      return t('Signed out')
  }
}

export type UsageFailure = 'unsupported' | 'signInRequired' | 'failed'

export function usageFailureText(failure: UsageFailure): string {
  switch (failure) {
    case 'unsupported':
      return t("This Hermes doesn't report usage. Update Hermes to see it here.")
    case 'signInRequired':
      return t('Sign in to this dashboard again to see usage.')
    case 'failed':
      return t("Couldn't load usage. Refresh to try again.")
  }
}

/** A refused read: a missing route is an older Hermes, a 401 a lapsed sign-in. */
export function usageFailure(error: unknown): UsageFailure {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 404) return 'unsupported'
  if (code === 401 || code === 403) return 'signInRequired'
  return 'failed'
}
