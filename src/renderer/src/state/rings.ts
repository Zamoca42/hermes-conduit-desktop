/**
 * Calls from Hermes on this computer (notifier `call-rings`): the plugin
 * keeps each call that goes out for two minutes, and Conduit asks for the
 * new ones every few seconds, per profile. A call rings here beside the
 * iPhone; answering here opens its chat and starts a call in the voice mode
 * picked in Settings. The relay's pushes reach phones only, so this is how a
 * computer hears of a call.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { STATUS_PATH, pluginStatus, serves } from './plugin'

const withProfile = (path: string, profile?: string, query = '') => {
  const params = new URLSearchParams(query)
  if (profile && profile !== 'default') params.set('profile', profile)
  const text = params.toString()
  return text ? `${path}?${text}` : path
}

export const RINGS_CAPABILITY = 'call-rings'
export const RINGS_PATH = '/api/plugins/conduit_push/calls/rings'
export const RING_POLL_MS = 4_000
/** How long a call rings here before it counts as missed. */
export const RING_FOR_MS = 45_000
/** A call this old (by the host's clock) when first heard of no longer rings: the computer was asleep or offline. */
const FRESH_S = 30

export interface Ring {
  id: string
  profile?: string
  kind: string | null
  /** The bot's name. */
  name: string
  heading: string
  body: string
  reason: string
  title: string
  sessionIds: string[]
  /** When it went out, by the host's clock. */
  at: number
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The host's answer: its rings and its clock, for the next ask. */
export function ringsFrom(body: unknown, profile?: string): { rings: Ring[]; now: number | null } {
  const r = (body ?? {}) as Record<string, unknown>
  const now = typeof r.now === 'number' ? r.now : null
  const rings = (Array.isArray(r.rings) ? r.rings : []).flatMap((raw): Ring[] => {
    const e = (raw ?? {}) as Record<string, unknown>
    if (!str(e.id) || typeof e.at !== 'number') return []
    return [
      {
        id: str(e.id),
        profile,
        kind: str(e.kind) || null,
        name: str(e.name),
        heading: str(e.heading),
        body: str(e.body),
        reason: str(e.reason),
        title: str(e.title),
        sessionIds: Array.isArray(e.session_ids) ? e.session_ids.filter((s): s is string => typeof s === 'string' && !!s) : [],
        at: e.at
      }
    ]
  })
  return { rings, now }
}

/** Which of a first answer's rings still ring: the ones that just went out. */
export const freshRings = (rings: Ring[], now: number | null) => (now === null ? [] : rings.filter(ring => now - ring.at <= FRESH_S))

/** The calls ringing on this computer, newest last, and a way to let one go. */
export function useRings(connected: boolean, profiles: readonly string[]) {
  const [ringing, setRinging] = useState<Ring[]>([])
  const after = useRef(new Map<string, number>())
  const served = useRef(new Map<string, boolean>())
  const seen = useRef(new Set<string>())
  const profileKey = profiles.join('\n')

  const dismiss = useCallback((id: string) => setRinging(current => current.filter(ring => ring.id !== id)), [])

  const read = useCallback(async () => {
    const names = profileKey ? profileKey.split('\n') : ['']
    await Promise.all(
      names.map(async name => {
        const profile = name || undefined
        if (!served.current.has(name)) {
          const status = await gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 12_000).then(pluginStatus, () => null)
          if (!status) return
          served.current.set(name, serves(status, [RINGS_CAPABILITY]))
        }
        if (!served.current.get(name)) return
        const since = after.current.get(name)
        let answer: { rings: Ring[]; now: number | null }
        try {
          answer = ringsFrom(
            await gateway.http('GET', withProfile(RINGS_PATH, profile, since === undefined ? '' : `after=${since}`), undefined, 10_000),
            profile
          )
        } catch {
          return
        }
        if (answer.now !== null) after.current.set(name, answer.now)
        const fresh = since === undefined ? freshRings(answer.rings, answer.now) : answer.rings
        const added = fresh.filter(ring => !seen.current.has(ring.id))
        if (!added.length) return
        added.forEach(ring => seen.current.add(ring.id))
        setRinging(current => [...current.filter(ring => !added.some(a => a.id === ring.id)), ...added])
      })
    )
  }, [profileKey])

  useEffect(() => {
    if (!connected) return
    void read()
    const timer = setInterval(() => void read(), RING_POLL_MS)
    return () => clearInterval(timer)
  }, [connected, read])

  // A host change starts over: the next host's clock and calls are its own.
  useEffect(() => {
    if (connected) return
    after.current.clear()
    served.current.clear()
    setRinging([])
  }, [connected])

  return { ringing, dismiss }
}
