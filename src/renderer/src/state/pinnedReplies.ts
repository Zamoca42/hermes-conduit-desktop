/**
 * Replies pinned to the top of their chat, after the phone's (#918,
 * Conduit/Models/PinnedReplies.swift): a long answer stays a click away
 * however far the chat has moved on. Pins are kept on this computer, per
 * host and profile; Hermes has no pinned message of its own to share them
 * with. A pin is found again by the reply's row id, or by its opening
 * words while the reply had none (pinned as it arrived).
 */
import { copyableReply } from './quote'

export interface PinnedReply {
  id: string
  /** The chat's stored id. */
  chat: string
  profile: string
  /** Hermes' row id for the reply, once it has one. */
  rowId: number | null
  /** The start of the reply on one line, for the bar and the list, and to find it again. */
  excerpt: string
  /** The chat's title when it was pinned. */
  chatTitle: string
  pinnedAt: number
  /** A short name shown in place of the text. */
  label?: string
}

/** What a pin needs of a transcript row. */
export interface PinnableItem {
  kind: string
  key: string
  text?: string
}

export const EXCERPT_LENGTH = 280
export const LABEL_LENGTH = 80

/** `text` on one line, whitespace runs folded to a space, cut to `limit` characters. */
export function folded(text: string, limit: number): string {
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, limit).join('')
}

/** A reply's start as a pin keeps it: its words without the files and boards it carries. */
export function excerptOf(text: string): string {
  return folded(copyableReply(text), EXCERPT_LENGTH) || folded(text, EXCERPT_LENGTH)
}

/** A label on one line; undefined when blank, which clears it. */
export function normalizedLabel(text: string): string | undefined {
  return folded(text, LABEL_LENGTH) || undefined
}

export const pinTitle = (pin: PinnedReply) => pin.label ?? pin.excerpt

const rowIdOf = (key: string): number | null => {
  const match = /^row-(\d+)$/.exec(key)
  return match ? Number(match[1]) : null
}

const sameProfile = (a?: string, b?: string) => (a || 'default').toLowerCase() === (b || 'default').toLowerCase()

export const pinsOfChat = (pins: PinnedReply[], profile: string | undefined, chat: string | null | undefined) =>
  chat ? pins.filter(p => p.chat === chat && sameProfile(p.profile, profile)) : []

export function newPin(item: PinnableItem, chat: string, profile: string | undefined, chatTitle: string, now = Date.now()): PinnedReply {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    chat,
    profile: profile || 'default',
    rowId: rowIdOf(item.key),
    excerpt: excerptOf(item.text ?? ''),
    chatTitle,
    pinnedAt: now
  }
}

/**
 * The row each pin shows, by pin id; a pin whose reply isn't loaded has
 * none. Row ids claim their replies first, then a pin found by its words
 * takes the latest reply reading that way that no other pin has, the
 * newest pin first, so no two pins land on one reply.
 */
export function resolved(pins: PinnedReply[], items: PinnableItem[]): Map<string, string> {
  const result = new Map<string, string>()
  if (!pins.length) return result
  const replies = items.filter(i => i.kind === 'assistant')
  const claimed = new Set<string>()
  for (const pin of pins) {
    if (pin.rowId === null) continue
    const exact = replies.find(r => rowIdOf(r.key) === pin.rowId)
    if (exact && !claimed.has(exact.key)) {
      result.set(pin.id, exact.key)
      claimed.add(exact.key)
    }
  }
  const byText = pins.filter(p => p.rowId === null && p.excerpt).sort((a, b) => b.pinnedAt - a.pinnedAt)
  for (const pin of byText) {
    const match = [...replies].reverse().find(r => !claimed.has(r.key) && excerptOf(r.text ?? '') === pin.excerpt)
    if (!match) continue
    result.set(pin.id, match.key)
    claimed.add(match.key)
  }
  return result
}

/** The pin that is `item`, if any. */
export function pinFor(item: PinnableItem, pins: PinnedReply[], items: PinnableItem[]): PinnedReply | undefined {
  const ids = resolved(pins, items)
  return pins.find(p => ids.get(p.id) === item.key)
}

/** The pins with the row ids their replies have now; null when nothing changed. */
export function refreshed(pins: PinnedReply[], items: PinnableItem[]): PinnedReply[] | null {
  const ids = resolved(pins, items)
  let changed = false
  const next = pins.map(pin => {
    const key = ids.get(pin.id)
    const rowId = key ? rowIdOf(key) : null
    if (pin.rowId !== null || rowId === null) return pin
    changed = true
    return { ...pin, rowId }
  })
  return changed ? next : null
}

/** The bar's order, oldest first as the replies sit in the chat; pins whose reply isn't loaded come first, in the order they were pinned. */
export function barOrder(pins: PinnedReply[], items: PinnableItem[]): PinnedReply[] {
  if (pins.length < 2) return pins
  const position = new Map(items.map((item, index) => [item.key, index]))
  const ids = resolved(pins, items)
  const at = (pin: PinnedReply) => {
    const key = ids.get(pin.id)
    return key === undefined ? -1 : (position.get(key) ?? -1)
  }
  return [...pins].sort((a, b) => at(a) - at(b) || a.pinnedAt - b.pinnedAt)
}

/** After jumping to `current`, the bar shows the pin before it, round to the latest after the first. */
export function nextBarIndex(current: number, count: number): number {
  if (count <= 0) return 0
  const clamped = Math.min(Math.max(current, 0), count - 1)
  return clamped === 0 ? count - 1 : clamped - 1
}

/** The list: a section per chat, the chat with the latest pin first, each chat's pins newest first; `first` (the open chat's) leads. */
export function overview(pins: PinnedReply[], first?: { profile?: string; chat?: string | null }): { key: string; pins: PinnedReply[] }[] {
  const sections = new Map<string, PinnedReply[]>()
  for (const pin of pins) {
    const key = `${pin.profile.toLowerCase()}\t${pin.chat}`
    sections.set(key, [...(sections.get(key) ?? []), pin])
  }
  const isFirst = (list: PinnedReply[]) => !!first?.chat && list[0]!.chat === first.chat && sameProfile(list[0]!.profile, first.profile)
  return [...sections.entries()]
    .map(([key, list]) => ({ key, pins: [...list].sort((a, b) => b.pinnedAt - a.pinnedAt) }))
    .sort((a, b) => Number(isFirst(b.pins)) - Number(isFirst(a.pins)) || b.pins[0]!.pinnedAt - a.pins[0]!.pinnedAt)
}

/** A deleted chat's pins go with it. */
export const withoutChat = (pins: PinnedReply[], profile: string | undefined, chat: string) =>
  pins.filter(p => !(p.chat === chat && sameProfile(p.profile, profile)))

const storageKey = (host: string) => `conduit.pinnedReplies.${host}`

export function loadPins(host: string): PinnedReply[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(host)) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (p): p is PinnedReply =>
          !!p && typeof p.id === 'string' && typeof p.chat === 'string' && typeof p.excerpt === 'string' && typeof p.pinnedAt === 'number'
      )
      .map(p => ({
        ...p,
        profile: typeof p.profile === 'string' ? p.profile : 'default',
        rowId: typeof p.rowId === 'number' ? p.rowId : null,
        chatTitle: typeof p.chatTitle === 'string' ? p.chatTitle : ''
      }))
  } catch {
    return []
  }
}

export function savePins(host: string, pins: PinnedReply[]): void {
  try {
    if (pins.length) localStorage.setItem(storageKey(host), JSON.stringify(pins))
    else localStorage.removeItem(storageKey(host))
  } catch {
    // Kept for this window only.
  }
}
