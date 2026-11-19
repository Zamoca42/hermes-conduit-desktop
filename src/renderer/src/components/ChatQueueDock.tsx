import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { withoutMentionNote } from '../state/botMentions'
import { lostRows, queueRefusal, resendWords, waitingRows, type QueuedPrompt } from '../state/chatQueue'

/**
 * The open chat's queue on the Webapp, above the composer, after the
 * phone's AuthorityQueueDock: each message waiting its turn with Send now,
 * Edit and Remove from queue, and a turn a restart cut off with Resend and
 * Discard. `hermes dashboard` keeps no queue, so it never shows there.
 */
export function ChatQueueDock({
  rows,
  chatKey,
  onSendNow,
  onEdit,
  onCancel,
  onDiscard,
  onResend
}: {
  rows: QueuedPrompt[]
  chatKey: string
  onSendNow: (row: QueuedPrompt) => Promise<void>
  onEdit: (row: QueuedPrompt, text: string) => Promise<void>
  onCancel: (row: QueuedPrompt) => Promise<void>
  onDiscard: (row: QueuedPrompt) => Promise<void>
  onResend: (row: QueuedPrompt) => Promise<void>
}) {
  const [working, setWorking] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  useEffect(() => {
    setWorking(new Set())
    setNotice(null)
    setEditing(null)
  }, [chatKey])

  const waiting = waitingRows(rows)
  const lost = lostRows(rows)
  if (!waiting.length && !lost.length) return null

  const act = async (row: QueuedPrompt, action: () => Promise<void>) => {
    if (working.has(row.admissionId)) return
    setNotice(null)
    setWorking(current => new Set(current).add(row.admissionId))
    try {
      await action()
    } catch (e) {
      setNotice(queueRefusal(e))
    } finally {
      setWorking(current => {
        const next = new Set(current)
        next.delete(row.admissionId)
        return next
      })
    }
  }

  return (
    <div className="queue-dock" aria-label={t('Queued messages')}>
      {notice ? <p className="queue-notice">{notice}</p> : null}
      {lost.map(row => {
        const busy = working.has(row.admissionId)
        const words = !!resendWords(row.text)
        return (
          <div key={row.admissionId} className="queue-lost" role="group">
            <strong>{t('Hermes restarted before it finished this.')}</strong>
            {row.text ? <p className="queue-text">{withoutMentionNote(row.text)}</p> : null}
            <p className="meta">{t('Messages after it wait until you choose.')}</p>
            {words ? <p className="meta">{t('Resend sends the words only, without any files.')}</p> : null}
            <div className="queue-actions">
              {words ? (
                <button
                  className="primary"
                  disabled={busy}
                  title={t('Sends these words again as a new message, without any files it had.')}
                  onClick={() => void act(row, () => onResend(row))}
                >
                  {t('Resend')}
                </button>
              ) : null}
              <button disabled={busy} title={t('Lets the messages waiting behind it go on.')} onClick={() => void act(row, () => onDiscard(row))}>
                {t('Discard')}
              </button>
            </div>
          </div>
        )
      })}
      {waiting.map(row => {
        const busy = working.has(row.admissionId)
        if (editing?.id === row.admissionId) {
          return (
            <form
              key={row.admissionId}
              className="queue-row editing"
              onSubmit={e => {
                e.preventDefault()
                const text = editing.text
                setEditing(null)
                void act(row, () => onEdit(row, text))
              }}
            >
              <textarea
                className="input-ask-field"
                rows={2}
                autoFocus
                value={editing.text}
                aria-label={t('Edit queued message')}
                onChange={e => setEditing({ id: row.admissionId, text: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setEditing(null)
                  }
                }}
              />
              <p className="meta">{t('It goes to the back of the line. To withdraw it, use Remove from queue.')}</p>
              <div className="queue-actions">
                <button type="submit" className="primary" disabled={!editing.text.trim()}>
                  {t('Save')}
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  {t('Cancel')}
                </button>
              </div>
            </form>
          )
        }
        return (
          <div key={row.admissionId} className="queue-row">
            <div className="queue-row-text">
              <span className="meta">{t('Queued')}</span>
              <span className="queue-text">{withoutMentionNote(row.text)}</span>
            </div>
            <div className="queue-actions">
              {row.canSendNow ? (
                <button className="link" disabled={busy} onClick={() => void act(row, () => onSendNow(row))}>
                  {t('Send now')}
                </button>
              ) : null}
              {row.canEdit ? (
                <button className="link" disabled={busy} onClick={() => setEditing({ id: row.admissionId, text: withoutMentionNote(row.text) })}>
                  {t('Edit')}
                </button>
              ) : null}
              <button className="link danger" disabled={busy} onClick={() => void act(row, () => onCancel(row))}>
                {t('Remove from queue')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
