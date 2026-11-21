import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { STATUS_PATH, pluginStatus } from './plugin'
import {
  DISMISSED_KEY,
  FREE_BUSY_CAPABILITY,
  ROOM_INVITES_CAPABILITY,
  ROOM_INVITES_REMOVE_CAPABILITY,
  inviteRows,
  roomInvitesClient,
  type Answering,
  type RoomInvite
} from './roomInvites'
import { everyWhileVisible } from './visibility'

const client = roomInvitesClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))

function readDismissed(host: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, unknown>
    const list = all[host]
    return new Set(Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeDismissed(host: string, ids: ReadonlySet<string>): void {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, unknown>
    all[host] = [...ids]
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(all))
  } catch {
    // Kept for this run only.
  }
}

/** The plugin's capabilities on this host. */
export async function readCapabilities(): Promise<string[]> {
  const status = pluginStatus(await gateway.http('GET', STATUS_PATH, undefined, 8_000))
  return status.state === 'reported' ? status.capabilities : []
}

/**
 * The invites to rooms people you've linked host, read with Group chats
 * (every 30 s while the window shows), for a plugin that keeps them.
 */
/** Each dashboard's plugin capabilities as last read, so a window a switch opened knows them at once. */
const keptCapabilities = new Map<string, string[]>()
/** Each dashboard's invites as last read, so a switch draws a started room's row at once. */
const keptInvites = new Map<string, RoomInvite[]>()

export function useRoomInvites(connected: boolean, host: string) {
  const [capabilities, setCapabilities] = useState<string[]>(() => keptCapabilities.get(host) ?? [])
  const [invites, setInvites] = useState<RoomInvite[] | null>(() => keptInvites.get(host) ?? null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(host))
  const reads = useRef(0)
  const served = capabilities.includes(ROOM_INVITES_CAPABILITY)

  const shownHost = useRef(host)
  useEffect(() => {
    if (shownHost.current === host) return
    shownHost.current = host
    reads.current++
    setInvites(keptInvites.get(host) ?? null)
    setCapabilities(keptCapabilities.get(host) ?? [])
    setDismissed(readDismissed(host))
  }, [host])

  useEffect(() => {
    if (!connected) return
    let live = true
    readCapabilities()
      .then(list => {
        keptCapabilities.set(host, list)
        if (live) setCapabilities(list)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [connected, host])

  const refresh = useCallback(async () => {
    const read = ++reads.current
    try {
      const list = await client.list()
      if (read !== reads.current) return
      keptInvites.set(host, list)
      setInvites(list)
    } catch {
      // The list stays as it was; the next read tries again.
    }
  }, [host])

  useEffect(() => {
    if (!connected || !served) return
    void refresh()
    return everyWhileVisible(() => void refresh(), 30_000)
  }, [connected, served, refresh])

  const adopt = useCallback((invite: RoomInvite) => {
    reads.current++
    setInvites(current => {
      const list = current ?? []
      return list.some(i => i.id === invite.id) ? list.map(i => (i.id === invite.id ? invite : i)) : [invite, ...list]
    })
  }, [])

  const answer = useCallback(
    async (invite: RoomInvite, joining: Record<string, unknown>[], justMe = false): Promise<Answering> => {
      const outcome = await client.answer(invite, joining, justMe)
      if (outcome.kind === 'answered') adopt(outcome.invite)
      else if (outcome.kind === 'sending') void refresh()
      return outcome
    },
    [adopt, refresh]
  )

  /** Off Group chats: on the Hermes where the plugin can, else on this computer. */
  const remove = useCallback(
    async (invite: RoomInvite) => {
      if (capabilities.includes(ROOM_INVITES_REMOVE_CAPABILITY)) {
        try {
          const removed = await client.remove(invite)
          if (removed) return adopt(removed)
        } catch {
          // Kept off this computer's list at least.
        }
      }
      setDismissed(current => {
        const next = new Set(current).add(invite.id)
        writeDismissed(host, next)
        return next
      })
    },
    [adopt, capabilities, host]
  )

  return {
    capabilities,
    served,
    freeBusy: capabilities.includes(FREE_BUSY_CAPABILITY),
    invites: served && invites ? invites : [],
    /** The list has been read from this host. */
    loaded: served && invites !== null,
    rows: served && invites ? inviteRows(invites, dismissed) : [],
    refresh,
    answer,
    remove
  }
}
