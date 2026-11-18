import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionStatus } from '@shared/ipc'
import { ChatList } from './components/ChatList'
import { Composer } from './components/Composer'
import { Icon } from './components/icons'
import { NeedsYou } from './components/NeedsYou'
import { SignIn } from './components/SignIn'
import { TitleBar } from './components/TitleBar'
import { Transcript } from './components/Transcript'
import type { ChatRow } from './state/chats'
import { useChat } from './state/useChat'
import { useChatList } from './state/useChatList'
import { unmatchedWaiting, type WaitingRow } from './state/needsYou'
import { useRequests, useWaiting } from './state/useNeedsYou'
import { cleanTitle } from './state/text'

export function App() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)

  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])

  if (!status) return <div className="app" />
  const signedOut = status.phase === 'signed-out' || (status.phase === 'failed' && !status.url)
  return (
    <div className="app">
      <TitleBar subtitle={signedOut ? undefined : status.hostLabel} />
      {signedOut || status.phase === 'failed' ? <SignIn notice={status.error} /> : <Shell status={status} />}
    </div>
  )
}

type Section = 'chats' | 'needs' | 'settings'

function Shell({ status }: { status: ConnectionStatus }) {
  const connected = status.phase === 'open'
  const [section, setSection] = useState<Section>('chats')
  const [selected, setSelected] = useState<{ id: string | null; profile?: string; title?: string }>({ id: null })
  const list = useChatList(connected)
  const { transcript, chat, loading, error, send, stop } = useChat(
    selected.id,
    selected.profile,
    status.sessionAuthority === true,
    connected
  )

  const newChat = useCallback(() => {
    setSection('chats')
    setSelected({ id: null })
  }, [])

  // ⌘N comes from the Mac's menu bar (so Ctrl+N stays the text field's next line there); Ctrl+N elsewhere.
  useEffect(() => {
    const offMenu = window.conduit.onMenu(action => {
      if (action === 'new-chat') newChat()
    })
    if (window.conduit.platform === 'darwin') return offMenu
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offMenu()
      window.removeEventListener('keydown', onKey)
    }
  }, [newChat])

  const runningIds = useMemo(() => {
    const ids = new Set<string>()
    if (transcript.running && chat.storedId) ids.add(chat.storedId)
    return ids
  }, [transcript.running, chat.storedId])

  const onSend = useCallback(
    async (text: string) => {
      const created = await send(text)
      if (created) {
        setSelected(s => ({ ...s, id: created }))
        void list.refresh()
      }
    },
    [send, list]
  )

  const title = cleanTitle(chat.title || selected.title || '') || (selected.id ? '' : 'New chat')

  // Needs you: the requests this window holds, and every profile's waiting list.
  const requests = useRequests()
  const profiles = useMemo(() => [...new Set((list.rows ?? []).map(r => r.profile ?? ''))].sort(), [list.rows])
  const waiting = useWaiting(connected, profiles)
  const waitingRows = useMemo(() => unmatchedWaiting(waiting.rows, requests), [waiting.rows, requests])
  const needsCount = requests.length + waitingRows.length
  const openRequests = useMemo(() => requests.filter(r => r.sessionId && r.sessionId === chat.liveId), [requests, chat.liveId])

  /** Chat titles by live id, for a request's card outside its chat. */
  const titles = useRef(new Map<string, string>())
  if (chat.liveId && title) titles.current.set(chat.liveId, title)
  const titleFor = useCallback(
    (sessionId: string) =>
      titles.current.get(sessionId) ?? waiting.rows.find(row => row.sessionIds.includes(sessionId))?.title,
    [waiting.rows]
  )

  const openWaiting = useCallback(
    (row: WaitingRow) => {
      const known = (list.rows ?? []).find(r => row.sessionIds.includes(r.id))
      setSelected({ id: known?.id ?? row.sessionIds[0] ?? null, profile: known?.profile ?? row.profile, title: known?.title ?? row.title })
      setSection('chats')
    },
    [list.rows]
  )
  return (
    <>
      {status.phase !== 'open' ? (
        <div className="banner" role="status">
          <span className="dot warn" />
          {status.phase === 'connecting'
            ? 'Connecting to Hermes…'
            : `${status.error ?? 'Not connected.'}${status.retryInSeconds ? ` Trying again in ${status.retryInSeconds}s.` : ''}`}
          {status.phase === 'reconnecting' ? <button onClick={() => void window.conduit.reconnect()}>Try now</button> : null}
        </div>
      ) : null}
      <div className="body">
        <nav className="rail" aria-label="Sections">
          <button
            className="railbtn"
            aria-label="Chats"
            aria-current={section === 'chats' ? 'page' : undefined}
            onClick={() => setSection('chats')}
          >
            <Icon name="chats" />
          </button>
          <button
            className="railbtn"
            aria-label={needsCount ? `Needs you, ${needsCount}` : 'Needs you'}
            title="Needs you"
            aria-current={section === 'needs' ? 'page' : undefined}
            onClick={() => setSection('needs')}
          >
            <Icon name="bell" />
            {needsCount ? <span className="badge">{needsCount > 99 ? '99+' : needsCount}</span> : null}
          </button>
          <span className="spacer" />
          <button
            className="railbtn"
            aria-label="Settings"
            aria-current={section === 'settings' ? 'page' : undefined}
            onClick={() => setSection('settings')}
          >
            <Icon name="settings" />
          </button>
          <span
            className={`dot${connected ? '' : ' warn'}`}
            role="img"
            aria-label={connected ? 'Connected' : 'Not connected'}
            title={connected ? `Connected to ${status.hostLabel}` : 'Not connected'}
          />
        </nav>
        {section === 'chats' ? (
          <>
            <ChatList
              rows={list.rows}
              error={list.error}
              selectedId={chat.storedId ?? selected.id}
              runningIds={runningIds}
              runningStatus={transcript.status}
              onSelect={(row: ChatRow) => setSelected({ id: row.id, profile: row.profile, title: row.title })}
              onNewChat={newChat}
            />
            <main className="chat">
              <div className="chat-head">{title ? <div className="chat-title">{title}</div> : null}</div>
              <Transcript state={transcript} loading={loading} error={error} requests={openRequests} />
              <Composer
                placeholder="Message Hermes…"
                running={transcript.running}
                disabled={!connected}
                model={chat.model}
                cwd={chat.cwd}
                onSend={text => void onSend(text)}
                onStop={() => void stop()}
                focusKey={selected.id ?? 'new'}
              />
            </main>
          </>
        ) : section === 'needs' ? (
          <NeedsYou
            requests={requests}
            waiting={waitingRows}
            listAvailable={waiting.available}
            titleFor={titleFor}
            onOpen={openWaiting}
            onOpenLive={sessionId => {
              if (sessionId === chat.liveId) setSection('chats')
            }}
            openLiveId={chat.liveId}
          />
        ) : (
          <Settings status={status} />
        )}
      </div>
    </>
  )
}

function Settings({ status }: { status: ConnectionStatus }) {
  const methods = { password: 'User name and password', token: 'Session token', open: 'No sign-in' }
  return (
    <main className="settings">
      <h1>Settings</h1>
      <dl>
        <dt>Dashboard</dt>
        <dd>{status.url}</dd>
        <dt>Signed in with</dt>
        <dd>
          {status.method ? methods[status.method] : '—'}
          {status.username ? ` (${status.username})` : ''}
        </dd>
        <dt>Connection</dt>
        <dd>
          {status.phase === 'open' ? 'Connected' : status.phase}
          {status.phase === 'open' && status.sessionAuthority ? ' · session authority' : ''}
        </dd>
      </dl>
      <button className="secondary" onClick={() => void window.conduit.signOut()}>
        Sign out
      </button>
    </main>
  )
}
