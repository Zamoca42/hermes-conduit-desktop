/**
 * `fallback_providers`: the models Hermes tries, in order, when the default
 * fails, after the phone's Fallback models. `delegation.fallback_providers`
 * too, which follows the chat's while it's unset (null).
 */
export interface Fallback {
  provider: string
  model: string
  /** Hand-written routing (`base_url`, `key_env`, `api_mode`…), kept so a save never drops it. */
  extras: Record<string, unknown>
}

/** The raw config value: `{provider, model, …}` objects, or legacy "provider/model" strings. */
export function fallbackList(value: unknown): Fallback[] {
  if (!Array.isArray(value)) return []
  const out: Fallback[] = []
  for (const item of value) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const { provider, model, ...extras } = item as Record<string, unknown>
      out.push({ provider: typeof provider === 'string' ? provider : '', model: typeof model === 'string' ? model : '', extras })
    } else if (typeof item === 'string' && item.trim()) {
      const text = item.trim()
      const slash = text.indexOf('/')
      out.push(slash > 0 ? { provider: text.slice(0, slash), model: text.slice(slash + 1), extras: {} } : { provider: '', model: text, extras: {} })
    }
  }
  return out
}

export const isComplete = (entry: Fallback) => !!entry.provider.trim() && !!entry.model.trim()

export const fallbackJson = (entry: Fallback): Record<string, unknown> => ({ ...entry.extras, provider: entry.provider, model: entry.model })

/** The subagents' chain: unset or null follows the chat's. */
export function delegateChain(config: Record<string, unknown>): { inherits: boolean; entries: Fallback[] } {
  const delegation = config.delegation as Record<string, unknown> | undefined
  const value = delegation && typeof delegation === 'object' ? delegation.fallback_providers : undefined
  return { inherits: value === undefined || value === null, entries: fallbackList(value) }
}

/** What a save writes: null to follow the chat's, else the complete entries in order. */
export const savedValue = (inherits: boolean, entries: Fallback[]) => (inherits ? null : entries.filter(isComplete).map(fallbackJson))

export const sameList = (a: Fallback[], b: Fallback[]) => JSON.stringify(a.map(fallbackJson)) === JSON.stringify(b.map(fallbackJson))

/** Moves the entry at `index` by `by` places; out of range leaves the list as it is. */
export function moved<T>(list: T[], index: number, by: number): T[] {
  const to = index + by
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  return next
}
