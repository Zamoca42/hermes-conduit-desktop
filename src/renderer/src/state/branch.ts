import type { TranscriptItem } from './transcript'

/** What a Branch from one reply carries: the turns through it, and where Hermes' copy stops. */
export interface BranchPlan {
  /** Your messages and the replies through this one, for `session.create`'s copy (`hermes dashboard`). */
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** The reply's stored row, where the authority's branch stops. */
  rowId?: number
  /** The reply is the chat's last row, so a branch of the whole chat stops at it. */
  newest: boolean
}

/** The phone's Branch: the turns up to and including the reply `key`; null when there is nothing to carry. */
export function branchPlan(items: readonly TranscriptItem[], key: string): BranchPlan | null {
  const at = items.findIndex(i => i.key === key)
  const reply = items[at]
  if (at < 0 || reply?.kind !== 'assistant') return null
  const messages = items.slice(0, at + 1).flatMap(item => {
    if (item.kind !== 'user' && item.kind !== 'assistant') return []
    if (item.kind === 'user' && item.pending) return []
    const content = item.text.trim()
    return content ? [{ role: item.kind, content }] : []
  })
  if (!messages.length) return null
  const last = [...items].reverse().find(i => i.kind === 'user' || i.kind === 'assistant')
  return { messages, ...(reply.rowId ? { rowId: reply.rowId } : {}), newest: last?.key === key }
}
