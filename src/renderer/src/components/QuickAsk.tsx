import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '@shared/ipc'
import { useChat } from '../state/useChat'
import { useRequests } from '../state/useNeedsYou'
import { Composer } from './Composer'
import { Transcript } from './Transcript'
import { t } from '@shared/i18n'

/**
 * The quick ask window: one field to ask Hermes something from anywhere,
 * the reply streaming under it, and the chat it made a click away in the
 * main window. Esc hides it (or stops a running turn first).
 */
/** The quick window's padding above and below the field (.quick). */
const QUICK_PADDING = 16

export function QuickAsk() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])

  if (!status) return <div className="quick" />
  if (status.phase === 'signed-out' || !status.url) {
    return (
      <div className="quick">
        <div className="quick-empty">{t('Sign in to Hermes in the Conduit window first.')}</div>
      </div>
    )
  }
  return <QuickChat key={`${round}-${status.url}`} status={status} onNew={() => setRound(r => r + 1)} />
}

function QuickChat({ status, onNew }: { status: ConnectionStatus; onNew: () => void }) {
  const connected = status.phase === 'open'
  const { transcript, chat, loading, error, send, stop } = useChat(null, undefined, status.sessionAuthority === true, connected)
  const requests = useRequests()
  const openRequests = requests.filter(r => r.sessionId && r.sessionId === chat.liveId)
  const [shown, setShown] = useState(0)
  const running = useRef(false)
  const pane = useRef<HTMLDivElement>(null)
  running.current = transcript.running

  useEffect(() => window.conduit.onQuickAskShown(() => setShown(n => n + 1)), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running.current) {
        event.preventDefault()
        window.conduit.hideQuickAsk()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        onNew()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNew])

  const started = transcript.items.length > 0
  // Staged files need the taller window too.
  const [staged, setStaged] = useState(false)
  // Before a reply, staged files grow the window only as far as the field
  // needs, so no empty space sits above them.
  const [fieldHeight, setFieldHeight] = useState(0)
  useEffect(() => {
    const field = pane.current?.querySelector('.composer-wrap')
    if (started || !staged || !field) return
    const measure = () => setFieldHeight(field.getBoundingClientRect().height + QUICK_PADDING)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(field)
    return () => observer.disconnect()
  }, [started, staged])
  useEffect(() => window.conduit.setQuickAskExpanded(started ? true : staged && fieldHeight ? fieldHeight : false), [started, staged, fieldHeight])
  return (
    <div className={`quick${started ? ' started' : ''}`} ref={pane}>
      <div className="quick-head">
        <span className="quick-title">{chat.title || t('Ask Hermes')}</span>
        {started ? (
          <>
            <button className="link" onClick={onNew} title={t('New question (Ctrl+N)')}>
              {t('New')}
            </button>
            {chat.storedId ? (
              <button
                className="link"
                onClick={() => window.conduit.openChat({ storedId: chat.storedId!, title: chat.title })}
              >
                {t('Open in Conduit')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {started ? <Transcript state={transcript} loading={loading} error={error} requests={openRequests} /> : null}
      <Composer
        placeholder={t('Ask Hermes anything…')}
        running={transcript.running}
        disabled={!connected}
        model={chat.model}
        onSend={(text, attachments) => void send(text, attachments)}
        onStop={() => void stop()}
        focusKey={`quick-${shown}`}
        draftKey="quick"
        canAttach
        dropZone={pane}
        onStagedChange={setStaged}
      />
    </div>
  )
}
