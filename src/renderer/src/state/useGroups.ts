import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ROOM_POLL_MS,
  driverStatus,
  logPage,
  mergeEvents,
  roomCapabilities,
  roomFromWire,
  roomMembers,
  roomsFromList,
  type DriverStatus,
  type Room,
  type RoomCapabilities,
  type RoomEvent
} from './groups'
import type { Bot } from './bots'
import { t } from '../../../shared/i18n'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const uuid = () => crypto.randomUUID()

/** Whether Hermes hosts rooms here, and the rooms it hosts. Rooms are gateway-wide: no profile goes with these calls. */
export function useRooms(connected: boolean) {
  const [capabilities, setCapabilities] = useState<RoomCapabilities | null>(null)
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const caps = roomCapabilities(await window.conduit.rpc('groups.capabilities'))
      setCapabilities(caps)
      if (!caps.supported) {
        setRooms([])
        return
      }
      setRooms(roomsFromList(await window.conduit.rpc('groups.list', { include_disbanded: false })))
      setError(null)
    } catch (e) {
      // A gateway without the method has no rooms; anything else is worth saying.
      const text = message(e)
      if (/method not found|unknown method|-32601/i.test(text)) {
        setCapabilities({ supported: false, canStop: false })
        setRooms([])
      } else setError(text)
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => clearInterval(timer)
  }, [connected, load])

  /** Make a room of these bots; `roomId` is reused on a retry so Hermes never makes a twin. */
  const create = useCallback(
    async (roomId: string, name: string, bots: Bot[]): Promise<Room> => {
      const members = roomMembers(bots)
      if (!members) throw new Error(t('Two of these bots would have the same @handle. Rename one, then try again.'))
      const result = await window.conduit.rpc<{ room?: unknown }>('groups.create', { room_id: roomId, name, members })
      const room = roomFromWire(result?.room)
      if (!room) throw new Error(t('Hermes didn’t say what room it made.'))
      setRooms(current => [room, ...(current ?? []).filter(r => r.roomId !== room.roomId)])
      void load()
      return room
    },
    [load]
  )

  return { capabilities, rooms, error, refresh: load, create }
}

export interface PendingSend {
  eventId: string
  text: string
  failed?: string
}

/** One open room: its log, read in pages and then every few seconds, its driver's status, and sending. */
export function useRoom(room: Room | null, connected: boolean) {
  const roomId = room?.roomId ?? null
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [status, setStatus] = useState<DriverStatus>({ working: false, busy: [], disbanded: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSend[]>([])
  const cursor = useRef(0)
  const ticket = useRef(0)

  const readLog = useCallback(async (id: string, mine: number) => {
    let more = true
    let fresh: RoomEvent[] = []
    while (more && mine === ticket.current) {
      const page = logPage(await window.conduit.rpc('groups.log', { room_id: id, since_seq: cursor.current, limit: 200 }))
      if (!page || mine !== ticket.current) return
      fresh = fresh.concat(page.events)
      if (page.events.length) cursor.current = Math.max(cursor.current, page.cursor)
      more = page.hasMore && page.events.length > 0
    }
    if (fresh.length && mine === ticket.current) {
      setEvents(current => mergeEvents(current, fresh))
      // A send the log now holds is no longer pending.
      const seen = new Set(fresh.filter(e => e.kind === 'message.user').map(e => String(e.payload.thread_id ?? '')))
      setPending(current => current.filter(p => !seen.has(p.eventId)))
    }
  }, [])

  const readState = useCallback(async (id: string, mine: number) => {
    const next = driverStatus(await window.conduit.rpc('groups.state', { room_id: id, include_disbanded: true }))
    if (mine === ticket.current) setStatus(current => (current.working === next.working && current.disbanded === next.disbanded && current.busy.join() === next.busy.join() ? current : next))
  }, [])

  useEffect(() => {
    const mine = ++ticket.current
    cursor.current = 0
    setEvents([])
    setPending([])
    setError(null)
    setStatus({ working: false, busy: [], disbanded: false })
    if (!roomId || !connected) return
    setLoading(true)
    void Promise.all([readLog(roomId, mine), readState(roomId, mine)])
      .catch(e => {
        if (mine === ticket.current) setError(message(e))
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false)
      })
    const timer = setInterval(() => {
      if (document.hidden) return
      void Promise.all([readLog(roomId, mine), readState(roomId, mine)]).catch(() => undefined)
    }, ROOM_POLL_MS)
    return () => clearInterval(timer)
  }, [roomId, connected, readLog, readState])

  const send = useCallback(
    async (text: string, retryId?: string) => {
      const trimmed = text.trim()
      if (!roomId || !trimmed) return
      // The event id is the retry key: the same id never posts twice.
      const eventId = retryId ?? uuid()
      setPending(current => [...current.filter(p => p.eventId !== eventId), { eventId, text: trimmed }])
      try {
        await window.conduit.rpc('groups.send', { room_id: roomId, event_id: eventId, payload: { text: trimmed, thread_id: eventId } })
        setStatus(current => ({ ...current, working: true }))
        await readLog(roomId, ticket.current)
      } catch (e) {
        setPending(current => current.map(p => (p.eventId === eventId ? { ...p, failed: message(e) } : p)))
      }
    },
    [roomId, readLog]
  )

  const stop = useCallback(async () => {
    if (!roomId) return
    try {
      await window.conduit.rpc('groups.stop', { room_id: roomId })
      await readState(roomId, ticket.current)
    } catch (e) {
      setError(message(e))
    }
  }, [roomId, readState])

  return { events, status, loading, error, pending, send, stop }
}
