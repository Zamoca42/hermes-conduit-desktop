/**
 * A profile's Hermes config, read and saved as the phone does: GET
 * `/api/config`, change it, PUT the whole document back. Saves wait their
 * turn, one at a time across the app, so two that overlap never read the
 * same old config and put back what the other changed (Profile config
 * saves). The rows a page shows come from Hermes' schema: a row Hermes
 * doesn't list isn't offered, so an older Hermes isn't given a setting it
 * would ignore.
 */
import { t } from '../../../shared/i18n'

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)

export type Control =
  | { kind: 'toggle'; defaultValue: boolean }
  | { kind: 'number'; defaultValue: number }
  | { kind: 'options'; options: { value: string; label: string }[]; defaultValue: string }

export interface Field {
  key: string
  label: string
  help: string
  control: Control
  /** Shown only when Hermes' schema lists the key. */
  requiresSchema?: boolean
}

export interface Section {
  title: string
  fields: Field[]
}

/** Settings > Memory & delegation's rows, after the phone's. */
export function memorySections(): Section[] {
  return [
    {
      title: t('Memory'),
      fields: [
        {
          key: 'memory.memory_enabled',
          label: t('Long-term memory'),
          help: t('Allow Hermes to retain relevant working memory.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'memory.user_profile_enabled',
          label: t('User profile memory'),
          help: t('Allow Hermes to maintain user preferences.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'memory.memory_char_limit',
          label: t('Memory budget'),
          help: t('Most characters of saved memory Hermes keeps.'),
          control: { kind: 'number', defaultValue: 2200 },
          requiresSchema: true
        },
        {
          key: 'memory.user_char_limit',
          label: t('Profile budget'),
          help: t('Most characters of user profile Hermes keeps.'),
          control: { kind: 'number', defaultValue: 1375 },
          requiresSchema: true
        }
      ]
    },
    {
      title: t('Context'),
      fields: [
        {
          key: 'compression.enabled',
          label: t('Context compression'),
          help: t('Compress older context when the window becomes crowded.'),
          control: { kind: 'toggle', defaultValue: true }
        },
        {
          key: 'compression.threshold',
          label: t('Compression threshold'),
          help: t('Fraction of the context window that starts compression.'),
          control: { kind: 'number', defaultValue: 0.8 }
        },
        {
          key: 'compression.target_ratio',
          label: t('Compression target'),
          help: t('Fraction retained after compression.'),
          control: { kind: 'number', defaultValue: 0.5 }
        },
        {
          key: 'compression.protect_last_n',
          label: t('Protected recent messages'),
          help: t('Recent messages left intact by compression.'),
          control: { kind: 'number', defaultValue: 8 }
        },
        {
          key: 'compression.codex_gpt55_autoraise',
          label: t('Codex compression auto-raise'),
          help: t('Start compression at 85% for supported ChatGPT Codex sign-in models.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'auxiliary.compression.timeout',
          label: t('Compression timeout'),
          help: t('Seconds to wait for the compression model on each call. Raise it for slow local models.'),
          control: { kind: 'number', defaultValue: 120 },
          requiresSchema: true
        }
      ]
    },
    {
      title: t('Delegation'),
      fields: [
        {
          key: 'delegation.max_concurrent_children',
          label: t('Concurrent delegate agents'),
          help: t('Maximum child agents that can work at once.'),
          control: { kind: 'number', defaultValue: 10 }
        },
        {
          key: 'delegation.max_iterations',
          label: t('Delegate turn limit'),
          help: t('Most turns one delegate agent can take.'),
          control: { kind: 'number', defaultValue: 250 },
          requiresSchema: true
        },
        {
          key: 'delegation.child_timeout_seconds',
          label: t('Delegate timeout'),
          help: t('Seconds before a delegate agent is stopped. 0 means no limit.'),
          control: { kind: 'number', defaultValue: 0 },
          requiresSchema: true
        },
        {
          key: 'delegation.max_spawn_depth',
          label: t('Delegation depth'),
          help: t("Levels of delegate agents that can start their own. 1 means delegates can't."),
          control: { kind: 'number', defaultValue: 1 },
          requiresSchema: true
        },
        {
          key: 'delegation.orchestrator_enabled',
          label: t('Coordinating delegates'),
          help: t('Let a delegate agent start and coordinate its own delegates, up to the depth above.'),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'delegation.subagent_auto_approve',
          label: t('Delegates approve commands'),
          help: t("Delegate agents can't ask you. On, they approve a command once; off, they decline it."),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'delegation.independent_completions',
          label: t('Results as each finishes'),
          help: t('Background delegate agents report one by one, not all together at the end.'),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'delegation.gateway_mode',
          label: t('Delegation in chats'),
          help: t('Inline waits for delegates inside the reply; Background lets the reply finish first. Auto is inline when progress messages are off.'),
          control: {
            kind: 'options',
            options: [
              { value: 'auto', label: t('Auto') },
              { value: 'inline', label: t('Inline') },
              { value: 'background', label: t('Background') }
            ],
            defaultValue: 'auto'
          },
          requiresSchema: true
        },
        {
          key: 'delegation.inherit_mcp_toolsets',
          label: t('Delegates keep connectors'),
          help: t("A delegate given fewer tools still keeps your connectors' tools."),
          control: { kind: 'toggle', defaultValue: true },
          requiresSchema: true
        },
        {
          key: 'delegation.max_summary_chars',
          label: t('Delegate result limit'),
          help: t("Most characters of one delegate's result; the rest is saved to a file. 0 means no limit."),
          control: { kind: 'number', defaultValue: 24000 },
          requiresSchema: true
        },
        {
          key: 'delegation.compression_threshold_tokens',
          label: t('Delegate compression cap'),
          help: t('Tokens at which a delegate compresses its context, 16000 or more. 0 follows the main setting.'),
          control: { kind: 'number', defaultValue: 0 },
          requiresSchema: true
        },
        {
          key: 'delegation.surface_child_process_notifications',
          label: t('Delegate command alerts'),
          help: t("Tell the chat when a delegate's background command finishes or matches what it watches for."),
          control: { kind: 'toggle', defaultValue: false },
          requiresSchema: true
        },
        {
          key: 'delegation.prefix_stagger_seconds',
          label: t('Delegate start wait'),
          help: t('Seconds delegates started together wait for the first to begin answering, so they share its cached prompt. 0 means off.'),
          control: { kind: 'number', defaultValue: 0 },
          requiresSchema: true
        }
      ]
    }
  ]
}

/** The keys Hermes' `/api/config/schema` lists; null when it can't say, which shows every row. */
export function schemaKeys(answer: unknown): Set<string> | null {
  const fields = object(object(answer)?.fields)
  return fields ? new Set(Object.keys(fields)) : null
}

export const shownFields = (section: Section, schema: Set<string> | null) =>
  section.fields.filter(field => !field.requiresSchema || !schema || schema.has(field.key))

export function valueAt(config: unknown, key: string): unknown {
  let node: unknown = config
  for (const part of key.split('.')) {
    const row = object(node)
    if (!row || !(part in row)) return undefined
    node = row[part]
  }
  return node
}

/** The row's value in the config, or its default when the config has none (or one of the wrong type). */
export function fieldValue(config: unknown, field: Field): boolean | number | string {
  const raw = valueAt(config, field.key)
  switch (field.control.kind) {
    case 'toggle':
      return typeof raw === 'boolean' ? raw : field.control.defaultValue
    case 'number':
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw
      if (typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw))) return Number(raw)
      return field.control.defaultValue
    default:
      return typeof raw === 'string' && raw ? raw : field.control.defaultValue
  }
}

/** The config with `key` set, its parents made where missing; the original isn't changed. */
export function withValue(config: Row, key: string, value: unknown): Row {
  const parts = key.split('.')
  const out: Row = { ...config }
  let node = out
  for (const part of parts.slice(0, -1)) {
    const child = object(node[part])
    node[part] = child ? { ...child } : {}
    node = node[part] as Row
  }
  node[parts[parts.length - 1]] = value
  return out
}

export type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>
const configPath = (profile: string) => (profile && profile !== 'default' ? `/api/config?profile=${encodeURIComponent(profile)}` : '/api/config')

let queue: Promise<unknown> = Promise.resolve()

/** Reads the profile's config, changes it and saves it, in turn with every other save. Returns what was saved. */
export function updateConfig(http: Http, profile: string, change: (config: Row) => Row): Promise<Row> {
  const run = queue.then(async () => {
    const config = object(await http('GET', configPath(profile))) ?? {}
    const next = change(config)
    await http('PUT', configPath(profile), { config: next, profile })
    return next
  })
  queue = run.catch(() => undefined)
  return run
}

export async function readConfig(http: Http, profile: string): Promise<Row> {
  return object(await http('GET', configPath(profile))) ?? {}
}
