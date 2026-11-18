import { useEffect, useRef, useState } from 'react'
import type { ConnectionStatus } from '@shared/ipc'
import { useChat } from '../state/useChat'
import { useRequests } from '../state/useNeedsYou'
import { Composer } from './Composer'
import { Transcript } from './Transcript'

/**
 * The quick ask window: one field to ask Hermes something from anywhere,
 * the reply streaming under it, and the chat it made a click away in the
 * main window. Esc hides it (or stops a running turn first).
 */
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
        <div className="quick-empty">Sign in to Hermes in the Conduit window first.</div>
      </div>
    )
  }
  return <QuickChat key={round} status={status} onNew={() => setRound(r => r + 1)} />
}

function QuickChat({ status, onNew }: { status: ConnectionStatus; onNew: () => void }) {
  const connected = status.phase === 'open'
  const { transcript, chat, loading, error, send, stop } = useChat(null, undefined, status.sessionAuthority === true, connected)
  const requests = useRequests()
  const openRequests = requests.filter(r => r.sessionId && r.sessionId === chat.liveId)
  const [shown, setShown] = useState(0)
  const running = useRef(false)
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
  useEffect(() => window.conduit.setQuickAskExpanded(started), [started])
  return (
    <div className={`quick${started ? ' started' : ''}`}>
      <div className="quick-head">
        <span className="quick-title">{chat.title || 'Ask Hermes'}</span>
        {started ? (
          <>
            <button className="link" onClick={onNew} title="New question (Ctrl+N)">
              New
            </button>
            {chat.storedId ? (
              <button
                className="link"
                onClick={() => window.conduit.openChat({ storedId: chat.storedId!, title: chat.title })}
              >
                Open in Conduit
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {started ? <Transcript state={transcript} loading={loading} error={error} requests={openRequests} /> : null}
      <Composer
        placeholder="Ask Hermes anything…"
        running={transcript.running}
        disabled={!connected}
        model={chat.model}
        onSend={text => void send(text)}
        onStop={() => void stop()}
        focusKey={`quick-${shown}`}
      />
    </div>
  )
}
