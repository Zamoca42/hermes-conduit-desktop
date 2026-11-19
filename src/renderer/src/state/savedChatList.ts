import type { ChatRow } from './chats'

/**
 * The Chats list kept on this computer per dashboard, as the phone keeps its
 * saved list: a launch shows it at once, saying Updating… until the first
 * read lands, instead of Loading chats…. The key ends with the address, so
 * Edit Connection moves it (hostData.ts), and a dashboard signed out takes
 * its list with it.
 */
const PREFIX = 'conduit.savedChats.v1.'
/** The newest rows only: enough to fill the list, small enough to write on every read. */
export const SAVED_ROWS = 200

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const isRow = (row: unknown): row is ChatRow =>
  !!row && typeof row === 'object' && typeof (row as ChatRow).id === 'string' && typeof (row as ChatRow).title === 'string' && typeof (row as ChatRow).pinned === 'boolean'

/** The list kept for `host`, or null when there is none (or it can't be read). */
export function savedChatList(host: string, storage: Storage = localStorage): ChatRow[] | null {
  if (!host) return null
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PREFIX + host) ?? 'null')
    if (!Array.isArray(parsed)) return null
    const rows = parsed.filter(isRow)
    return rows.length ? rows : null
  } catch {
    return null
  }
}

/** Keeps `rows` (the list as read, newest first) for `host`'s next launch. */
export function saveChatList(host: string, rows: ChatRow[], storage: Storage = localStorage): void {
  if (!host) return
  try {
    if (rows.length) storage.setItem(PREFIX + host, JSON.stringify(rows.slice(0, SAVED_ROWS)))
    else storage.removeItem(PREFIX + host)
  } catch {
    // Storage full: the next read tries again.
  }
}

/** Forgets the lists of every dashboard not in `hosts` (signed out or removed). */
export function forgetChatLists(hosts: string[], storage: Storage = localStorage): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(PREFIX) && !hosts.includes(key.slice(PREFIX.length))) stale.push(key)
    }
    for (const key of stale) storage.removeItem(key)
  } catch {
    // Tried again on the next change of hosts.
  }
}
