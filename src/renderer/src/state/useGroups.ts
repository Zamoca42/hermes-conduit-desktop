import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { uploadRoomAttachments, type StagedAttachment } from './attachments'
import {
  ROOM_POLL_MS,
  approveParams,
  approveResolved,
  driverStatus,
  logPage,
  mergeEvents,
  roomCapabilities,
  roomFromWire,
  roomMembers,
  roomsFromList,
  type DriverStatus,
  type Room,
  type RoomApproval,
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
      const caps = roomCapabilities(await gateway.rpc('groups.capabilities'))
      setCapabilities(caps)
      if (!caps.supported) {
        setRooms([])
        return
      }
      setRooms(roomsFromList(await gateway.rpc('groups.list', { include_disbanded: false })))
      setError(null)
    } catch (e) {
      // A gateway without the method has no rooms; anything else is worth saying.
      const text = message(e)
      if (/method not found|unknown method|-32601/i.test(text)) {
        setCapabilities({ supported: false, canStop: false, attachments: false })
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
      const result = await gateway.rpc<{ room?: unknown }>('groups.create', { room_id: roomId, name, members })
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
  attachments: StagedAttachment[]
  failed?: string
}

export type RoomApprovalAnswer = { state: 'sending' } | { state: 'sent' } | { state: 'failed'; message: string }

/** One open room: its log, read in pages and then every few seconds, its driver's status, and sending. */
export function useRoom(room: Room | null, connected: boolean) {
  const roomId = room?.roomId ?? null
  const [events, setEvents] = useState<RoomEvent[]>([])
  const [status, setStatus] = useState<DriverStatus>({ working: false, busy: [], disbanded: false, approvals: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSend[]>([])
  const cursor = useRef(0)
  const ticket = useRef(0)
  /** Each approval's answer: on its way, sent, or failed with why; kept by the approval's id. */
  const [answers, setAnswers] = useState<Record<string, RoomApprovalAnswer>>({})

  const readLog = useCallback(async (id: string, mine: number) => {
    let more = true
    let fresh: RoomEvent[] = []
    while (more && mine === ticket.current) {
      const page = logPage(await gateway.rpc('groups.log', { room_id: id, since_seq: cursor.current, limit: 200 }))
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
    const next = driverStatus(await gateway.rpc('groups.state', { room_id: id, include_disbanded: true }))
    if (mine !== ticket.current) return
    setStatus(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
    // A failure whose approval the gateway no longer lists goes; sent answers and ones on their way stay.
    const listed = new Set((next.pendingApprovals ?? []).map(a => a.id))
    setAnswers(current => {
      const kept = Object.fromEntries(Object.entries(current).filter(([id, answer]) => answer.state !== 'failed' || listed.has(id)))
      return Object.keys(kept).length === Object.keys(current).length ? current : kept
    })
  }, [])

  useEffect(() => {
    const mine = ++ticket.current
    cursor.current = 0
    setEvents([])
    setPending([])
    setError(null)
    setAnswers({})
    setStatus({ working: false, busy: [], disbanded: false, approvals: [] })
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
    async (text: string, attachments: StagedAttachment[] = [], retryId?: string) => {
      const trimmed = text.trim()
      if (!roomId || (!trimmed && !attachments.length)) return
      // The event id is the retry key: the same id never posts twice.
      const eventId = retryId ?? uuid()
      setPending(current => [...current.filter(p => p.eventId !== eventId), { eventId, text: trimmed, attachments }])
      try {
        const payload: Record<string, unknown> = { text: trimmed, thread_id: eventId }
        if (attachments.length) payload.attachments = await uploadRoomAttachments((method, params) => gateway.rpc(method, params), roomId, attachments)
        await gateway.rpc('groups.send', { room_id: roomId, event_id: eventId, payload })
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
      await gateway.rpc('groups.stop', { room_id: roomId })
      await readState(roomId, ticket.current)
    } catch (e) {
      setError(message(e))
    }
  }, [roomId, readState])

  /** Saves the room's settings; the event id stays while the save is unchanged, so a retry returns the first save. */
  const saveKey = useRef<{ body: string; eventId: string } | null>(null)
  const saveContext = useCallback(
    async (save: Record<string, unknown>) => {
      if (!roomId) return
      const body = JSON.stringify(save)
      if (saveKey.current?.body !== body) saveKey.current = { body, eventId: uuid() }
      await gateway.rpc('groups.context', { room_id: roomId, event_id: saveKey.current.eventId, ...save })
      saveKey.current = null
      await Promise.all([readState(roomId, ticket.current), readLog(roomId, ticket.current)])
    },
    [roomId, readState, readLog]
  )

  /** Grants a discussion paused at its turn limit one more budget. */
  const continueDiscussion = useCallback(
    async (discussionEventId: string) => {
      if (!roomId) return
      await gateway.rpc('groups.continue', { room_id: roomId, discussion_event_id: discussionEventId })
      setStatus(current => ({ ...current, working: true }))
      await Promise.all([readState(roomId, ticket.current), readLog(roomId, ticket.current)])
    },
    [roomId, readState, readLog]
  )

  /** Run or Reject on a member's held tool call, once: the card shows the answer on its way, then the next status drops it. */
  const answering = useRef(new Set<string>())
  const approve = useCallback(
    async (approval: RoomApproval, choice: 'once' | 'deny') => {
      if (!roomId || !approval.choices.includes(choice) || answering.current.has(approval.id)) return
      const mine = ticket.current
      answering.current.add(approval.id)
      setAnswers(current => ({ ...current, [approval.id]: { state: 'sending' } }))
      try {
        const resolved = approveResolved(await gateway.rpc('groups.approve', approveParams(roomId, approval, choice)))
        if (mine !== ticket.current) return
        setAnswers(current => ({
          ...current,
          [approval.id]: resolved ? { state: 'sent' } : { state: 'failed', message: t('This approval is no longer active.') }
        }))
      } catch (e) {
        // A request the gateway no longer holds (answered elsewhere, timed out, the turn stopped) drops off with the next status.
        if (mine === ticket.current) setAnswers(current => ({ ...current, [approval.id]: { state: 'failed', message: message(e) } }))
      } finally {
        answering.current.delete(approval.id)
      }
      if (mine === ticket.current) await readState(roomId, mine).catch(() => undefined)
    },
    [roomId, readState]
  )

  return { events, status, loading, error, pending, send, stop, saveContext, continueDiscussion, approvals: status.pendingApprovals ?? [], answers, approve }
}
