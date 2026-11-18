import { useState } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import type { CronJob, CronRun } from '../state/cron'
import { KanbanBoard } from './KanbanBoard'
import { ScheduledJobs } from './ScheduledJobs'

type Segment = 'board' | 'scheduled'
const SEGMENT_KEY = 'conduit.tasksSegment'

interface Props {
  bots: Bot[] | null
  connected: boolean
  profile: string | null
  onProfile: (profile: string | null) => void
  onOpenRun: (run: CronRun, job: CronJob) => void
}

/** The phone's Tasks tab: the task board, and the scheduled jobs. */
export function Tasks({ bots, connected, profile, onProfile, onOpenRun }: Props) {
  const [segment, setSegment] = useState<Segment>(() => {
    try {
      return localStorage.getItem(SEGMENT_KEY) === 'scheduled' ? 'scheduled' : 'board'
    } catch {
      return 'board'
    }
  })
  const pick = (next: Segment) => {
    setSegment(next)
    try {
      localStorage.setItem(SEGMENT_KEY, next)
    } catch {
      // Kept for this window only.
    }
  }
  const switcher = (
    <div className="segmented tasks-segment" role="tablist" aria-label={t('Tasks')}>
      <button role="tab" aria-selected={segment === 'board'} className={segment === 'board' ? 'on' : undefined} onClick={() => pick('board')}>
        {t('Board')}
      </button>
      <button role="tab" aria-selected={segment === 'scheduled'} className={segment === 'scheduled' ? 'on' : undefined} onClick={() => pick('scheduled')}>
        {t('Scheduled')}
      </button>
    </div>
  )
  return segment === 'board' ? (
    <KanbanBoard connected={connected} bots={bots} segment={switcher} />
  ) : (
    <ScheduledJobs bots={bots} connected={connected} profile={profile} onProfile={onProfile} onOpenRun={onOpenRun} segment={switcher} />
  )
}
