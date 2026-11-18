/**
 * The delegate agents a chat started (`delegate_task`), after the phone's:
 * Hermes runs them in the background and starts the chat's next turn with
 * their results. Their `subagent.*` events build a card each, and
 * `subagent.list` gives the ones still running to a chat opened or
 * reconnected while they work. Steer, Stop and the live tail act on one.
 */
import { t } from '../../../shared/i18n'

export type AgentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'

export interface DelegateAgent {
  id: string
  goal: string
  model?: string
  status: AgentStatus
  tool?: string
  summary?: string
  /** The newest line it reported. */
  line?: string
  /** Epoch ms, while it runs. */
  startedAt?: number
  durationS?: number
  updatedAt: number
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const isActive = (agent: DelegateAgent) => agent.status === 'queued' || agent.status === 'running'

function statusFrom(named: string, eventType: string): AgentStatus {
  const value = named.toLowerCase()
  if (value === 'error' || value === 'timeout' || value === 'failed') return 'failed'
  if (value === 'pending' || value === 'queued') return 'queued'
  if (['cancelled', 'canceled', 'stopped', 'interrupted'].includes(value)) return 'interrupted'
  if (value === 'completed' || value === 'running') return value
  if (eventType.includes('fail')) return 'failed'
  if (eventType.includes('interrupt')) return 'interrupted'
  if (eventType.includes('complete') || eventType.includes('finish')) return 'completed'
  if (eventType.includes('spawn')) return 'queued'
  return 'running'
}

/** One `subagent.*` event as the card it updates. Hermes names the agent `subagent_id`; older emitters by goal and slot. */
export function agentFromEvent(eventType: string, payload: unknown, sessionId: string, now = Date.now()): DelegateAgent | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Row
  const goal = str(p.goal) || str(p.task)
  const index = num(p.task_index) ?? 0
  const delegation = str(p.delegation_id)
  const id = str(p.subagent_id) || str(p.id) || str(p.agent_id) || (delegation ? `${sessionId}/${delegation}#${index}` : `${sessionId}/#${index}:${goal}`)
  const status = statusFrom(str(p.status), eventType)
  const line = str(p.text) || str(p.message) || str(p.summary)
  const duration = num(p.duration_seconds)
  return {
    id,
    goal,
    model: str(p.model) || undefined,
    status,
    tool: str(p.tool_name) || str(p.tool) || str(p.current_tool) || undefined,
    summary: str(p.summary) || undefined,
    line: line || undefined,
    startedAt: status === 'running' ? now : undefined,
    durationS: !isActive({ status } as DelegateAgent) && duration !== undefined && duration >= 0 ? duration : undefined,
    updatedAt: now
  }
}

/** `subagent.list`: the agents Hermes still has for the session; null when the answer can't be trusted. */
export function parseRoster(raw: unknown, now = Date.now()): DelegateAgent[] | null {
  const rows = (raw as Row | null)?.subagents
  if (!Array.isArray(rows)) return null
  const agents: DelegateAgent[] = []
  for (const r of rows) {
    const row = r && typeof r === 'object' ? (r as Row) : null
    const id = str(row?.subagent_id)
    // A row without an id could be any running agent: trust none of it.
    if (!row || !id) return null
    const status = statusFrom(str(row.status) || 'running', '')
    const started = num(row.started_at)
    agents.push({
      id,
      goal: str(row.goal),
      model: str(row.model) || undefined,
      status,
      tool: str(row.last_tool) || undefined,
      startedAt: isActive({ status } as DelegateAgent) && started && started > 0 ? started * 1000 : undefined,
      updatedAt: now
    })
  }
  return agents
}

/** A card updated by a newer report: what it says now, keeping what it said before when it says nothing. */
export function merged(previous: DelegateAgent | undefined, next: DelegateAgent): DelegateAgent {
  if (!previous) return next
  // An ended card never starts again from a late progress frame.
  const status = !isActive(previous) && isActive(next) ? previous.status : next.status
  return {
    ...previous,
    goal: next.goal || previous.goal,
    model: next.model ?? previous.model,
    status,
    tool: isActive({ status } as DelegateAgent) ? (next.tool ?? previous.tool) : undefined,
    summary: next.summary ?? previous.summary,
    line: next.line ?? previous.line,
    startedAt: previous.startedAt ?? next.startedAt,
    durationS: next.durationS ?? previous.durationS,
    updatedAt: next.updatedAt
  }
}

/** The roster read again: its agents, and a card it no longer lists that was still running is taken as ended. */
export function withRoster(cards: DelegateAgent[], roster: DelegateAgent[]): DelegateAgent[] {
  const listed = new Map(roster.map(agent => [agent.id, agent]))
  const out = cards.map(card => {
    const row = listed.get(card.id)
    if (row) {
      listed.delete(card.id)
      return merged(card, row)
    }
    return isActive(card) ? { ...card, status: 'completed' as const, tool: undefined } : card
  })
  return [...out, ...listed.values()]
}

export function statusTitle(status: AgentStatus): string {
  switch (status) {
    case 'queued':
      return t('Queued')
    case 'running':
      return t('Running')
    case 'completed':
      return t('Done')
    case 'failed':
      return t('Failed')
    default:
      return t('Stopped')
  }
}

/** "1m 05s", "42s". */
export function elapsed(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
