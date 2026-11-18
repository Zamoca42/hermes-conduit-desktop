/**
 * The agent's plan, after the phone's plan card: Hermes' `todo` tool returns
 * the whole list on every call, so the newest result is the plan, and
 * `session.resume` carries the same snapshot as `todo_state`. In a
 * workstream's chat its checklist is the plan. Shown as a line above the
 * composer that opens into the list.
 */
import { t } from '../../../shared/i18n'

export type PlanStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface PlanItem {
  id: string
  content: string
  status: PlanStatus
  /** How deep it sits under its parents, at most 2. */
  depth: number
}

export interface Plan {
  items: PlanItem[]
}

type Row = Record<string, unknown>
const STATUSES: PlanStatus[] = ['pending', 'in_progress', 'completed', 'cancelled']
const MAX_ITEMS = 256
const MAX_CONTENT = 4000

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

function object(value: unknown): Row | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Row
  if (typeof value !== 'string' || value.length > 512_000) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Hermes' `todo` tool, which the gateway's live events name `todo_list`. */
export const isPlanTool = (name: string | undefined) => name === 'todo' || name === 'todo_list'

/** A `todo` result (`{"todos": [...]}`) or `todo_state`; null for anything else. */
export function parsePlan(value: unknown): Plan | null {
  const o = object(value)
  if (!o || !Array.isArray(o.todos)) return null
  // The last row for each id, in its own position.
  const rows = o.todos.map(r => (r && typeof r === 'object' ? (r as Row) : null))
  const last = new Map<string, number>()
  rows.forEach((row, i) => last.set(text(row?.id) || `__invalid_${i}`, i))
  const kept = [...last.values()].sort((a, b) => a - b).slice(0, MAX_ITEMS)
  let next = 0
  const used = new Set(kept.map(i => text(rows[i]?.id)).filter(Boolean))
  const raw = kept.map(i => {
    const row = rows[i]
    let id = text(row?.id)
    if (!id) {
      while (used.has(`?${next}`)) next++
      id = `?${next}`
      used.add(id)
    }
    const content = text(row?.content)
    const status = text(row?.status).toLowerCase()
    const parent = text(row?.parent)
    return {
      id,
      content: !row
        ? t('(invalid item)')
        : content
          ? content.length > MAX_CONTENT
            ? `${content.slice(0, MAX_CONTENT - 1)}…`
            : content
          : t('(no description)'),
      status: (STATUSES.includes(status as PlanStatus) ? status : 'pending') as PlanStatus,
      parent: parent && parent !== id ? parent : undefined
    }
  })
  const byId = new Map(raw.map(item => [item.id, item]))
  const items = raw.map(item => {
    // A missing parent, or a chain that loops, makes the item a root.
    let depth = 0
    const seen = new Set([item.id])
    let node = item
    while (node.parent && byId.has(node.parent) && !seen.has(node.parent)) {
      seen.add(node.parent)
      node = byId.get(node.parent)!
      depth++
    }
    const loops = !!node.parent && seen.has(node.parent)
    return { id: item.id, content: item.content, status: item.status, depth: loops ? 0 : Math.min(depth, 2) }
  })
  return { items }
}

/** A workstream's checklist as its chat's plan. */
export function planFromChecklist(steps: { text: string; state: 'done' | 'doing' | 'todo' }[]): Plan | null {
  if (!steps.length) return null
  return {
    items: steps.map((step, i) => ({
      id: String(i),
      content: step.text,
      status: step.state === 'done' ? 'completed' : step.state === 'doing' ? 'in_progress' : 'pending',
      depth: 0
    }))
  }
}

const open = (item: PlanItem) => item.status === 'pending' || item.status === 'in_progress'

export const isFinished = (plan: Plan) => plan.items.length > 0 && !plan.items.some(open)

/** Done out of the items that count: a cancelled one isn't work left or done. */
export function planCounts(plan: Plan): { done: number; total: number } {
  const counted = plan.items.filter(item => item.status !== 'cancelled')
  return { done: counted.filter(item => item.status === 'completed').length, total: counted.length }
}

/** What the agent is on: the item in progress, else the first pending. */
export const currentItem = (plan: Plan): PlanItem | undefined =>
  plan.items.find(item => item.status === 'in_progress') ?? plan.items.find(item => item.status === 'pending')

/** Whether `plan` is a different plan from `previous`, not an update: fewer than half its items keep an earlier id and text. */
export function isNewPlan(plan: Plan, previous: Plan | null | undefined): boolean {
  if (!previous?.items.length) return true
  if (!plan.items.length) return false
  const earlier = new Map(previous.items.map(item => [item.id, item.content]))
  return plan.items.filter(item => earlier.get(item.id) === item.content).length * 2 < plan.items.length
}
