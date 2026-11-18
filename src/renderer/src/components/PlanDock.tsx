import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { currentItem, isFinished, isNewPlan, planCounts, type Plan } from '../state/plan'
import { Icon } from './icons'

/** How long a finished plan stays on its line once the turn is done. */
const FINISHED_FOR = 60_000

/**
 * The agent's plan above the composer, after the phone's plan card: a line
 * ("Tasks · 2 of 5 · now: …") that opens into the whole list. A Mac and a PC
 * have no on-screen keyboard to keep clear, so it opens wherever the focus is.
 * A finished plan goes a minute after its turn ends, and the × hides one
 * until a new plan comes.
 */
export function PlanDock({ plan, running, chatKey }: { plan: Plan | null | undefined; running: boolean; chatKey: string }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [expired, setExpired] = useState(false)
  const shown = useRef<Plan | null>(null)

  // Another chat starts closed; a new plan clears the hidden state and gets its own minute.
  useEffect(() => {
    setOpen(false)
    setHidden(false)
    setExpired(false)
    shown.current = null
  }, [chatKey])

  useEffect(() => {
    if (!plan) return
    if (isNewPlan(plan, shown.current)) {
      setHidden(false)
      setExpired(false)
    }
    shown.current = plan
  }, [plan])

  const finished = !!plan && isFinished(plan)
  // The same plan read again (a workstream's checklist on each poll) keeps its minute.
  const signature = plan ? plan.items.map(item => `${item.id}:${item.status}:${item.content}`).join('\n') : ''
  useEffect(() => {
    if (!finished || running) return
    const timer = setTimeout(() => setExpired(true), FINISHED_FOR)
    return () => clearTimeout(timer)
  }, [finished, running, signature])

  if (!plan?.items.length || hidden || (finished && expired)) return null
  const { done, total } = planCounts(plan)
  const now = currentItem(plan)
  const label = t('{done} of {all}', { done: String(done), all: String(total) })

  return (
    <div className={`plan-dock${open ? ' open' : ''}`}>
      {open ? (
        <ul className="plan-items" aria-label={t('Tasks')}>
          {plan.items.map(item => (
            <li key={item.id} className={`plan-item status-${item.status}${item === now ? ' now' : ''}`} style={{ paddingLeft: 8 + item.depth * 16 }}>
              <span className="plan-mark" aria-hidden="true">
                {item.status === 'completed' ? '✓' : item.status === 'cancelled' ? '–' : item.status === 'in_progress' ? '●' : '○'}
              </span>
              <span className="plan-text">{item.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="plan-line">
        <button className="plan-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong>{t('Tasks')}</strong>
          <span className="usage-meter plan-meter" aria-hidden="true">
            <span style={{ width: `${total ? (done / total) * 100 : finished ? 100 : 0}%` }} />
          </span>
          <span className="meta">{label}</span>
          {now && !open ? <span className="plan-now">{now.content}</span> : null}
          <span className="spacer" />
          <Icon name="chevron" />
        </button>
        <button className="staged-remove" aria-label={t('Hide')} title={t('Hide')} onClick={() => setHidden(true)}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  )
}
