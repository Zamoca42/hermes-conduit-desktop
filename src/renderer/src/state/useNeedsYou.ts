import { useCallback, useEffect, useRef, useState } from 'react'
import type { PendingRequest } from '../../../shared/ipc'
import { WAITING_POLL_MS, waitingFromResponse, waitingPath, type WaitingRow } from './needsYou'

/** The approvals and questions waiting on this window, as the main process holds them. */
export function useRequests(): PendingRequest[] {
  const [requests, setRequests] = useState<PendingRequest[]>([])
  useEffect(() => {
    const off = window.conduit.onRequests(setRequests)
    void window.conduit.requests().then(setRequests)
    return off
  }, [])
  return requests
}

/**
 * Every profile's waiting list from the Conduit plugin, read every 20 s
 * while the window is on screen and when a turn ends. A host without the
 * plugin (or one too old for the list) answers 404 once and isn't asked again.
 */
export function useWaiting(connected: boolean, profiles: readonly string[]) {
  const [rows, setRows] = useState<WaitingRow[]>([])
  const [available, setAvailable] = useState(true)
  const unavailable = useRef(false)
  const byProfile = useRef(new Map<string, WaitingRow[]>())
  const profileKey = profiles.join('\n')

  const read = useCallback(async () => {
    if (unavailable.current || document.hidden) return
    const names = profileKey ? profileKey.split('\n') : ['']
    await Promise.all(
      names.map(async name => {
        try {
          const body = await window.conduit.http('GET', waitingPath(name || undefined))
          byProfile.current.set(name, waitingFromResponse(body, name || undefined))
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (/\b404\b|Not Found/i.test(message)) {
            unavailable.current = true
            setAvailable(false)
          }
          // Otherwise quiet: the profile keeps what it showed.
        }
      })
    )
    for (const name of [...byProfile.current.keys()]) if (!names.includes(name)) byProfile.current.delete(name)
    const all = [...byProfile.current.values()].flat().sort((a, b) => b.at - a.at)
    setRows(all)
  }, [profileKey])

  useEffect(() => {
    if (!connected) return
    void read()
    const timer = setInterval(() => void read(), WAITING_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void read()
    }
    document.addEventListener('visibilitychange', onVisible)
    let soon: ReturnType<typeof setTimeout> | null = null
    const off = window.conduit.onEvent(event => {
      if (event.type === 'message.complete' || event.type === 'request.cancel') {
        if (soon) clearTimeout(soon)
        soon = setTimeout(() => void read(), 800)
      }
    })
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      off()
      if (soon) clearTimeout(soon)
    }
  }, [connected, read])

  return { rows: available ? rows : [], available, refresh: read }
}
