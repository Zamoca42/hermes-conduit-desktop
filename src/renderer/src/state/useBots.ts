import { useCallback, useEffect, useRef, useState } from 'react'
import { avatarUrl, botsFromProfiles, type Bot } from './bots'

/** The bots roster, read when the connection opens, when profiles change and when a turn ends. */
export function useBots(connected: boolean) {
  const [bots, setBots] = useState<Bot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const body = await window.conduit.rpc('profiles.list', { include_sessions: true })
      setBots(botsFromProfiles(body))
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

  return { bots, error, refresh: load }
}

const avatarCache = new Map<string, Promise<string | null>>()

/** A bot's picture from its profile's asset store, read once per launch. */
export function useAvatar(name: string, hasAvatar: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!hasAvatar) {
      setUrl(null)
      return
    }
    let live = true
    let pending = avatarCache.get(name)
    if (!pending) {
      pending = window.conduit
        .rpc('profiles.get_asset', { name, asset: 'avatar' })
        .then(avatarUrl)
        .catch(() => null)
      avatarCache.set(name, pending)
    }
    void pending.then(value => {
      if (live) setUrl(value)
    })
    return () => {
      live = false
    }
  }, [name, hasAvatar])
  return url
}
