import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_LIST_PATH, rowsFromResponse, type ChatRow } from './chats'

/** The chat list, read when the connection opens and again when Hermes says the sessions changed. */
export function useChatList(connected: boolean) {
  const [rows, setRows] = useState<ChatRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dashboardList = useRef(true)

  const load = useCallback(async () => {
    try {
      let body: unknown
      if (dashboardList.current) {
        try {
          body = await window.conduit.http('GET', CHAT_LIST_PATH)
        } catch {
          // An older dashboard without the every-profile list: the gateway's own.
          dashboardList.current = false
        }
      }
      if (!dashboardList.current) body = await window.conduit.rpc('session.list', { limit: 200 })
      setRows(rowsFromResponse(body))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(), 400)
  }, [load])

  useEffect(() => {
    if (!connected) return
    void load()
    const off = window.conduit.onEvent(event => {
      if (event.type === 'sessions.changed' || event.type === 'session.title' || event.type === 'message.complete') {
        refreshSoon()
      }
    })
    return () => {
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, load, refreshSoon])

  return { rows, error, refresh: load }
}
