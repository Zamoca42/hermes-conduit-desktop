/**
 * What a live call's model put on screen (show_on_screen), after the phone's
 * call-screen cards: the newest opens above the call bar as it arrives, and
 * the earlier ones stay a click away for the rest of the call. They live
 * only here, for the call, and aren't part of the saved call.
 */
import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { ScreenCard } from '../state/liveCall'
import { Icon } from './icons'
import { Markdown } from './Markdown'

export function CallCards({ cards }: { cards: ScreenCard[] }) {
  const newest = cards.at(-1)?.id ?? null
  const [open, setOpen] = useState<number | null>(newest)
  // A new card opens as it arrives.
  useEffect(() => setOpen(newest), [newest])
  if (!cards.length) return null
  const shown = cards.find(card => card.id === open)
  return (
    <section className="screen-cards" aria-label={t('On screen')}>
      {shown ? (
        <div className="screen-card">
          <header>
            <strong>{shown.title || t('On screen')}</strong>
            <button className="icon-button" aria-label={t('Close')} title={t('Close')} onClick={() => setOpen(null)}>
              <Icon name="close" />
            </button>
          </header>
          <div className="screen-card-body">
            <Markdown text={shown.markdown} />
          </div>
        </div>
      ) : null}
      {cards.length > 1 || !shown ? (
        <div className="screen-card-tabs">
          {cards.map(card => (
            <button key={card.id} className={card.id === open ? 'chip on' : 'chip'} onClick={() => setOpen(card.id === open ? null : card.id)}>
              {card.title || t('On screen')}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
