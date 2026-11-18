/**
 * Rows Hermes writes into a chat's transcript as timeline events, not
 * messages: a model or personality switch, a resumed turn, background agents
 * or a background process finishing, a system notification. Each carries a
 * `display_kind`, and its physical text is scaffold written for the model,
 * so the chat shows a short notice instead, after the phone's
 * MessageNormalizer.timelineNoticeContent and DelegationReport.
 */
import { t } from '../../../shared/i18n'

export const TIMELINE_KINDS = new Set([
  'model_switch',
  'personality_switch',
  'auto_continue',
  'async_delegation_complete',
  'process_complete',
  'internal_notification'
])

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

const MODEL_CHANGE =
  /^\s*\[?System:\s*The active model for this chat has changed to\s+(\S+)\s+via provider\s+(.+?)(?:\.\s+From this point forward\b|\.?\]\s*$|$)/i

/** `[System: The active model for this chat has changed to X via provider Y. …]`. */
export function modelChange(raw: string): { model: string; provider: string } | null {
  const match = raw.match(MODEL_CHANGE)
  if (!match) return null
  const model = match[1]!.trim()
  const provider = match[2]!.trim()
  return model && provider ? { model, provider } : null
}

/** `[System: …]` without its brackets. */
function systemNotice(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.toLowerCase().startsWith('[system:')) return null
  let body = trimmed.slice('[System:'.length).trim()
  if (body.endsWith(']')) body = body.slice(0, -1).trim()
  return body || null
}

/** The notice a timeline row shows, or null for a kind this app doesn't know (shown as written). */
export function timelineNotice(kind: string, raw: string, metadata: unknown, projected?: string | null): string | null {
  if (!TIMELINE_KINDS.has(kind)) return null
  if (typeof projected === 'string') return projected
  const meta = object(metadata)
  const displayText = text(meta?.display_text)
  switch (kind) {
    case 'model_switch': {
      const change = modelChange(raw)
      return change ? t('Model has been changed to {provider}/{model}', { provider: change.provider, model: change.model }) : t('Model changed')
    }
    case 'personality_switch':
      return t('Personality changed')
    case 'auto_continue':
      return t('Resumed interrupted turn')
    case 'async_delegation_complete': {
      const count = typeof meta?.task_count === 'number' && Number.isInteger(meta.task_count) && meta.task_count > 0 ? meta.task_count : null
      if (count === null) return displayText ?? t('Background agent work finished')
      // No plural forms here yet: one agent reads as the general notice.
      if (count === 1) return t('Background agent work finished')
      return t('{count} background agents finished', { count: String(count) })
    }
    case 'process_complete':
      return displayText ?? t('Background process finished')
    default:
      return systemNotice(raw) ?? (raw.trim() || t('System notification'))
  }
}

export type DelegationOutcome = 'completed' | 'incomplete' | 'stopped' | 'failed'
export interface DelegationEntry {
  number: number
  goal: string
  outcome: DelegationOutcome
  /** Seconds, when the report says. */
  duration?: number
  result: string
}

const TASK_HEADER = /^--- [✓✗⚠] TASK (\d+)\/\d+(?:: ((?:(?!\n--- [✓✗⚠] TASK )[\s\S])*?))? {2}\(status=([^\n]*)\) ---\n?/gm
const PREAMBLE_FIELDS = ['Context you provided: ', 'Toolsets: ', 'Role: ', 'Status: ']
const MODEL_ONLY = [
  '[TRUNCATED — ',
  'Full live transcript (complete tool/assistant trace): ',
  'Live transcript: ',
  'Handed off to you: ',
  'Child left ',
  "Child's process ",
  "This model's provider refused the task (content_policy_blocked).",
  'This failure ('
]

const oneLine = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')
const cleaned = (body: string) =>
  body
    .split('\n')
    .filter(line => !MODEL_ONLY.some(prefix => line.startsWith(prefix)))
    .join('\n')
    .trim()

function outcome(status: string, truncated: boolean): DelegationOutcome {
  switch (status.trim().toLowerCase()) {
    case 'completed':
    case 'success':
      return truncated ? 'incomplete' : 'completed'
    case 'interrupted':
    case 'cancelled':
      return 'stopped'
    default:
      return 'failed'
  }
}

function seconds(field: string): number | undefined {
  const f = field.trim()
  if (!f.endsWith('s')) return undefined
  const value = Number(f.slice(0, -1))
  return f.length > 1 && Number.isFinite(value) && value >= 0 ? value : undefined
}

const statusField = (line: string) => line.slice('Status: '.length).split(/\s/, 1)[0] ?? ''
const durationField = (line: string) => {
  const match = line.match(/Duration: ([0-9.]+s)/)
  return match ? seconds(match[1]!) : undefined
}

function batchEntries(report: string): DelegationEntry[] {
  const matches = [...report.matchAll(TASK_HEADER)]
  // A header this can't read would hide its task: the plain notice then.
  const headers = report.split('\n').filter(line => /^--- [✓✗⚠] TASK \d+\/\d+/.test(line))
  if (matches.length !== headers.length) return []
  return matches.map((match, index) => {
    const start = match.index! + match[0].length
    const end = index + 1 < matches.length ? matches[index + 1]!.index! : report.length
    const header = match[3]!
    const fields = header.split(', ')
    return {
      number: Number(match[1]) || index + 1,
      goal: oneLine(match[2] ?? ''),
      outcome: outcome(fields[0] ?? '', header.includes('TRUNCATED')),
      duration: fields
        .slice(1)
        .map(seconds)
        .find(v => v !== undefined),
      result: cleaned(report.slice(start, end))
    }
  })
}

function singleEntry(report: string): DelegationEntry | null {
  const lines = report.split('\n')
  const resultIndex = lines.indexOf('--- RESULT ---')
  if (resultIndex < 0) return null
  const before = lines.slice(0, resultIndex)
  const statusLine = [...before].reverse().find(l => l.startsWith('Status: '))
  if (!statusLine) return null
  let goal = ''
  const goalIndex = before.findIndex(l => l.startsWith('Original goal: '))
  if (goalIndex >= 0) {
    const rest: string[] = []
    for (const line of before.slice(goalIndex + 1)) {
      if (PREAMBLE_FIELDS.some(f => line.startsWith(f))) break
      rest.push(line)
    }
    goal = [before[goalIndex]!.slice('Original goal: '.length), ...rest].join('\n')
  }
  return {
    number: 1,
    goal: oneLine(goal),
    outcome: outcome(statusField(statusLine), statusLine.includes('[TRUNCATED')),
    duration: durationField(statusLine),
    result: cleaned(lines.slice(resultIndex + 1).join('\n'))
  }
}

function failureNotice(report: string): DelegationEntry | null {
  const lines = report.split('\n')
  const statusIndex = lines.findIndex(l => l.startsWith('Status: '))
  if (statusIndex < 0) return null
  const statusLine = lines[statusIndex]!
  const goal = lines.find(l => l.startsWith('Task: '))?.slice('Task: '.length) ?? ''
  const number = Number(report.match(/task (\d+)\/\d+\]/)?.[1]) || 1
  const error =
    lines
      .slice(statusIndex + 1)
      .find(l => l.startsWith('Error: '))
      ?.slice('Error: '.length) ?? ''
  return { number, goal: oneLine(goal), outcome: outcome(statusField(statusLine), false), duration: durationField(statusLine), result: error.trim() }
}

/** What the background agents came back with, from the report Hermes wrote for the model; null when it isn't one this reads. */
export function delegationReport(raw: string): DelegationEntry[] | null {
  const report = raw.replace(/\r\n/g, '\n')
  let entries: DelegationEntry[] = []
  if (report.startsWith('[ASYNC DELEGATION BATCH COMPLETE')) entries = batchEntries(report)
  else if (report.startsWith('[ASYNC DELEGATION COMPLETE')) entries = [singleEntry(report)].filter((e): e is DelegationEntry => !!e)
  else if (report.startsWith('[ASYNC DELEGATION TASK FAILED')) entries = [failureNotice(report)].filter((e): e is DelegationEntry => !!e)
  return entries.length ? entries : null
}
