/**
 * A chat's standing goal, loop and heartbeat, as Hermes keeps them
 * (`session.control.read`, the `session.control.update` event), and the
 * actions that change them (`session.control`), after the phone's dock.
 * Setting one stays a slash command (`/goal`, `/loop`, `/heartbeat`,
 * `/subgoal`), which Hermes runs as before.
 */
import { t } from '../../../shared/i18n'

type Row = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)

export interface Goal {
  title: string
  status: string
  turnsUsed: number
  maxTurns: number
  subgoals: string[]
  pausedReason?: string
}

export interface Loop {
  prompt: string
  status: string
  intervalSeconds: number
  ticksFired: number
  maxTicks: number
  until?: string
  deferredByGoal: boolean
}

export interface Heartbeat {
  prompt: string
  status: string
  intervalSeconds: number
}

export interface SessionControl {
  goal?: Goal
  loop?: Loop
  heartbeat?: Heartbeat
  revision: string
}

export const isEmpty = (c: SessionControl | null | undefined) => !c || (!c.goal && !c.loop && !c.heartbeat)

/** `{"control": {...}}` or the control itself; null when it isn't one. */
export function parseControl(value: unknown): SessionControl | null {
  const outer = object(value)
  if (!outer) return null
  const c = object(outer.control) ?? outer
  if (!('revision' in c || 'goal' in c || 'loop' in c || 'heartbeat' in c)) return null
  const g = object(c.goal)
  const l = object(c.loop)
  const h = object(c.heartbeat)
  const gStatus = text(g?.status) ?? 'active'
  const lStatus = text(l?.status) ?? 'active'
  const hStatus = text(h?.status) ?? 'active'
  return {
    goal:
      g && text(g.title) && gStatus !== 'cleared'
        ? {
            title: text(g.title)!,
            status: gStatus,
            turnsUsed: int(g.turns_used),
            maxTurns: int(g.max_turns),
            subgoals: (Array.isArray(g.subgoals) ? g.subgoals : []).map(text).filter((s): s is string => !!s),
            pausedReason: text(g.paused_reason)
          }
        : undefined,
    // A loop that ran its course or was stopped has nothing left to pause or stop.
    loop:
      l && text(l.prompt) && (lStatus === 'active' || lStatus === 'paused')
        ? {
            prompt: text(l.prompt)!,
            status: lStatus,
            intervalSeconds: typeof l.interval_seconds === 'number' ? l.interval_seconds : 0,
            ticksFired: int(l.ticks_fired),
            maxTicks: int(l.max_ticks),
            until: text(l.until),
            deferredByGoal: l.deferred_by_goal === true
          }
        : undefined,
    heartbeat:
      h && text(h.prompt) && (hStatus === 'active' || hStatus === 'paused')
        ? { prompt: text(h.prompt)!, status: hStatus, intervalSeconds: int(h.interval_seconds) }
        : undefined,
    revision: text(c.revision) ?? ''
  }
}

/** "every 5 min", "every 2 h 30 min", "every 30 s". */
export function everyText(seconds: number): string {
  const s = Math.max(1, Math.round(seconds))
  let interval: string
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    interval = m ? `${h} h ${m} min` : `${h} h`
  } else if (s >= 60) {
    const m = Math.floor(s / 60)
    const rest = s % 60
    interval = rest ? `${m} min ${rest} s` : `${m} min`
  } else interval = `${s} s`
  return t('every {interval}', { interval })
}

export function goalCaption(goal: Goal): string {
  if (goal.status === 'done') return t('Goal met')
  if (goal.status === 'paused') return t('Goal · paused')
  if (goal.maxTurns > 0) return t('Goal · turn {used} of {max}', { used: String(goal.turnsUsed), max: String(goal.maxTurns) })
  return t('Goal')
}

export function loopCaption(loop: Loop): string {
  if (loop.status === 'paused') return t('Loop · paused')
  if (loop.deferredByGoal) return t('Loop · waiting for the goal')
  const every = everyText(loop.intervalSeconds)
  if (loop.maxTicks > 0) return t('Loop · {every} · run {fired} of {max}', { every, fired: String(loop.ticksFired), max: String(loop.maxTicks) })
  return t('Loop · {every}', { every })
}

export function heartbeatCaption(heartbeat: Heartbeat): string {
  if (heartbeat.status === 'paused') return t('Heartbeat · paused')
  return t('Heartbeat · {every}', { every: everyText(heartbeat.intervalSeconds) })
}

/** Hermes' own words from an action's answer, when it gave any. */
export function actionNote(answer: unknown): string | undefined {
  const dispatch = object(object(answer)?.dispatch)
  for (const key of ['output', 'notice', 'message']) {
    const words = text(dispatch?.[key])
    if (words) return words
  }
  return undefined
}
