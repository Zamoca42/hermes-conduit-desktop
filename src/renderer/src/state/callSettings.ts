/** The host's call settings for a profile, read and shown in Settings > Voice > Calls from Hermes. */
import { language, t } from '../../../shared/i18n'

export const withProfile = (path: string, profile?: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

/** The host's call settings for a profile (calls_store.py); newer settings are absent on older plugins. */
export interface CallSettings {
  enabled: boolean
  when_asked: boolean
  decides?: boolean
  alerts?: boolean
  quiet_at_screen?: boolean
  min_gap_s: number
  per_hour: number
  per_day: number
  rules?: string
  [key: string]: unknown
}

export interface Bounds {
  min: number
  max: number
}

export interface CallsStatus {
  paired: boolean
  /** Calls can ring somewhere: this computer (it asks the plugin for rings) or a paired iPhone. A plugin from before can_ring says paired alone. */
  canRing: boolean
  settings: CallSettings
  bounds: { min_gap_s: Bounds; per_hour: Bounds; per_day: Bounds }
  rulesMax: number
}

const bound = (raw: unknown, fallback: Bounds): Bounds => {
  const b = (raw ?? {}) as Record<string, unknown>
  return typeof b.min === 'number' && typeof b.max === 'number' && b.min <= b.max ? { min: b.min, max: b.max } : fallback
}

/** GET /calls, as the phone's HermesCallsStatus.parse. */
export function parseCallsStatus(raw: unknown): CallsStatus | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = r.settings as Record<string, unknown> | undefined
  if (r.ok !== true || !s || typeof s.enabled !== 'boolean') return null
  const bounds = (r.bounds ?? {}) as Record<string, unknown>
  return {
    paired: r.paired === true,
    canRing: r.can_ring === true || r.paired === true,
    settings: {
      ...s,
      enabled: s.enabled,
      when_asked: s.when_asked !== false,
      min_gap_s: typeof s.min_gap_s === 'number' ? s.min_gap_s : 120,
      per_hour: typeof s.per_hour === 'number' ? s.per_hour : 6,
      per_day: typeof s.per_day === 'number' ? s.per_day : 20
    } as CallSettings,
    bounds: {
      min_gap_s: bound(bounds.min_gap_s, { min: 30, max: 3_600 }),
      per_hour: bound(bounds.per_hour, { min: 1, max: 30 }),
      per_day: bound(bounds.per_day, { min: 1, max: 60 })
    },
    rulesMax: typeof r.rules_max === 'number' && r.rules_max > 0 ? r.rules_max : 500
  }
}

/** The spacing choices offered, inside the host's bounds, with the current one kept. */
export function gapChoices(bounds: Bounds, current: number): number[] {
  const steps = [30, 60, 120, 300, 600, 1_800, 3_600].filter(n => n >= bounds.min && n <= bounds.max)
  return [...new Set([...steps, current])].sort((a, b) => a - b)
}

/** "2 minutes", "1 hour", "30 seconds", in the app's language. */
export function gapText(seconds: number, locale = language()): string {
  const unit = (value: number, name: 'second' | 'minute' | 'hour') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'long' }).format(value)
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, 'hour')
  if (seconds % 60 === 0) return unit(seconds / 60, 'minute')
  return unit(seconds, 'second')
}

/** The note as the host keeps it: each line trimmed, no empty lines. */
export const cleanRules = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')

/** What Try a test call leaves in a new chat's composer, in the app's language. */
export const testCallPrompt = () => t('Call me now to test calls.')

/**
 * What Have Hermes watch for this leaves: scheduled checks for what the call
 * note describes, brought in line with an edited note rather than added again
 * (plugin 0.16.2's call watches). The note goes as typed, saved or not, trimmed
 * the way the host keeps it.
 */
export const watchPrompt = (note: string) =>
  t('Make my scheduled checks that call me match this note. Update the ones I already have instead of adding new ones:\n{note}', { note: cleanRules(note) })
