import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { PULSE, parseFeed, type DownReason, type PulseFeed, type Rest } from './pulse'

/** How often the feed is read: on the screen, and behind it for the rail's count and Pulse's chat. */
const SHOWN_MS = 15_000
const HIDDEN_MS = 60_000

export type PulseAvailability = 'unknown' | 'on' | 'off' | 'missing'

/**
 * Pulse's feed: read on connect and every minute (every 15 s while its
 * screen is shown), so the rail can count what's new and the chat list can
 * leave Pulse's own chat out.
 */
export function usePulse(connected: boolean, shown: boolean) {
  const [feed, setFeed] = useState<PulseFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [availability, setAvailability] = useState<PulseAvailability>('unknown')
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    try {
      const [raw, state] = await Promise.all([gateway.http('GET', `${PULSE}/feed?looks=1&proposals=1`), gateway.http('GET', PULSE).catch(() => null)])
      if (mine !== generation.current) return
      setFeed(parseFeed(raw))
      setError(null)
      const enabled = (state as { enabled?: unknown } | null)?.enabled
      setAvailability(enabled === false ? 'off' : 'on')
    } catch (e) {
      if (mine !== generation.current) return
      if ((e as { code?: unknown }).code === 404) {
        setAvailability('missing')
        setFeed(null)
      } else setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    void load()
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') void load()
      },
      shown ? SHOWN_MS : HIDDEN_MS
    )
    return () => clearInterval(timer)
  }, [connected, shown, load])

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      try {
        return (await gateway.http('POST', `${PULSE}${path}`, body)) as Record<string, unknown> | null
      } finally {
        void load()
      }
    },
    [load]
  )

  return {
    feed,
    error,
    availability,
    reload: load,
    /** Every card the screen shows, seen. */
    markSeen: useCallback(() => post('/feed/seen', { ids: null, proposals: true }), [post]),
    /** A suggestion's Add, Not now or Undo. */
    proposal: useCallback((id: number, action: 'add' | 'dismiss' | 'undo') => post(`/proposals/${id}/${action}`, {}), [post]),
    rate: useCallback((card: number, rating: 'up' | 'down', reason?: DownReason) => post('/rate', { card, rating, ...(reason ? { reason } : {}) }), [post]),
    done: useCallback((card: number, done: boolean) => post('/done', { card, done }), [post]),
    dismiss: useCallback((card: number, dismissed: boolean, until?: Rest) => post('/dismiss', { card, dismissed, ...(until ? { until } : {}) }), [post]),
    acted: useCallback((card: number) => post('/acted', { card }), [post]),
    quiet: useCallback(
      async (on: boolean) => {
        try {
          await gateway.http('PUT', PULSE, { quiet_until: on ? 'today' : null })
        } finally {
          void load()
        }
      },
      [load]
    )
  }
}

export type PulseState = ReturnType<typeof usePulse>
