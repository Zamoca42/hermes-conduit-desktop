import { useEffect, useState, type RefObject } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'

/** How far from the end a reader still counts as at the latest message. */
export const NEAR_END = 48

/** Whether a scroller is at (or within NEAR_END of) its end. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END
}

/**
 * The jump-to-latest button, centered over the bottom of a transcript while
 * the reader has scrolled up from its end, as on the phone. Drawn last inside
 * the scroller, it sticks to the scroller's bottom and takes no room.
 */
export function JumpToLatest({ scroller, onJump }: { scroller: RefObject<HTMLDivElement | null>; onJump: () => void }) {
  const [browsing, setBrowsing] = useState(false)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => setBrowsing(!atEnd(el))
    update()
    el.addEventListener('scroll', update, { passive: true })
    const resized = new ResizeObserver(update)
    resized.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      resized.disconnect()
    }
  }, [scroller])
  if (!browsing) return null
  return (
    <div className="jump-latest-dock">
      <button
        className="jump-latest"
        aria-label={t('Scroll to latest message')}
        title={t('Scroll to latest message')}
        onClick={() => {
          const el = scroller.current
          if (!el) return
          onJump()
          el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }}
      >
        <Icon name="down" />
      </button>
    </div>
  )
}
