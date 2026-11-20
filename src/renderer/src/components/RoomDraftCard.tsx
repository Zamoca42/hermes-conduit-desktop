import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Room } from '../state/groups'
import { canStartNow, draftLine, namesList, personStatus, waitingFor, type RoomDraft } from '../state/roomDrafts'
import { until } from '../state/roomInvites'
import { Icon } from './icons'
import { ask } from '../state/dialogs'

/**
 * A draft's card, after the phone's RoomDraftSheet: each person invited and
 * how they answered, when the invites run out, Start now and Take back; for
 * one that ended, why, and Remove. It reads the drafts every 5 s, for up to
 * 10 minutes, and opens the room once it started and the room list has it.
 */
export function RoomDraftCard({
  draft,
  rooms,
  onStart,
  onWithdraw,
  onDismiss,
  onRefresh,
  onOpenRoom,
  onClose
}: {
  draft: RoomDraft
  rooms: Room[] | null
  onStart: (draft: RoomDraft) => Promise<void>
  onWithdraw: (draft: RoomDraft) => Promise<void>
  onDismiss: (id: string) => void
  /** Reads the drafts, and the rooms once it started. */
  onRefresh: (started: boolean) => Promise<void>
  onOpenRoom: (room: Room) => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [startRequested, setStartRequested] = useState(false)
  const latest = useRef(draft)
  latest.current = draft

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  // A room that started opens once the room list has it.
  const room = draft.status === 'started' ? rooms?.find(r => r.roomId === draft.id) : undefined
  useEffect(() => {
    if (room) onOpenRoom(room)
  }, [room, onOpenRoom])

  useEffect(() => {
    let ticks = 0
    const timer = window.setInterval(() => {
      const now = latest.current
      if (++ticks > 120 || now.status === 'ended') return window.clearInterval(timer)
      if (document.visibilityState === 'visible') void onRefresh(now.status === 'started').catch(() => undefined)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [draft.id, onRefresh])

  const start = async () => {
    const waiting = namesList(waitingFor(draft).map(p => p.name))
    if (!(await ask(`${t('Start without {names}?', { names: waiting })}\n\n${t('They’re told it started without them.')}`))) return
    setBusy(true)
    setError(null)
    try {
      await onStart(draft)
      setStartRequested(true)
    } catch (e) {
      setError(t('Could not start it: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  const takeBack = async () => {
    if (!(await ask(`${t('Take back {name}?', { name: draft.name })}\n\n${t('Everyone you invited is told, and their agents’ joins are undone.')}`))) return
    setBusy(true)
    setError(null)
    try {
      await onWithdraw(draft)
      onDismiss(draft.id)
      onClose()
    } catch (e) {
      setError(t('Could not take it back: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shortcuts-backdrop" onClick={() => !busy && onClose()}>
      <div className="shortcuts-sheet link-sheet invite-card" role="dialog" aria-modal="true" aria-label={draft.name} onClick={e => e.stopPropagation()}>
        <header>
          <span />
          <h2>{draft.name}</h2>
          <button type="button" className="link" onClick={onClose} disabled={busy}>
            {t('Done')}
          </button>
        </header>
        {error ? <p className="error-text">{error}</p> : null}
        <h3>{t('Room')}</h3>
        <p>{startRequested && draft.status === 'waiting' ? t('Starting…') : draftLine(draft)}</p>
        {draft.status === 'waiting' && draft.expiresAt !== null ? <p className="meta">{t('Invites work until {date}', { date: until(draft.expiresAt) })}</p> : null}
        {draft.people.length ? (
          <>
            <h3>{t('Invited')}</h3>
            {draft.people.map(person => (
              <div key={person.link} className="invite-bot-row">
                <span className="person-glyph" aria-hidden="true">
                  <Icon name="linked" />
                </span>
                <span className="invite-bot-name">
                  <strong>{person.name}</strong>
                  {personStatus(person) ? <span className="meta">{personStatus(person)}</span> : null}
                </span>
              </div>
            ))}
          </>
        ) : null}
        {draft.agents.length ? (
          <>
            <h3>{t('Your bots')}</h3>
            {draft.agents.map((agent, i) => (
              <p key={i}>{agent}</p>
            ))}
          </>
        ) : null}
        {draft.status === 'waiting' ? (
          <div className="invite-answers">
            {!startRequested && canStartNow(draft) ? (
              <button className="primary" disabled={busy} onClick={() => void start()}>
                {t('Start now')}
              </button>
            ) : null}
            <button className="link danger" disabled={busy} onClick={() => void takeBack()}>
              {t('Take back')}
            </button>
          </div>
        ) : draft.status === 'ended' ? (
          <div className="invite-answers">
            <button
              className="link danger"
              onClick={() => {
                onDismiss(draft.id)
                onClose()
              }}
            >
              {t('Remove')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
