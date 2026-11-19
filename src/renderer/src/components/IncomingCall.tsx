/**
 * A call from Hermes ringing on this computer, after the phone's ring: who
 * calls and why, with Decline and Answer. It rings with a soft tone while the
 * window is open, and as a notification when the window isn't in front.
 * Unanswered, it stops after a while and leaves a missed-call notification.
 */
import { useEffect, useRef } from 'react'
import { t } from '@shared/i18n'
import { RING_FOR_MS, type Ring } from '../state/rings'
import { Icon } from './icons'

/** Two soft beeps every three seconds, until stopped. */
function startTone(): () => void {
  let context: AudioContext | null = null
  try {
    context = new AudioContext()
  } catch {
    return () => {}
  }
  const ctx = context
  const beep = (at: number) => {
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(0.12, at + 0.02)
    gain.gain.linearRampToValueAtTime(0, at + 0.35)
    gain.connect(ctx.destination)
    for (const frequency of [440, 480]) {
      const tone = ctx.createOscillator()
      tone.frequency.value = frequency
      tone.connect(gain)
      tone.start(at)
      tone.stop(at + 0.4)
    }
  }
  const ring = () => {
    beep(ctx.currentTime + 0.05)
    beep(ctx.currentTime + 0.55)
  }
  ring()
  const timer = window.setInterval(ring, 3_000)
  return () => {
    window.clearInterval(timer)
    void ctx.close().catch(() => undefined)
  }
}

export const ringHeading = (ring: Ring) => (ring.name ? t('{name} wants to talk', { name: ring.name }) : t('Hermes wants to talk'))

export function IncomingCall({ ring, onAnswer, onDecline }: { ring: Ring; onAnswer: () => void; onDecline: (missed: boolean) => void }) {
  const decline = useRef(onDecline)
  decline.current = onDecline

  useEffect(() => {
    const stop = startTone()
    let shown: Notification | null = null
    if ((document.hidden || !document.hasFocus()) && typeof Notification !== 'undefined') {
      shown = new Notification(ringHeading(ring), { body: ring.body || ring.reason, tag: `call-${ring.id}`, requireInteraction: true })
      shown.onclick = () => window.conduit.window.show()
    }
    const missed = window.setTimeout(() => decline.current(true), RING_FOR_MS)
    return () => {
      stop()
      shown?.close()
      window.clearTimeout(missed)
    }
  }, [ring.id])

  return (
    <div className="incoming-call" role="alertdialog" aria-label={ringHeading(ring)}>
      <div className="incoming-call-text">
        <strong>{ringHeading(ring)}</strong>
        {ring.body || ring.reason ? <span className="meta">{ring.body || ring.reason}</span> : null}
      </div>
      <button className="incoming-call-decline" aria-label={t('Decline')} title={t('Decline')} onClick={() => onDecline(false)}>
        <Icon name="close" />
      </button>
      <button className="incoming-call-answer" onClick={onAnswer}>
        {t('Answer')}
      </button>
    </div>
  )
}
