import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { ROOM_POLL_MS, mergeEvents, type DriverStatus, type RoomEvent } from './groups'
import { ROOM_COPIES_CAPABILITY, ROOM_FORGET_CAPABILITY, copyStatus, isOver, roomCopiesClient, type RoomCopy } from './roomCopies'
import type { RoomInvite } from './roomInvites'
import { everyWhileVisible } from './visibility'

const client = roomCopiesClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * The rooms other people host that this Hermes keeps a copy of, read with
 * Group chats every 30 s while the window shows, for a plugin that keeps them.
 */
export function useRoomCopies(connected: boolean, host: string, capabilities: readonly string[]) {
  const served = capabilities.includes(ROOM_COPIES_CAPABILITY)
  const canForget = served && capabilities.includes(ROOM_FORGET_CAPABILITY)
  const [copies, setCopies] = useState<RoomCopy[] | null>(null)
  const reads = useRef(0)

  useEffect(() => {
    reads.current++
    setCopies(null)
  }, [host])

  const refresh = useCallback(async () => {
    const read = ++reads.current
    try {
      const list = await client.list()
      if (read !== reads.current) return
      // Unchanged, nothing re-renders: the open room reads them every few seconds.
      setCopies(current => (JSON.stringify(current) === JSON.stringify(list) ? current : list))
    } catch {
      // The list stays as it was; the next read tries again.
    }
  }, [])

  useEffect(() => {
    if (!connected || !served) return
    void refresh()
    return everyWhileVisible(() => void refresh(), 30_000)
  }, [connected, served, refresh])

  /**
   * Deletes an ended copy: each of your agents' hidden chats for it, then the
   * copy. Agents that left are only on its invite, so it's read too.
   */
  const remove = useCallback(async (copy: RoomCopy, invite?: RoomInvite) => {
    if (!isOver(copy)) return
    const profiles = [...new Set([...copy.yours.map(a => a.profile), ...(invite?.joined.map(a => a.profile) ?? [])].filter(Boolean))]
    for (const profile of profiles) await client.forgetSessions(copy.roomId, profile)
    await client.forget(copy.roomId)
    reads.current++
    setCopies(current => (current ?? []).filter(c => c.id !== copy.id))
  }, [])

  return { served, canForget, copies: served && copies ? copies : [], refresh, remove }
}

/** One open copy: its log, read in pages and then every few seconds, and its status from the copies list. */
export function useRoomCopy(copy: RoomCopy | null, connected: boolean, refreshCopies: () => Promise<void>) {
  const roomId = copy?.roomId ?? null
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [you, setYou] = useState<string | undefined>(undefined)
  const cursor = useRef(0)
  const ticket = useRef(0)

  const readLog = useCallback(async (id: string, mine: number) => {
    let more = true
    let fresh: RoomEvent[] = []
    while (more && mine === ticket.current) {
      const page = await client.log(id, cursor.current, 200)
      if (mine !== ticket.current) return
      fresh = fresh.concat(page.events)
      if (page.events.length) cursor.current = Math.max(cursor.current, page.cursor)
      more = page.hasMore && page.events.length > 0
    }
    if (fresh.length && mine === ticket.current) setEvents(current => mergeEvents(current, fresh))
  }, [])

  useEffect(() => {
    const mine = ++ticket.current
    cursor.current = 0
    setEvents([])
    setError(null)
    setYou(undefined)
    if (!roomId || !connected) return
    setLoading(true)
    void readLog(roomId, mine)
      .catch(e => {
        if (mine === ticket.current) setError(message(e))
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false)
      })
    // What the host calls you, to take it off your own posts; without it they show as the host wrote them.
    void client
      .you(roomId)
      .then(name => mine === ticket.current && setYou(name))
      .catch(() => undefined)
    return everyWhileVisible(() => {
      void readLog(roomId, mine)
        .then(() => mine === ticket.current && setError(null))
        .catch(() => undefined)
      void refreshCopies()
    }, ROOM_POLL_MS)
  }, [roomId, connected, readLog, refreshCopies])

  const status = useMemo<DriverStatus>(() => (copy ? copyStatus(copy) : { working: false, busy: [], disbanded: false, approvals: [] }), [copy])
  return { events, status, loading, error, you }
}
