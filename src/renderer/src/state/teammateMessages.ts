/**
 * Bot-to-bot messages in a chat, read as the phone reads them
 * (BotTeammateMessages.swift, after upstream Desktop): a teammate's delivery
 * arrives as a user turn signed "Message from 🤖 Atlas (@atlas): …", and the
 * sender's side is a `message_agent` call or a terminal `hermes -p atlas
 * chat … -q "Message from …"` run. Neither is something the user typed or
 * ran, so the chat shows "Message from Atlas" and "Messaged Atlas".
 */

export interface Inbound {
  /** The name the sender signed with. */
  sender: string
  /** Its `@handle`, else the signed name. */
  handle: string
  /** What it said, without the signature. */
  body: string
}

export interface Delivery {
  /** The routing key ("atlas"). */
  target: string
  /** What was sent, without the sender's signature. */
  message?: string
}

/** Past this a tool call isn't scanned. */
export const SCAN_LIMIT = 65_536
/** The signature is read from a turn's first 320 characters; the message runs on past them. */
const SIGNATURE_SCAN = 320

const INBOUND =
  /^(?:Message from (🤖\s*)?([^:\n]{1,64}?)(?:\s*\(@([a-z0-9][a-z0-9_-]{0,63})(?:@[a-zA-Z0-9][a-zA-Z0-9_-]{0,63})?\))?:\s*|\[Message from agent '([^']{1,64})'\]\s*)/u
const DELIVERY_COMMAND =
  /(?:^|[;&|]\s*|\bhermes\s+)(?:-p|--profile)(?:\s+|=)(["']?)([a-z0-9][a-z0-9_-]{0,63})\1\s+chat\b[\s\S]*?-q\s+(["'])((?=Message from)(?:\\.|(?!\3)[^\\])*)\3?/

/**
 * The teammate delivery `text` is, or null for anything the user wrote. A
 * bot signature (🤖 or an `@handle`) or the bracket form is wanted, so a
 * forwarded "Message from Mom: …" stays the user's own text.
 */
export function inbound(text: string): Inbound | null {
  const rest = text.trimStart()
  if (!rest.startsWith('Message from ') && !rest.startsWith("[Message from agent '")) return null
  const match = INBOUND.exec(rest.slice(0, SIGNATURE_SCAN))
  if (!match) return null
  const robot = match[1] !== undefined
  const signedName = match[2]?.trim()
  const signedHandle = match[3]
  const bracketName = match[4]?.trim()
  if (bracketName === undefined && !robot && signedHandle === undefined) return null
  const sender = signedName || bracketName
  if (!sender) return null
  return { sender, handle: signedHandle ?? bracketName ?? sender, body: rest.slice(match[0].length).trim() }
}

const agentKey = (value: string) => value.trim().replace(/^@/, '').toLowerCase()

function json(input: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(input) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The delivery a `message_agent` call or a terminal or process run made, or null. */
export function delivery(toolName: string, input?: string): Delivery | null {
  if (!input || input.length > SCAN_LIMIT) return null
  switch (toolName.trim().toLowerCase()) {
    case 'message_agent': {
      const args = json(input)
      const target = agentKey(typeof args?.target === 'string' ? args.target : '')
      if (!target) return null
      const message = typeof args?.message === 'string' ? args.message.trim() : ''
      return { target, message: message || undefined }
    }
    case 'terminal':
    case 'process': {
      const args = json(input)
      const command = typeof args?.command === 'string' ? args.command : input
      if (!/message from/i.test(command)) return null
      const match = DELIVERY_COMMAND.exec(command)
      if (!match?.[2]) return null
      const sent = match[4]?.replace(/\\"/g, '"').replace(/\\'/g, "'")
      const message = sent ? (inbound(sent)?.body ?? sent) : undefined
      return { target: match[2].toLowerCase(), message: message || undefined }
    }
    default:
      return null
  }
}

/** A bot's shown name for a routing key or signed handle: its title when the roster names it, else the key as written. */
export function teammateName(key: string, roster: { name: string; title: string }[] | null | undefined, fallback = key): string {
  const wanted = agentKey(key)
  const bot = (roster ?? []).find(b => (b.name.toLowerCase() === 'default' ? 'hermes' : b.name.toLowerCase()) === wanted || b.name.toLowerCase() === wanted)
  return bot?.title || fallback
}
