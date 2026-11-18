import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_LIST_MAX_PAGES, CHAT_LIST_PAGE, chatListPath, mergeRows, refreshFirstPage, responseCount, rowsFromResponse, type ChatRow } from './chats'

/** The chat list, read when the connection opens and again when Hermes says the sessions changed. */
export function useChatList(connected: boolean) {
  const [rows, setRows] = useState<ChatRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dashboardList = useRef(true)

  const generation = useRef(0)

  const rowsRef = useRef<ChatRow[] | null>(null)

  /**
   * The first page at once, then (on a full load) the rest page by page
   * behind it. A refresh reads only the first page, over the rows it has.
   */
  const load = useCallback(async (full = true) => {
    const ticket = ++generation.current
    let shown = false
    try {
      let body: unknown
      if (dashboardList.current) {
        try {
          body = await window.conduit.http('GET', chatListPath(0))
        } catch {
          // An older dashboard without the every-profile list: the gateway's own.
          dashboardList.current = false
        }
      }
      if (!dashboardList.current) body = await window.conduit.rpc('session.list', { limit: CHAT_LIST_PAGE })
      if (ticket !== generation.current) return
      const first = rowsFromResponse(body)
      const pageWasFull = dashboardList.current && responseCount(body) >= CHAT_LIST_PAGE
      let all = !full && rowsRef.current ? refreshFirstPage(rowsRef.current, first, pageWasFull) : first
      rowsRef.current = all
      setRows(all)
      setError(null)
      shown = true
      if (!full || !dashboardList.current) return
      for (let page = 1; page < CHAT_LIST_MAX_PAGES && responseCount(body) >= CHAT_LIST_PAGE; page++) {
        body = await window.conduit.http('GET', chatListPath(page * CHAT_LIST_PAGE))
        if (ticket !== generation.current) return
        all = mergeRows(all, rowsFromResponse(body))
        rowsRef.current = all
        setRows(all)
      }
    } catch (e) {
      // A later page that fails leaves the chats already shown; the next refresh tries again.
      if (ticket !== generation.current || shown) return
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const refreshSoon = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(false), 400)
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

  return { rows, error, refresh: refreshSoon }
}
