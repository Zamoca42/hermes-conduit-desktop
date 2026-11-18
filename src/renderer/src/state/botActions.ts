/**
 * New Bot, Duplicate, Pin, Hide and Delete, after the phone's and Hermes
 * Desktop's: the same `profiles.*` writes and the same look in
 * `ui_meta['hermes-bots']`, so every app shows the same bot.
 */
import { BOTS_META_KEY, avatarUrl, rosterFromProfiles, type Bot } from './bots'
import { mergedMeta, metaOutcome } from './botEditor'

export const MAIN_PROFILE = 'default'
const MAX_SLUG = 64

const letterOrNumber = /[\p{L}\p{N}]/u
const asciiAlnum = /^[A-Za-z0-9]+$/
const slugChar = /[a-z0-9_-]/

/** A name as the profile id Hermes takes (`^[a-z0-9][a-z0-9_-]{0,63}$`), as the phone folds it: `é` to `e`, other letters as `u<hex>`. */
export function slugFrom(raw: string): string {
  let folded = ''
  for (const ch of raw.trim().normalize('NFC')) {
    if (!letterOrNumber.test(ch)) {
      folded += ch
      continue
    }
    const base = ch.normalize('NFKD').replace(/\p{M}/gu, '')
    folded += base && asciiAlnum.test(base) ? base : `-u${ch.codePointAt(0)!.toString(16)}-`
  }
  let slug = ''
  let pendingDash = false
  for (const ch of folded.toLowerCase()) {
    if (slugChar.test(ch)) {
      if (pendingDash && slug) slug += '-'
      pendingDash = false
      slug += ch
    } else pendingDash = true
  }
  slug = slug.replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length <= MAX_SLUG) return slug
  // Cut at the last token boundary so no `u<hex>` token is split.
  if (slug[MAX_SLUG] === '-') return slug.slice(0, MAX_SLUG).replace(/^-+|-+$/g, '')
  const cut = slug.slice(0, MAX_SLUG)
  const boundary = cut.lastIndexOf('-')
  return boundary > 0 ? cut.slice(0, boundary).replace(/^-+|-+$/g, '') : cut
}

export const isValidSlug = (slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)

/** The display title a name implies: what was typed, unless it already reads exactly like the profile id. */
export function titleFor(raw: string): string {
  const name = raw.trim()
  return name === slugFrom(name) ? '' : name
}

const PROTOCOL_HEADING = '## Messaging other agents'

/** Upstream's `messagingProtocolSection`, for a Hermes that doesn't add it itself. */
export function messagingProtocol(name: string, roster: Pick<Bot, 'name' | 'description' | 'hidden'>[]): string {
  const teammates = roster.filter(bot => bot.name !== name && !bot.hidden)
  const lines = [
    PROTOCOL_HEADING,
    '',
    'You work alongside other named agents. Every agent (including you) has',
    'ONE canonical conversation titled "Bot Chat" — created with the agent,',
    'so it always exists. Agent-to-agent messages are delivered straight',
    'into it, like a DM. To message a teammate, run:',
    '',
    '```',
    `hermes -p <agent-name> chat --in ~ -c "Bot Chat" --create-if-missing -Q -q "Message from 🤖 ${name} (@${name}): your message"`,
    '',
    'Run the send with background=true and notify_on_complete=true on the',
    'terminal tool, then finish your turn — the reply arrives later as a',
    'background process notification. Never block waiting for it.',
    '```',
    '',
    '(`--in ~ -c "Bot Chat" --create-if-missing` resumes their canonical',
    'conversation in the home workspace, creating it if the target has no',
    '"Bot Chat" yet. `-Q` keeps output clean. Always open with the',
    `"Message from 🤖 ${name} (@${name}):" prefix so they know`,
    'who is talking (the @handle lets the app show your avatar to them).',
    'Their reply prints to stdout — relay the relevant part back to the',
    'user, and say which agent it came from.)',
    '',
    'If a message in YOUR chat starts with "Message from 🤖 <name>", it is',
    'a teammate messaging you, not the user. Answer it directly — your reply',
    'reaches them via their own delivery — and use the same command if you',
    'need to start a conversation yourself.',
    '',
    'When the user writes @<agent-name> or says "ask <name> to ..." /',
    '"tell <name> ...", that is a handoff: message that agent, wait for the',
    'reply, and report back.',
    '',
    'The roster grows over time — run `hermes profile list` for the LIVE',
    'teammate list before a handoff. Teammates when you were created:'
  ]
  if (!teammates.length) lines.push('- (none yet)')
  else for (const bot of teammates) lines.push(bot.description?.trim() ? `- \`${bot.name}\` — ${bot.description.trim()}` : `- \`${bot.name}\``)
  return lines.join('\n')
}

/** The SOUL a new bot is born with: the one typed, or an identity from its name and mission; the messaging section when Hermes doesn't add it. */
export function composeSoul(opts: {
  name: string
  title: string
  description: string
  customSoul: string
  serverInjectsProtocol: boolean
  roster: Bot[]
}): string {
  const custom = opts.customSoul.trim()
  if (custom) {
    if (opts.serverInjectsProtocol || custom.includes(PROTOCOL_HEADING)) return custom
    return `${custom}\n\n${messagingProtocol(opts.name, opts.roster)}`
  }
  const display = opts.title.trim() || opts.name
  const mission = opts.description.trim()
  const lines = [`# ${display}`, '']
  if (mission) lines.push(`**Mission:** ${mission}`, '')
  lines.push(
    `You are ${display}, a persistent named agent (profile \`${opts.name}\`) on this machine.`,
    'You keep your own memory, skills, and conversation history across sessions.'
  )
  const identity = lines.join('\n')
  return opts.serverInjectsProtocol ? identity : `${identity}\n\n${messagingProtocol(opts.name, opts.roster)}`
}

export interface NewBotDraft {
  name: string
  description: string
  soul: string
  provider: string
  model: string
  /** The profile its settings are copied from; '' starts a fresh profile. */
  cloneFrom: string
  shareAuth: boolean
  noSkills: boolean
}

export function createParams(slug: string, description: string, soul: string, draft: NewBotDraft): Record<string, unknown> {
  const params: Record<string, unknown> = { name: slug, description, soul, no_skills: draft.noSkills, share_auth: draft.shareAuth }
  if (draft.cloneFrom.trim()) params.clone_from = draft.cloneFrom.trim()
  // The gateway pins a model only with both; one alone inherits.
  if (draft.provider.trim() && draft.model.trim()) {
    params.provider = draft.provider.trim()
    params.model = draft.model.trim()
  }
  return params
}

/** A pin the create asked for that Hermes reports as not set (`model_set: false`); an older gateway that omits it counts as set. */
export const modelPinned = (params: Record<string, unknown>, result: unknown) =>
  params.model === undefined || (result as { model_set?: unknown } | null)?.model_set !== false

/** `setup.runtime_check`: only an explicit `ok: false` means the bot can't reach a model. */
export const needsModel = (result: unknown) => (result as { ok?: unknown } | null)?.ok === false

/** The first face none of the bots wears. */
export function nextFreeFace(bots: Pick<Bot, 'face'>[]): number {
  const taken = new Set(bots.map(b => b.face))
  let next = 0
  while (taken.has(next)) next++
  return next
}

/** Duplicate's name: the first free `<name>-N`, cut so the suffix fits; null past -99. */
export function duplicateName(base: string, taken: string[]): string | null {
  const used = new Set(taken.map(n => n.toLowerCase()))
  for (let n = 2; n < 100; n++) {
    const suffix = `-${n}`
    const candidate = base.slice(0, MAX_SLUG - suffix.length) + suffix
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return null
}

/** The copy's look: the original's without `chat`, `created`, `hidden` or `pinned`, titled "<title> (copy)". */
export function duplicateMeta(source: Bot, photoCopied: boolean): Record<string, unknown> {
  const meta = mergedMeta(source.meta, { created: undefined, hidden: undefined, pinned: undefined, chat: undefined })
  if (!photoCopied && String(meta.imageKind ?? '').toLowerCase() === 'photo') delete meta.imageKind
  const title = typeof source.meta.title === 'string' ? source.meta.title.trim() : ''
  meta.title = title ? `${title} (copy)` : ''
  return meta
}

/** The main profile can't be deleted from here. */
export const canDelete = (bot: Bot) => !bot.isDefault && bot.name.toLowerCase() !== MAIN_PROFILE

export const metaParams = (bot: Bot, patch: Record<string, unknown>): Record<string, unknown> => {
  const params: Record<string, unknown> = { name: bot.name, ui_meta: { [BOTS_META_KEY]: mergedMeta(bot.meta, patch) } }
  if (bot.metaRevision !== undefined) params.ui_meta_expected_revisions = { [BOTS_META_KEY]: bot.metaRevision }
  return params
}

// MARK: Writes

export type Rpc = (method: string, params?: Record<string, unknown>) => Promise<unknown>

async function freshBot(rpc: Rpc, name: string): Promise<Bot | undefined> {
  const roster = rosterFromProfiles(await rpc('profiles.list', {}))
  return [...roster.bots, ...roster.hidden].find(b => b.name === name)
}

/** Writes a look patch, once more over Hermes' newest copy when another app wrote it first. True when it landed. */
export async function writeMeta(rpc: Rpc, bot: Bot, patch: Record<string, unknown>): Promise<boolean> {
  let outcome = metaOutcome(await rpc('profiles.configure', metaParams(bot, patch)))
  if (outcome === 'conflict') {
    const fresh = await freshBot(rpc, bot.name)
    if (!fresh) return false
    outcome = metaOutcome(await rpc('profiles.configure', metaParams(fresh, patch)))
  }
  return outcome === 'persisted' || outcome === 'unsupported'
}

/** A full copy as `<name>-N`, its photo copied first so the look only claims one it holds. Returns the copy's name. */
export async function duplicateBot(rpc: Rpc, bot: Bot, taken: string[]): Promise<{ name: string; lookSaved: boolean }> {
  const name = duplicateName(bot.name, taken)
  if (!name) throw new Error('no free name')
  await rpc('profiles.create', { name, clone_from: bot.name, description: bot.description ?? '' })
  let photoCopied = !bot.hasAvatar
  if (bot.hasAvatar) {
    try {
      const data = avatarUrl(await rpc('profiles.get_asset', { name: bot.name, asset: 'avatar' }))
      if (data) {
        await rpc('profiles.set_asset', { name, asset: 'avatar', data })
        photoCopied = true
      }
    } catch {
      // The copy wears its face instead.
    }
  }
  let lookSaved = false
  try {
    lookSaved = metaOutcome(await rpc('profiles.configure', { name, ui_meta: { [BOTS_META_KEY]: duplicateMeta(bot, photoCopied) } })) !== 'failed'
  } catch {
    lookSaved = false
  }
  return { name, lookSaved }
}
