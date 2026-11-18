/**
 * Slash commands, after the phone's: the composer suggests Hermes' own
 * `commands.catalog` for the chat, and a sent `/command` runs through
 * Hermes' `slash.exec` (`command.dispatch` when that turns one down). A few
 * Conduit runs itself: /new, /help, /stop, and /btw and /background, whose
 * answers `slash.exec` would print after its call had returned.
 */
import { t } from '../../../shared/i18n'

/** `/` at the start, a bare name, then whitespace or the end: `/usr/local` and `run /x` are words. */
const SLASH_COMMAND = /^\/[^\s/]*(?:\s|$)/

export function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND.test(text.trimStart())
}

/** `/name arg…` split the way Hermes does: the name lower-cased, the argument's inside kept as typed. */
export function parseSlashCommand(command: string): { name: string; arg: string } {
  const match = /^(\S+)([\s\S]*)$/.exec(command.trimStart().replace(/^\/+/, ''))
  return match ? { name: match[1]!.toLowerCase(), arg: match[2]!.trim() } : { name: '', arg: '' }
}

export interface SlashCommand {
  name: string
  aliases: string[]
  description: string
}

/**
 * Commands Hermes' `slash.exec` refuses for an app's chat, which Conduit has
 * no route for (the phone's list). They stay out of the suggestions; typed
 * anyway they go to Hermes, whose refusal says what to use.
 */
export const HIDDEN_COMMANDS = new Set([
  'battery', 'browser', 'config', 'copy', 'discard', 'export', 'focus', 'handoff', 'hatch', 'generate-pet', 'history',
  'image', 'import', 'indicator', 'journey', 'learning', 'memory-graph', 'palette', 'paste', 'pause', 'pet', 'platform',
  'plugins', 'prompt', 'compose', 'quit', 'exit', 'redraw', 'reload', 'restart', 'resume', 'rewind', 'save', 'sessions',
  'sethome', 'set-home', 'skin', 'snapshot', 'snap', 'start', 'statusbar', 'sb', 'subscription', 'upgrade', 'timestamps',
  'ts', 'tools', 'topic', 'update', 'wake', 'worktree',
  // The phone opens a sheet for these; the desktop has none yet.
  'agents', 'tasks', 'rollback'
])

/** Shown even when an older Hermes lists only skills. */
export function builtInCommands(): SlashCommand[] {
  const command = (name: string, description: string, aliases: string[] = []): SlashCommand => ({ name, aliases, description })
  return [
    command('new', t('Start a new conversation'), ['reset', 'clear']),
    command('help', t('Show available slash commands'), ['commands']),
    command('background', t('Run a prompt in the background'), ['bg']),
    command('btw', t('Ask a side question about this chat')),
    command('compress', t('Compress this conversation context'), ['compact']),
    command('queue', t('Queue a prompt for the next turn'), ['q']),
    command('retry', t('Retry the last user message')),
    command('status', t('Show current session status')),
    command('steer', t('Steer the current run'), ['s']),
    command('stop', t('Stop the reply and background processes')),
    command('undo', t('Remove the last user and assistant exchange')),
    command('usage', t("Show this session's token usage")),
    command('version', t('Show the Hermes Agent version'))
  ]
}

const bare = (name: string) => name.trim().replace(/^\/+/, '').toLowerCase()

/** A description without its "(usage: …)" tail, which the suggestions don't have room for. */
function shortDescription(text: string): string {
  return text.replace(/\s*\(usage:[^)]*\)\s*$/i, '').trim()
}

/** `commands.catalog` as the suggestions list it: by name, aliases folded in, hidden ones left out. */
export function normalizeCatalog(raw: unknown): SlashCommand[] {
  const object = (raw && typeof raw === 'object' ? raw : {}) as {
    pairs?: unknown
    categories?: { pairs?: unknown }[]
    canon?: Record<string, unknown>
  }
  const commands = new Map<string, SlashCommand>()
  const addPairs = (pairs: unknown) => {
    if (!Array.isArray(pairs)) return
    for (const pair of pairs) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue
      const name = bare(pair[0])
      if (!name || commands.has(name) || HIDDEN_COMMANDS.has(name)) continue
      commands.set(name, { name, aliases: [], description: shortDescription(typeof pair[1] === 'string' ? pair[1] : '') })
    }
  }
  for (const category of Array.isArray(object.categories) ? object.categories : []) addPairs(category?.pairs)
  addPairs(object.pairs)
  for (const [rawAlias, rawCanonical] of Object.entries(object.canon ?? {})) {
    const alias = bare(rawAlias)
    const canonical = typeof rawCanonical === 'string' ? bare(rawCanonical) : ''
    const command = commands.get(canonical)
    if (!alias || alias === canonical || !command) continue
    // An alias Hermes listed as a command of its own goes under its command.
    commands.delete(alias)
    if (!command.aliases.includes(alias)) command.aliases = [...command.aliases, alias].sort()
  }
  for (const builtin of builtInCommands()) {
    if (!commands.has(builtin.name) && !builtin.aliases.some(a => commands.has(a))) commands.set(builtin.name, builtin)
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** What the composer suggests for `typed` (a `/` and the start of a name), best first. */
export function suggestCommands(commands: SlashCommand[], typed: string, limit = 8): SlashCommand[] {
  const query = bare(typed)
  if (!query) return commands.slice(0, limit)
  const starts = commands.filter(c => c.name.startsWith(query))
  const alias = commands.filter(c => !starts.includes(c) && c.aliases.some(a => a.startsWith(query)))
  const inside = commands.filter(c => !starts.includes(c) && !alias.includes(c) && c.name.includes(query))
  return [...starts, ...alias, ...inside].slice(0, limit)
}

/** What `slash.exec` or `command.dispatch` asked for. */
export type SlashResult =
  | { type: 'output'; output: string }
  | { type: 'alias'; target: string }
  | { type: 'send'; message: string; display?: string; notice?: string }
  | { type: 'prefill'; message: string; notice?: string }

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

export function parseSlashResult(raw: unknown): SlashResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  switch (row.type) {
    case 'alias':
      return typeof row.target === 'string' ? { type: 'alias', target: row.target } : null
    case 'prefill':
      return typeof row.message === 'string' ? { type: 'prefill', message: row.message, notice: str(row.notice) } : null
    case 'send':
      return typeof row.message === 'string' ? { type: 'send', message: row.message, display: str(row.display), notice: str(row.notice) } : null
    case 'skill':
      // The expanded skill goes to the model; the chat shows what was typed.
      return typeof row.message === 'string' ? { type: 'send', message: row.message, display: str(row.display) } : null
    default: {
      const output = [str(row.output), str(row.warning)].filter(Boolean).join('\n\n')
      return { type: 'output', output: output === '(no output)' ? '' : output }
    }
  }
}

/** Whether `slash.exec` turned a command down for `command.dispatch` to run. */
export function wantsDispatch(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 4018 || /command\.dispatch/.test(error instanceof Error ? error.message : String(error))
}

/** A side agent's answer, as Hermes' own clients note it. */
export function sideAgentNote(kind: 'btw' | 'background', taskId: string, text: string, question?: string | null): string {
  const header = kind === 'btw' ? (question ? `[btw "${question}"]` : '[btw]') : taskId ? `[bg ${taskId}]` : '[bg]'
  return `${header}\n${text}`
}

/** /help: the commands this chat takes, as a Markdown list. */
export function helpText(commands: SlashCommand[]): string {
  const lines = commands.map(c => {
    const aliases = c.aliases.length ? ` (${c.aliases.map(a => `/${a}`).join(', ')})` : ''
    return `- \`/${c.name}\`${aliases}${c.description ? ` — ${c.description}` : ''}`
  })
  return `**${t('Slash commands')}**\n\n${lines.join('\n')}`
}
