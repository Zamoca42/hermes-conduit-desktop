/**
 * Bot @mentions in a chat, after the phone's BotMentions (itself upstream
 * Desktop's mention middleware): the words go as typed, with a note that
 * tells the chat's bot which teammate each `@tag` is. Nothing is delivered
 * from here: the bot writes and sends with its own `message_agent` tool. An
 * unknown tag, an ambiguous one and an e-mail address stay plain text. The
 * note's words are the phone's, so a bot reads the same note from either.
 */
import type { Bot } from './bots'

/** At most this many bots in one note. */
export const MAX_ANNOTATED_BOTS = 16
const RESERVED = new Set(['all', 'everyone', 'user', 'default', 'hermes'])
const NOTE_LEAD = '\n\n[@mentions resolved from the Bot Mode roster — the user is referring to: '
const NOTE_TAIL =
  '. If they want one of these agents contacted, compose your own message and send it with your message_agent tool (agents on other connected machines are reachable too — the Desktop relays it); never forward the user’s text verbatim. If this session has no message_agent tool, agent messaging is unavailable here — say so.]'

const isTokenChar = (c: string) => /[a-z0-9_-]/.test(c)

export function isValidMentionToken(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(value.toLowerCase())
}

/** A friendly name's taggable forms: its slug ("Research Buddy" → research-buddy) and its collapsed form (researchbuddy). */
export function mentionNameForms(value?: string): string[] {
  const name = (value ?? '').trim().toLowerCase()
  if (!name) return []
  let slug = ''
  let replaced = false
  for (const c of name) {
    if (isTokenChar(c)) {
      slug += c
      replaced = false
    } else if (!replaced) {
      slug += '-'
      replaced = true
    }
  }
  slug = slug.replace(/^-+|-+$/g, '')
  const collapsed = [...name].filter(isTokenChar).join('')
  const forms: string[] = []
  for (const form of [slug, collapsed]) if (isValidMentionToken(form) && !RESERVED.has(form) && !forms.includes(form)) forms.push(form)
  return forms
}

/** The handle a bot answers to: its profile name, `hermes` for the main profile. */
export const mentionHandle = (bot: Bot) => (bot.name.trim().toLowerCase() === 'default' ? 'hermes' : bot.name.trim())

/** A friendly name the bot carries beyond its profile name. */
const friendlyName = (bot: Bot) => (bot.title && bot.title.trim().toLowerCase() !== bot.name.trim().toLowerCase() ? bot.title.trim() : undefined)

/** The tag the @ list and Mention a Bot put in: the friendly name's first form, else the handle. */
export function mentionTag(bot: Bot): string {
  return mentionNameForms(friendlyName(bot))[0] ?? mentionHandle(bot)
}

function resolvableForms(bot: Bot): Set<string> {
  return new Set([mentionHandle(bot).toLowerCase(), bot.name.trim().toLowerCase(), ...mentionNameForms(friendlyName(bot))])
}

const isListener = (bot: Bot, active?: string) => !!active && bot.name.trim().toLowerCase() === active.trim().toLowerCase()

/** Code is content: a tag in a fence or inline code is never a mention. */
export const proseStrippingCode = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')

/** What the sender wrote, without Markdown quote lines: a bot named only in a quote isn't mentioned. */
export const withoutQuotedLines = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^[ \t]*>/.test(line))
    .join('\n')

const MENTION = /(^|\s)@([a-z0-9][a-z0-9_-]*)(?:@([a-z0-9][a-z0-9_-]*))?/gim

/** The bots `text` tags, in tag order; the chat's own bot (`active`, its profile) is the listener and left out. */
export function resolveMentions(text: string, roster: Bot[], active?: string): Bot[] {
  const owners = new Map<string, Bot | null>()
  for (const bot of roster) {
    if (isListener(bot, active)) continue
    for (const form of resolvableForms(bot)) {
      const owner = owners.get(form)
      if (owner === undefined) owners.set(form, bot)
      else if (owner && owner.name !== bot.name) owners.set(form, null)
    }
  }
  const mentioned: Bot[] = []
  for (const match of proseStrippingCode(text).matchAll(MENTION)) {
    // A `@tag@connection` qualifier names another machine's bot, which this roster doesn't hold.
    if (match[3]) continue
    const bot = owners.get(match[2]!.toLowerCase())
    if (!bot || mentioned.some(b => b.name === bot.name)) continue
    mentioned.push(bot)
    if (mentioned.length >= MAX_ANNOTATED_BOTS) break
  }
  return mentioned
}

/** `text` with the note naming each tagged bot, or as it is when none resolved. */
export function annotated(text: string, mentions: Bot[]): string {
  if (!mentions.length) return text
  const lines = mentions.map(bot => {
    const title = friendlyName(bot)
    return `@${mentionHandle(bot)} = agent profile "${bot.name}"${title ? ` ("${title}")` : ''}`
  })
  return text + NOTE_LEAD + lines.join('; ') + NOTE_TAIL
}

/** The words to send for `text` in a chat on `active`'s profile: the note added when the user's own lines tag a teammate. */
export function withMentionNote(text: string, roster: Bot[] | null | undefined, active?: string): string {
  if (!roster?.length || text.trimStart().startsWith('/')) return text
  const own = withoutQuotedLines(text)
  if (!/(^|\s)@[a-z0-9]/im.test(own)) return text
  return annotated(text, resolveMentions(own, roster, active))
}

/** The words a sent message had before its note, for sending them again. */
export function withoutMentionNote(text: string): string {
  if (!text.endsWith(']')) return text
  const at = text.lastIndexOf(NOTE_LEAD)
  return at < 0 ? text : text.slice(0, at)
}

/** The @ list for `query` (what follows the `@`): the roster's bots in their order, the listener left out, those whose tag or a word of whose name starts with it. */
export function mentionCandidates(roster: Bot[] | null | undefined, query: string, active?: string): Bot[] {
  const q = query.toLowerCase()
  const bots = (roster ?? []).filter(bot => !isListener(bot, active))
  if (!q) return bots
  return bots.filter(
    bot =>
      mentionTag(bot).toLowerCase().startsWith(q) ||
      bot.title
        .toLowerCase()
        .split(/\s+/)
        .some(word => word.startsWith(q))
  )
}

/** The `@word` being typed just before the caret, or null. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([a-z0-9_-]*)$/i.exec(before)
  if (!match) return null
  return { start: before.length - match[2]!.length - 1, query: match[2]! }
}

/** Mention a Bot's draft: the tag at the end, spaced off the words, completing an `@` being typed there. */
export function insertingMention(draft: string, bot: Bot): string {
  const typing = mentionQueryAt(draft, draft.length)
  const kept = (typing ? draft.slice(0, typing.start) : draft).replace(/\s+$/, '')
  return `${kept}${kept ? ' ' : ''}@${mentionTag(bot)} `
}
