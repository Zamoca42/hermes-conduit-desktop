import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { DISMISSED_DRAFTS_KEY, ROOM_DRAFTS_CAPABILITY, draftRows, roomDraftsClient, type DraftCreation, type RoomDraft } from './roomDrafts'
import { ROOM_LINKS_CAPABILITY, roomLinksClient, type RoomLink } from './roomLinks'
import { ROOM_DASHBOARD_PROFILES_CAPABILITY } from './roomSetup'
import { everyWhileVisible } from './visibility'

const http = <T,>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number) => gateway.http<T>(method, path, body, timeoutMs)
const client = roomDraftsClient(http)
const links = roomLinksClient(http)

function readDismissed(host: string): Set<string> {
  try {
    const list = (JSON.parse(localStorage.getItem(DISMISSED_DRAFTS_KEY) ?? '{}') as Record<string, unknown>)[host]
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeDismissed(host: string, ids: ReadonlySet<string>): void {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_DRAFTS_KEY) ?? '{}') as Record<string, unknown>
    all[host] = [...ids]
    localStorage.setItem(DISMISSED_DRAFTS_KEY, JSON.stringify(all))
  } catch {
    // Kept for this run only.
  }
}

/**
 * Rooms with people you've linked that haven't started, read with Group
 * chats every 30 s while the window shows, and the people New Group Chat
 * can invite: your Links that are linked, while this Hermes can start rooms
 * with them.
 */
export function useRoomDrafts(connected: boolean, host: string, capabilities: readonly string[]) {
  const served = capabilities.includes(ROOM_DRAFTS_CAPABILITY)
  const conduitProfile = capabilities.includes(ROOM_DASHBOARD_PROFILES_CAPABILITY)
  const [drafts, setDrafts] = useState<RoomDraft[] | null>(null)
  const [startsAvailable, setStartsAvailable] = useState(false)
  const [people, setPeople] = useState<RoomLink[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(host))
  const reads = useRef(0)

  useEffect(() => {
    reads.current++
    setDrafts(null)
    setPeople([])
    setStartsAvailable(false)
    setDismissed(readDismissed(host))
  }, [host])

  const refresh = useCallback(async () => {
    const read = ++reads.current
    try {
      const list = await client.list()
      if (read !== reads.current) return
      setDrafts(current => (JSON.stringify(current) === JSON.stringify(list.drafts) ? current : list.drafts))
      setStartsAvailable(list.startsAvailable)
    } catch {
      // The list stays as it was; the next read tries again.
    }
  }, [])

  /** The people to invite, read when New Group Chat opens. */
  const refreshPeople = useCallback(async () => {
    if (!capabilities.includes(ROOM_LINKS_CAPABILITY)) return
    try {
      const list = await links.list()
      setPeople(list.links.filter(link => link.status === 'linked'))
    } catch {
      // Kept as last read.
    }
  }, [capabilities])

  useEffect(() => {
    if (!connected || !served) return
    void refresh()
    return everyWhileVisible(() => void refresh(), 30_000)
  }, [connected, served, refresh])

  /** A draft just made or answered: in its place, or first. */
  const adopt = useCallback((draft: RoomDraft) => {
    reads.current++
    setDrafts(current => {
      const list = current ?? []
      return list.some(d => d.id === draft.id) ? list.map(d => (d.id === draft.id ? draft : d)) : [draft, ...list]
    })
  }, [])

  const create = useCallback(
    async (name: string, agents: Record<string, unknown>[], linkIds: string[], profile: string): Promise<DraftCreation> => {
      const outcome = await client.create(name, agents, linkIds, profile, conduitProfile)
      if (outcome.kind === 'made') adopt(outcome.draft)
      else void refresh()
      return outcome
    },
    [adopt, conduitProfile, refresh]
  )

  const start = useCallback(async (draft: RoomDraft) => adopt(await client.start(draft.id)), [adopt])

  /** Take back; one whose answer didn't come may have gone through, so the list says. */
  const withdraw = useCallback(
    async (draft: RoomDraft) => {
      try {
        adopt(await client.withdraw(draft.id))
      } catch (error) {
        const list = await client.list().catch(() => null)
        if (list?.drafts.find(d => d.id === draft.id)?.reason !== 'withdrawn') throw error
        setDrafts(list.drafts)
      }
    },
    [adopt]
  )

  /** Off Group chats, on this computer. */
  const dismiss = useCallback(
    (id: string) =>
      setDismissed(current => {
        const next = new Set(current).add(id)
        writeDismissed(host, next)
        return next
      }),
    [host]
  )

  return {
    served,
    drafts: served && drafts ? drafts : [],
    rows: served && drafts ? draftRows(drafts, dismissed) : [],
    /** Whether the drafts were read: they say whether rooms with people can start. */
    read: drafts !== null,
    startsAvailable,
    people: served && startsAvailable ? people : [],
    refresh,
    refreshPeople,
    create,
    start,
    withdraw,
    dismiss
  }
}
