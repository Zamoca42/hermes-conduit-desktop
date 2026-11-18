/**
 * Boards: the cards one `conduit_show` call showed in a chat, after the
 * phone's RichBoard. The plugin's answer keeps the normalized cards (so the
 * chat's history draws them again), their Markdown, the layout and the
 * follow-ups. This app draws the plainer kinds itself; a board with any
 * other kind shows its Markdown whole, never part of it.
 */

export const SHOW_TOOL = 'conduit_show'

export type Card = Record<string, unknown> & { type: string; title?: string }

export interface Board {
  cards: Card[]
  /** One card at a time, each card's title its tab. */
  tabs: boolean
  /** Asked as the user's next message when tapped. */
  next: string[]
  /** The cards' Markdown, shown in the board's place when they can't all be drawn. */
  markdown?: string
}

/** The kinds drawn here. */
export const DRAWN = new Set(['stats', 'table', 'checklist', 'list', 'progress', 'callout', 'status', 'steps', 'timeline'])

const object = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return null
}

/** A ::conduit-board line or a stray directive left in the Markdown. */
const cleanMarkdown = (text: string) => text.replace(/^::conduit-board\{[^}]*\}\s*$/gm, '').trim()

/**
 * The board a finished `conduit_show` call showed, or null when it showed
 * none: a Markdown-only show, or an answer whose Markdown Hermes was told to
 * put in its reply, which would show twice.
 */
export function boardFrom(name: string, result: unknown, args: unknown): Board | null {
  if (name.toLowerCase() !== SHOW_TOOL) return null
  const answer = object(result)
  if (!answer) return null
  const given = Array.isArray(answer.cards) ? answer.cards : answer.ok === true ? object(args)?.cards : undefined
  const raw = Array.isArray(given) ? given : []
  if (!raw.length) return null
  const cards = raw.filter((card): card is Card => !!card && typeof card === 'object' && typeof (card as { type?: unknown }).type === 'string')
  const markdown = typeof answer.markdown === 'string' && answer.markdown.trim() ? cleanMarkdown(answer.markdown) : undefined
  const next = (Array.isArray(answer.next) ? answer.next : [])
    .map(item => (typeof item === 'string' ? item : typeof (item as { text?: unknown })?.text === 'string' ? (item as { text: string }).text : ''))
    .filter(Boolean)
    .slice(0, 4)
  const drawable = cards.length === raw.length && cards.every(card => DRAWN.has(card.type))
  if (!drawable && !markdown) return null
  return { cards: drawable ? cards : [], tabs: answer.layout === 'tabs' && cards.length > 1, next, markdown }
}

// Readers for a card's parts: the plugin normalized them, so these only keep the shape safe.

export const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
export const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [])
export const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(text) : [])
export const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** A progress row's share, 0 to 1. */
export function share(value: unknown, goal: unknown): number {
  const v = number(value) ?? 0
  const g = number(goal)
  if (!g || g <= 0) return Math.max(0, Math.min(1, v > 1 ? v / 100 : v))
  return Math.max(0, Math.min(1, v / g))
}
