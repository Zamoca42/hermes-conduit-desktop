/**
 * What a live call shows above its bar, after the phone's call screen: the
 * cards its model put on screen (show_on_screen), the newest opening as it
 * arrives, and the background jobs it started (start_job), each a chip
 * that opens its status or, once it finishes, its reply. They live only
 * here, for the call, and aren't part of the saved call.
 */
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { ScreenCard } from '../state/liveCall'
import type { VoiceJob } from '../state/voiceJobs'
import { Icon } from './icons'
import { Markdown } from './Markdown'

const jobBody = (job: VoiceJob) =>
  job.status === 'running'
    ? t('Hermes is working on it. Its reply comes back on this call.')
    : job.status === 'done'
      ? job.reply || t('Finished without a written reply.')
      : job.status === 'cancelled'
        ? t('Cancelled.')
        : job.error || t('Failed.')

const jobMark = (job: VoiceJob) => (job.status === 'running' ? '…' : job.status === 'done' ? '✓' : job.status === 'cancelled' ? '–' : '!')

export function CallCards({ cards, jobs = [] }: { cards: ScreenCard[]; jobs?: VoiceJob[] }) {
  const newest = cards.at(-1)?.id ?? null
  const [open, setOpen] = useState<string | null>(newest === null ? null : `c${newest}`)
  // A new card opens as it arrives.
  useEffect(() => setOpen(newest === null ? null : `c${newest}`), [newest])
  if (!cards.length && !jobs.length) return null
  const card = cards.find(c => `c${c.id}` === open)
  const job = jobs.find(j => `j${j.id}` === open)
  const shown = card ? { title: card.title || t('On screen'), markdown: card.markdown } : job ? { title: job.title, markdown: jobBody(job) } : null
  const toggle = (key: string) => setOpen(current => (current === key ? null : key))
  return (
    <section className="screen-cards" aria-label={t('On screen')}>
      {shown ? (
        <div className="screen-card">
          <header>
            <strong>{shown.title}</strong>
            <button aria-label={t('Close')} title={t('Close')} onClick={() => setOpen(null)}>
              <Icon name="close" />
            </button>
          </header>
          <div className="screen-card-body">
            <Markdown text={shown.markdown} />
          </div>
        </div>
      ) : null}
      {cards.length + jobs.length > 1 || !shown ? (
        <div className="screen-card-tabs">
          {cards.map(c => (
            <button key={`c${c.id}`} className={`c${c.id}` === open ? 'chip on' : 'chip'} onClick={() => toggle(`c${c.id}`)}>
              {c.title || t('On screen')}
            </button>
          ))}
          {jobs.map(j => (
            <button key={`j${j.id}`} className={`j${j.id}` === open ? 'chip on job' : 'chip job'} onClick={() => toggle(`j${j.id}`)}>
              <span aria-hidden="true">{jobMark(j)}</span> {j.title}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
