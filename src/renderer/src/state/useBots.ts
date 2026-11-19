import { isMovingDataUrl, stillOf, stillReady } from './movingPicture'
import { gateway } from '../gateway'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { avatarUrl, rosterFromProfiles, type Bot } from './bots'

/** The bots roster, read when the connection opens, when profiles change and when a turn ends. */
export function useBots(connected: boolean) {
  const [bots, setBots] = useState<Bot[] | null>(null)
  const [hidden, setHidden] = useState<Bot[]>([])
  const [protocol, setProtocol] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const body = await gateway.rpc('profiles.list', { include_sessions: true })
      const roster = rosterFromProfiles(body)
      setBots(roster.bots)
      setHidden(roster.hidden)
      setProtocol(roster.protocol)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    void load()
    const off = window.conduit.onEvent(event => {
      if (event.type === 'profiles.changed' || event.type === 'message.complete' || event.type === 'sessions.changed') {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void load(), 1200)
      }
    })
    return () => {
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, load])

  return { bots, hidden, protocol, error, refresh: load }
}

const avatarCache = new Map<string, Promise<string | null>>()

/** Pictures are a host's own: forget them when another host opens. */
export function forgetAvatars(): void {
  avatarCache.clear()
}

export const AVATAR_CHANGED = 'conduit-avatar-changed'

/** A bot's picture changed here: read it again wherever it shows. */
export function avatarChanged(name: string): void {
  avatarCache.delete(name)
  window.dispatchEvent(new CustomEvent(AVATAR_CHANGED, { detail: name }))
}

/** A bot's picture as an image URL, read once per launch and again after avatarChanged. */
export function readAvatar(name: string): Promise<string | null> {
  let pending = avatarCache.get(name)
  if (!pending) {
    pending = gateway
      .rpc('profiles.get_asset', { name, asset: 'avatar' })
      .then(avatarUrl)
      .catch(() => null)
    avatarCache.set(name, pending)
  }
  return pending
}

/** A bot's picture from its profile's asset store, read once per launch and again when Edit Bot changes it. */
export function useAvatar(name: string, hasAvatar: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === name) setVersion(v => v + 1)
    }
    window.addEventListener(AVATAR_CHANGED, changed)
    return () => window.removeEventListener(AVATAR_CHANGED, changed)
  }, [name])
  useEffect(() => {
    if (!hasAvatar) {
      setUrl(null)
      return
    }
    let live = true
    void readAvatar(name).then(value => {
      if (live) setUrl(value)
    })
    return () => {
      live = false
    }
  }, [name, hasAvatar, version])
  return url
}

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The picture a face shows: a moving one plays only where `moving` (and
 * not with Reduce Motion); elsewhere its first frame, as the phone's rows,
 * transcript and menus keep it.
 */
export function useFace(url: string | null, moving: boolean): string | null {
  const plays = moving && !reducedMotion()
  const moves = useMemo(() => !!url && isMovingDataUrl(url), [url])
  const animated = !!url && !plays && moves
  const [still, setStill] = useState<{ of: string; url: string } | null>(null)
  useEffect(() => {
    if (!animated || !url) return
    let live = true
    void stillOf(url).then(frame => {
      if (live) setStill({ of: url, url: frame })
    })
    return () => {
      live = false
    }
  }, [animated, url])
  if (!animated) return url
  // Nothing until the first frame is ready, so a row never flashes the moving picture.
  return still?.of === url ? still.url : (stillReady(url) ?? null)
}
