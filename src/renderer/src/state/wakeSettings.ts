import type { WakeModelChoice } from '../../../shared/ipc'
import { isUsableWakePhrase } from '../../../shared/wakePhrase'

/**
 * Each profile's wake phrases on this computer, per dashboard, as the phone
 * keeps them per dashboard and profile on the device: the phrases and
 * whether one starts a new conversation (on by default, issue 2416). The
 * key ends with the address, so Edit Connection moves it.
 */
export interface WakeProfile {
  phrases: string[]
  fresh: boolean
}

export interface WakeBinding {
  profile: string
  phrase: string
  fresh: boolean
}

const KEY = 'conduit.wake.v1'
export const WAKE_EVENT = 'conduit-wake-settings'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export function wakeProfiles(host: string, storage: Storage = localStorage): Record<string, WakeProfile> {
  try {
    const parsed = JSON.parse(storage.getItem(`${KEY}.${host}`) ?? '{}') as Record<string, Partial<WakeProfile>>
    const out: Record<string, WakeProfile> = {}
    for (const [profile, value] of Object.entries(parsed ?? {})) {
      const phrases = Array.isArray(value?.phrases) ? value.phrases.filter((p): p is string => typeof p === 'string' && !!p.trim()) : []
      if (phrases.length) out[profile] = { phrases, fresh: value?.fresh !== false }
    }
    return out
  } catch {
    return {}
  }
}

export function setWakeProfile(host: string, profile: string, value: WakeProfile | null, storage: Storage = localStorage): void {
  const all = wakeProfiles(host, storage)
  const phrases = value?.phrases.map(p => p.trim()).filter(Boolean) ?? []
  if (phrases.length) all[profile] = { phrases, fresh: value!.fresh }
  else delete all[profile]
  try {
    storage.setItem(`${KEY}.${host}`, JSON.stringify(all))
  } catch {
    // Kept for this window only.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(WAKE_EVENT))
}

/** What the listener hears: each existing profile's usable phrases, in a fixed order, so an index names one. */
export function wakeBindings(profiles: Record<string, WakeProfile>, known: string[]): WakeBinding[] {
  const bindings: WakeBinding[] = []
  for (const profile of Object.keys(profiles).sort()) {
    if (!known.includes(profile)) continue
    for (const phrase of profiles[profile].phrases) if (isUsableWakePhrase(phrase)) bindings.push({ profile, phrase, fresh: profiles[profile].fresh })
  }
  return bindings
}

/** The phone's suggestion: "Hey" and the profile's name. */
export const suggestedPhrase = (name: string) => `Hey ${name}`

/** The model language for Conduit's language: Vosk names English us-English, and Chinese cn. */
export function modelLangFor(appLanguage: string, choices: WakeModelChoice[]): string | null {
  const base = appLanguage.toLowerCase()
  const wanted = base.startsWith('zh') ? ['cn'] : base.startsWith('en') ? ['en-us', 'en'] : base.startsWith('pt') ? ['pt', 'pt-br'] : [base, base.split('-')[0]]
  return wanted.find(lang => choices.some(c => c.lang === lang)) ?? null
}

/** Which chat a phrase continues when it doesn't start a new one: the open chat of that profile, else its newest. */
export function wakeChat(
  profile: string,
  open: { id: string | null; profile?: string },
  rows: { id: string; profile?: string; activeAt?: number }[] | null
): string | null {
  const same = (p?: string) => (p || 'default') === (profile || 'default')
  if (open.id && same(open.profile)) return open.id
  const newest = (rows ?? []).filter(r => same(r.profile)).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))[0]
  return newest?.id ?? null
}
