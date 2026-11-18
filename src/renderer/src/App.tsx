import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { gateway } from './gateway'
import type { ConnectionStatus, LanguageChoice } from '@shared/ipc'
import { BotsHome } from './components/BotsHome'
import { ChatList } from './components/ChatList'
import { Composer } from './components/Composer'
import { ModelPicker } from './components/ModelPicker'
import { ContextPanel } from './components/ContextPanel'
import { RoomView } from './components/RoomView'
import { Tasks } from './components/Tasks'
import { PulsePage } from './components/PulsePage'
import { FilesPanel } from './components/FilesPanel'
import { absolutePath, pathForDraft } from './state/workspace'
import { FileLinks } from './components/Markdown'
import { usePulse } from './state/usePulse'
import { Icon } from './components/icons'
import { NeedsYou } from './components/NeedsYou'
import { SignIn } from './components/SignIn'
import { TitleBar, hostName } from './components/TitleBar'
import { Transcript, prefillRequest, quoteRequest } from './components/Transcript'
import type { Bot } from './state/bots'
import type { ChatRow } from './state/chats'
import { forgetAvatars, useBots } from './state/useBots'
import type { Room } from './state/groups'
import { useRooms } from './state/useGroups'
import { useChat } from './state/useChat'
import { useChatList } from './state/useChatList'
import { unmatchedWaiting, type WaitingRow } from './state/needsYou'
import { useRequests, useWaiting } from './state/useNeedsYou'
import { isWatching, notificationsEnabled, requestNotification, setNotificationsEnabled, turnNotification, type ChatRef, type NotificationSpec } from './state/notifications'
import { cleanTitle } from './state/text'
import type { StagedAttachment } from './state/attachments'
import type { QuoteRequest } from './state/quote'
import { looksLikeSlashCommand } from './state/slash'
import { UsagePage } from './components/UsagePage'
import { VoiceCall } from './components/VoiceCall'
import { readAloud, readsRepliesAloud, setReadsRepliesAloud } from './state/readAloud'
import { useCommands } from './state/useCommands'
import { mutateSession } from './state/chatActions'
import { loadMarks, markRead, markUnread, saveMarks, toggleStar, isUnread, type ChatMarks } from './state/chatMarks'
import { LANGUAGES, LANGUAGE_NAMES, t } from '@shared/i18n'

export function App() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)

  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])

  const [adding, setAdding] = useState(false)
  // A new host signed in (or the sign-in screen otherwise left): back to the app.
  const url = status?.url
  useEffect(() => setAdding(false), [url])

  if (!status) return <div className="app" />
  const signedOut = status.phase === 'signed-out' || (status.phase === 'failed' && !status.url)
  return (
    <div className="app">
      <TitleBar
        subtitle={signedOut ? undefined : status.hostLabel}
        hosts={status.hosts}
        currentUrl={status.url}
        onSwitch={url => void window.conduit.switchHost(url)}
      />
      {adding ? (
        <SignIn onCancel={() => setAdding(false)} />
      ) : signedOut || status.phase === 'failed' ? (
        <SignIn notice={status.error} />
      ) : (
        // Each host gets a fresh window state: its chats, bots and rooms are its own.
        <Shell key={status.url} status={status} onAddHost={() => setAdding(true)} />
      )}
    </div>
  )
}

type Section = 'bots' | 'room' | 'chats' | 'tasks' | 'pulse' | 'needs' | 'settings'

const REOPEN_SECTION = 'conduit.reopen-section'

/** Settings after a language change reloads the window, else Chats. */
function reopenedSection(): Section {
  try {
    const saved = sessionStorage.getItem(REOPEN_SECTION)
    sessionStorage.removeItem(REOPEN_SECTION)
    return saved === 'settings' ? 'settings' : 'chats'
  } catch {
    return 'chats'
  }
}

function Shell({ status, onAddHost }: { status: ConnectionStatus; onAddHost: () => void }) {
  // Before any picture is read for this host.
  useState(forgetAvatars)
  const connected = status.phase === 'open'
  const [section, setSection] = useState<Section>(reopenedSection)
  const [selected, setSelected] = useState<{ id: string | null; profile?: string; title?: string; botChat?: boolean }>({ id: null })
  const list = useChatList(connected)
  const { transcript, chat, loading, error, send, stop, command, setModel, setReasoning, setSpeed, setYolo } = useChat(
    selected.id,
    selected.profile,
    status.sessionAuthority === true,
    connected
  )

  // The chat list's profile: a new chat starts in it.
  const [chatProfile, setChatProfile] = useState<string | null>(null)
  const chatProfileRef = useRef(chatProfile)
  const chatPane = useRef<HTMLElement>(null)
  chatProfileRef.current = chatProfile
  const newChat = useCallback(() => {
    setSection('chats')
    setSelected({ id: null, profile: chatProfileRef.current ?? undefined })
  }, [])

  // ⌘N comes from the Mac's menu bar (so Ctrl+N stays the text field's next line there); Ctrl+N elsewhere.
  useEffect(() => {
    const offMenu = window.conduit.onMenu(action => {
      if (action === 'new-chat') newChat()
      else if (action === 'needs-you') setSection('needs')
    })
    const offOpen = window.conduit.onOpenChat(ref => {
      setSelected({ id: ref.storedId, profile: ref.profile, title: ref.title })
      setSection('chats')
    })
    if (window.conduit.platform === 'darwin') {
      return () => {
        offMenu()
        offOpen()
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        newChat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offMenu()
      offOpen()
      window.removeEventListener('keydown', onKey)
    }
  }, [newChat])

  const runningIds = useMemo(() => {
    const ids = new Set<string>()
    if (transcript.running && chat.storedId) ids.add(chat.storedId)
    return ids
  }, [transcript.running, chat.storedId])

  const roster = useBots(connected)
  const botTitle = roster.bots?.find(b => b.name === (selected.profile ?? 'default'))?.title ?? 'Hermes'
  const [quote, setQuote] = useState<QuoteRequest | null>(null)
  // A quote lands in the composer it was made for, not again on the way back to Chats.
  useEffect(() => {
    if (section !== 'chats') setQuote(null)
  }, [section])
  const pulse = usePulse(connected, section === 'pulse')
  // The Folder beside the chat: open until closed, for whichever chat has a folder.
  const [filesOpen, setFilesOpen] = useState(() => {
    try {
      return localStorage.getItem('conduit.filesOpen') === '1'
    } catch {
      return false
    }
  })
  const showFiles = useCallback((open: boolean) => {
    setFilesOpen(open)
    try {
      localStorage.setItem('conduit.filesOpen', open ? '1' : '0')
    } catch {
      // Kept for this window only.
    }
  }, [])
  // A file path in a reply opens in the Folder.
  const [reveal, setReveal] = useState<{ path: string; id: number } | null>(null)
  const cwd = chat.cwd
  const openPath = useMemo(
    () => (cwd ? (path: string) => {
      setReveal(current => ({ path: absolutePath(path, cwd), id: (current?.id ?? 0) + 1 }))
      showFiles(true)
    } : null),
    [cwd, showFiles]
  )
  // Each reply's end reads the open folders again: the agent may have changed files.
  const [turnsDone, setTurnsDone] = useState(0)
  const [calling, setCalling] = useState(false)
  // A call is the open chat's: another chat, or another screen, ends it. A
  // new chat getting its id from the call's first message is the same chat.
  const callChat = useRef(selected.id)
  useEffect(() => {
    const was = callChat.current
    callChat.current = selected.id
    if (was !== null && was !== selected.id) setCalling(false)
  }, [selected.id])
  useEffect(() => setCalling(false), [selected.profile, section])
  // Read replies aloud: the open chat's reply, as its turn ends, unless a call speaks it.
  const readTurn = useRef(turnsDone)
  useEffect(() => {
    if (readTurn.current === turnsDone) return
    readTurn.current = turnsDone
    if (!calling && readsRepliesAloud() && lastReplyRef.current && document.hasFocus())
      void readAloud(`turn-${turnsDone}`, lastReplyRef.current, selected.profile).catch(() => undefined)
  }, [turnsDone])
  const lastReplyRef = useRef<string | null>(null)
  const lastReply = useMemo(() => {
    for (let i = transcript.items.length - 1; i >= 0; i--) {
      const item = transcript.items[i]!
      if (item.kind === 'user') return null
      if (item.kind === 'assistant' && item.text.trim()) return item.text
    }
    return null
  }, [transcript.items])
  lastReplyRef.current = lastReply
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !transcript.running) setTurnsDone(n => n + 1)
    wasRunning.current = transcript.running
  }, [transcript.running])
  const pulseChat = pulse.feed?.homeChatId || null
  // Pulse's own chat stays behind its screen, as on the phone.
  const listedRows = useMemo(() => (pulseChat && list.rows ? list.rows.filter(row => row.id !== pulseChat) : list.rows), [list.rows, pulseChat])
  const [modelOpen, setModelOpen] = useState(false)
  const closeModel = useCallback(() => setModelOpen(false), [])
  const [contextOpen, setContextOpen] = useState(false)
  const closeContext = useCallback(() => setContextOpen(false), [])
  useEffect(() => {
    setModelOpen(false)
    setContextOpen(false)
  }, [selected.id])
  /** A row's Pin, Rename or Delete: shown at once, put back with the reason when Hermes refuses it. */
  const chatAction = useCallback(
    async (row: ChatRow, patch: { pinned?: boolean; title?: string } | null) => {
      list.patchRow(row.id, patch)
      if (patch === null && (selected.id === row.id || chat.storedId === row.id)) newChat()
      try {
        await mutateSession(gateway.http, row.id, row.profile, patch)
      } catch (e) {
        window.alert(t('Couldn’t change “{title}”: {reason}', { title: row.title, reason: e instanceof Error ? e.message : String(e) }))
      }
      list.refresh()
    },
    [list, selected.id, chat.storedId, newChat]
  )
  // Stars and read state: on this computer, per host. Hermes' own unread flag is cleared too.
  const markHost = status.url ?? ''
  const [marks, setMarks] = useState<ChatMarks>(() => loadMarks(markHost))
  useEffect(() => setMarks(loadMarks(markHost)), [markHost])
  const updateMarks = useCallback(
    (change: (current: ChatMarks) => ChatMarks) =>
      setMarks(current => {
        const next = change(current)
        if (next !== current) saveMarks(markHost, next)
        return next
      }),
    [markHost]
  )
  const writeUnread = useCallback((row: ChatRow, unread: boolean) => {
    void mutateSession(gateway.http, row.id, row.profile, { unread }).catch(() => undefined)
  }, [])
  const openId = chat.storedId ?? selected.id
  const openRow = openId ? list.rows?.find(row => row.id === openId) : undefined
  useEffect(() => {
    if (!openRow) return
    updateMarks(current => markRead(current, openRow))
    if (openRow.unread) writeUnread(openRow, false)
  }, [openRow?.id, openRow?.activeAt, openRow?.unread, updateMarks, writeUnread])
  const toggleRead = useCallback(
    (row: ChatRow) => {
      const unread = isUnread(marks, row)
      updateMarks(current => (unread ? markRead(current, row) : markUnread(current, row)))
      if (unread ? row.unread : !row.unread) writeUnread(row, !unread)
    },
    [marks, updateMarks, writeUnread]
  )
  const commands = useCommands(selected.profile ?? chatProfile ?? undefined, connected)
  const onSend = useCallback(
    async (text: string, attachments: StagedAttachment[] = []) => {
      let created: string | null
      if (looksLikeSlashCommand(text) && !attachments.length) {
        const outcome = await command(text, commands)
        if (outcome.kind === 'new') return newChat()
        if (outcome.kind === 'model') setModelOpen(true)
        if (outcome.kind === 'prefill') setQuote(prefillRequest(outcome.text, botTitle))
        created = outcome.created
      } else {
        created = await send(text, attachments)
      }
      if (created) {
        setSelected(s => ({ ...s, id: created }))
        void list.refresh()
      }
    },
    [send, command, commands, newChat, list, botTitle]
  )

  // A Bot Chat goes by its bot's name: Hermes titles every one "Bot Chat".
  const title = selected.botChat && selected.title ? selected.title : cleanTitle(chat.title || selected.title || '') || (selected.id ? '' : t('New chat'))

  // Bots home: a bot opens its Bot Chat (or a new chat in its profile); Ask sends there once it's open.
  const openBot = useCallback((bot: Bot) => {
    setSelected({ id: bot.botChatId ?? null, profile: bot.name, title: bot.title, botChat: !!bot.botChatId })
    setSection('chats')
  }, [])
  // Picking a bot on the strip opens its newest chat (its Bot Chat, which the list leaves out, when
  // that's newer), or a new chat when it has none, so the open chat matches the list.
  const chooseProfile = useCallback(
    (next: string | null) => {
      setChatProfile(next)
      if (!next) return
      const same = (name: string | undefined) => (name ?? 'default').toLowerCase() === next.toLowerCase()
      if (same(selected.profile)) return
      const newest = (list.rows ?? []).filter(row => same(row.profile)).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))[0]
      const bot = roster.bots?.find(b => same(b.name))
      if (bot?.botChatId && (bot.lastActive ?? 0) >= (newest?.activeAt ?? 0)) return openBot(bot)
      setSelected(newest ? { id: newest.id, profile: newest.profile, title: newest.title } : { id: null, profile: next })
    },
    [selected.profile, list.rows, roster.bots, openBot]
  )
  const pendingAsk = useRef<{ text: string; storedId: string | null; profile: string; resumed?: boolean } | null>(null)
  const askBot = useCallback(
    (bot: Bot, text: string) => {
      pendingAsk.current = { text, storedId: bot.botChatId ?? null, profile: bot.name }
      openBot(bot)
    },
    [openBot]
  )
  useEffect(() => {
    const ask = pendingAsk.current
    if (!ask || ask.profile !== selected.profile || ask.storedId !== selected.id) return
    if (ask.storedId) {
      // A Bot Chat waits until it has resumed (this render may still hold the chat open before it).
      if (loading) {
        ask.resumed = true
        return
      }
      if (error && ask.resumed) {
        pendingAsk.current = null
        return
      }
      if (!chat.liveId || (chat.storedId !== ask.storedId && !ask.resumed)) return
    }
    pendingAsk.current = null
    void onSend(ask.text)
  }, [selected, loading, error, chat.liveId, chat.storedId, onSend])
  const groupRooms = useRooms(connected)
  const [openRoom, setOpenRoom] = useState<Room | null>(null)
  const showRoom = useCallback((room: Room) => {
    setOpenRoom(room)
    setSection('room')
  }, [])
  const runningProfiles = useMemo(() => {
    const names = new Set<string>()
    if (transcript.running && selected.profile) names.add(selected.profile)
    return names
  }, [transcript.running, selected.profile])

  // Needs you: the requests this window holds, and every profile's waiting list.
  const requests = useRequests()
  const profiles = useMemo(() => [...new Set((list.rows ?? []).map(r => r.profile ?? ''))].sort(), [list.rows])
  const waiting = useWaiting(connected, profiles)
  const waitingRows = useMemo(() => unmatchedWaiting(waiting.rows, requests), [waiting.rows, requests])
  const needsCount = requests.length + waitingRows.length
  const openRequests = useMemo(() => requests.filter(r => r.sessionId && r.sessionId === chat.liveId), [requests, chat.liveId])

  /** The chats this window opened, by live id: a request's card outside its chat, and a notification's click. */
  const chats = useRef(new Map<string, ChatRef>())
  if (chat.liveId) chats.current.set(chat.liveId, { storedId: chat.storedId, profile: selected.profile, title: title || undefined })
  const titleFor = useCallback(
    (sessionId: string) =>
      chats.current.get(sessionId)?.title ?? waiting.rows.find(row => row.sessionIds.includes(sessionId))?.title,
    [waiting.rows]
  )

  // The tray's count and the Dock's badge.
  useEffect(() => window.conduit.setWaiting(needsCount), [needsCount])

  // Notifications for what happens in a chat the user isn't looking at.
  const watching = useRef({ liveId: chat.liveId, onChats: section === 'chats' })
  watching.current = { liveId: chat.liveId, onChats: section === 'chats' }
  const notify = useCallback((spec: NotificationSpec, sessionId: string) => {
    if (!notificationsEnabled() || typeof Notification === 'undefined') return
    const n = new Notification(spec.title, { body: spec.body, tag: spec.tag, silent: false })
    n.onclick = () => {
      window.conduit.window.show()
      const ref = chats.current.get(sessionId)
      if (ref?.storedId) {
        setSelected({ id: ref.storedId, profile: ref.profile, title: ref.title })
        setSection('chats')
      } else {
        setSection('needs')
      }
    }
  }, [])
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        const sid = event.session_id
        if (!sid) return
        if (event.type === 'session.title') {
          const t = (event.payload as { title?: unknown } | undefined)?.title
          const ref = chats.current.get(sid)
          if (ref && typeof t === 'string') chats.current.set(sid, { ...ref, title: cleanTitle(t) })
          return
        }
        if (event.type !== 'message.complete' || isWatching(sid, watching.current.liveId, watching.current.onChats)) return
        const spec = turnNotification(sid, event.payload, chats.current.get(sid))
        if (spec) notify(spec, sid)
      }),
    [notify]
  )
  const notified = useRef(new Set<string>())
  useEffect(() => {
    for (const request of requests) {
      if (notified.current.has(request.id)) continue
      notified.current.add(request.id)
      if (isWatching(request.sessionId, watching.current.liveId, watching.current.onChats)) continue
      notify(requestNotification(request, chats.current.get(request.sessionId)), request.sessionId)
    }
  }, [requests, notify])

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
            ? t('Connecting to Hermes…')
            : `${status.error ?? t('Not connected.')}${status.retryInSeconds ? ` ${t('Trying again in {seconds}s.', { seconds: status.retryInSeconds })}` : ''}`}
          {status.phase === 'reconnecting' ? <button onClick={() => void window.conduit.reconnect()}>{t('Try now')}</button> : null}
        </div>
      ) : null}
      <div className="body">
        <nav className="rail" aria-label={t('Sections')}>
          <button
            className="railbtn"
            aria-label={t('Bots')}
            title={t('Bots')}
            aria-current={section === 'bots' || section === 'room' ? 'page' : undefined}
            onClick={() => setSection('bots')}
          >
            <Icon name="bots" />
          </button>
          <button
            className="railbtn"
            aria-label={t('Chats')}
            title={t('Chats')}
            aria-current={section === 'chats' ? 'page' : undefined}
            onClick={() => setSection('chats')}
          >
            <Icon name="chats" />
          </button>
          <button
            className="railbtn"
            aria-label={t('Tasks')}
            title={t('Tasks')}
            aria-current={section === 'tasks' ? 'page' : undefined}
            onClick={() => setSection('tasks')}
          >
            <Icon name="tasks" />
          </button>
          <button
            className="railbtn"
            aria-label={pulse.feed?.unseen ? t('Pulse, new cards') : t('Pulse')}
            title={t('Pulse')}
            aria-current={section === 'pulse' ? 'page' : undefined}
            onClick={() => setSection('pulse')}
          >
            <Icon name="pulse" />
            {pulse.feed?.unseen && section !== 'pulse' ? <span className="badge">{pulse.feed.unseen > 99 ? '99+' : pulse.feed.unseen}</span> : null}
          </button>
          <button
            className="railbtn"
            aria-label={needsCount ? t('Needs you, {count}', { count: needsCount }) : t('Needs you')}
            title={t('Needs you')}
            aria-current={section === 'needs' ? 'page' : undefined}
            onClick={() => setSection('needs')}
          >
            <Icon name="bell" />
            {needsCount ? <span className="badge">{needsCount > 99 ? '99+' : needsCount}</span> : null}
          </button>
          <span className="spacer" />
          <button
            className="railbtn"
            aria-label={t('Settings')}
            title={t('Settings')}
            aria-current={section === 'settings' ? 'page' : undefined}
            onClick={() => setSection('settings')}
          >
            <Icon name="settings" />
          </button>
          <span
            className={`dot${connected ? '' : ' warn'}`}
            role="img"
            aria-label={connected ? t('Connected') : t('Not connected')}
            title={connected ? t('Connected to {host}', { host: status.hostLabel ?? '' }) : t('Not connected')}
          />
        </nav>
        {section === 'chats' ? (
          <>
            <ChatList
              rows={listedRows}
              error={list.error}
              selectedId={chat.storedId ?? selected.id}
              runningIds={runningIds}
              runningStatus={transcript.status}
              onSelect={(row: ChatRow) => setSelected({ id: row.id, profile: row.profile, title: row.title })}
              onNewChat={newChat}
              bots={roster.bots}
              profile={chatProfile}
              onProfile={chooseProfile}
              onPin={row => void chatAction(row, { pinned: !row.pinned })}
              onRename={(row, title) => void chatAction(row, { title })}
              marks={marks}
              onStar={row => updateMarks(current => toggleStar(current, row))}
              onToggleRead={toggleRead}
              onDelete={row => {
                if (window.confirm(`${t('Delete conversation?')}\n\n${t('This permanently deletes the conversation and cannot be undone.')}`)) void chatAction(row, null)
              }}
            />
            <main className="chat" ref={chatPane}>
              <div className="chat-head">
                {title ? <div className="chat-title">{title}</div> : null}
                <div className="chat-head-actions">
                  <button
                    className={`chat-head-button${calling ? ' on' : ''}`}
                    aria-label={calling ? t('End call') : t('Voice call')}
                    title={calling ? t('End call') : t('Voice call')}
                    disabled={!connected && !calling}
                    onClick={() => setCalling(on => !on)}
                  >
                    <Icon name={calling ? 'phoneDown' : 'phone'} />
                  </button>
                  {chat.cwd && !filesOpen ? (
                    <button className="chat-head-button" aria-label={t('Files')} title={t('Files')} onClick={() => showFiles(true)}>
                      <Icon name="folder" />
                    </button>
                  ) : null}
                </div>
              </div>
              <FileLinks.Provider value={openPath}>
              <Transcript
                state={transcript}
                loading={loading}
                error={error}
                requests={openRequests}
                profile={selected.profile}
                author={botTitle}
                onQuote={setQuote}
                onCommand={text => void onSend(text)}
              />
              </FileLinks.Provider>
              {contextOpen && chat.liveId ? (
                <ContextPanel chat={chat} profile={selected.profile} running={transcript.running} onClose={closeContext} onCompress={() => void onSend('/compress')} />
              ) : null}
              {modelOpen && chat.liveId ? (
                <ModelPicker
                  chat={chat}
                  profile={selected.profile}
                  onClose={closeModel}
                  setModel={setModel}
                  setReasoning={setReasoning}
                  setSpeed={setSpeed}
                  setYolo={setYolo}
                />
              ) : null}
              {calling ? (
                <VoiceCall
                  profile={selected.profile}
                  onSay={words => void onSend(words)}
                  running={transcript.running}
                  turnsDone={turnsDone}
                  lastReply={lastReply}
                  onStop={() => void stop()}
                  onEnd={() => setCalling(false)}
                />
              ) : null}
              <Composer
                placeholder={t('Message {name}…', { name: botTitle })}
                quote={quote}
                commands={commands}
                onModel={
                  chat.liveId
                    ? () => {
                        setContextOpen(false)
                        setModelOpen(open => !open)
                      }
                    : undefined
                }
                context={chat.context}
                onContext={
                  chat.liveId
                    ? () => {
                        setModelOpen(false)
                        setContextOpen(open => !open)
                      }
                    : undefined
                }
                running={transcript.running}
                disabled={!connected}
                model={chat.model}
                cwd={chat.cwd}
                onSend={(text, attachments) => void onSend(text, attachments)}
                onStop={() => void stop()}
                focusKey={selected.id ?? 'new'}
                canAttach
                dropZone={chatPane}
                voice={calling ? undefined : { profile: selected.profile }}
              />
            </main>
            {filesOpen && chat.cwd ? (
              <FilesPanel
                root={chat.cwd}
                profile={selected.profile}
                refreshKey={turnsDone}
                reveal={reveal}
                onInsertPath={path => setQuote(quoteRequest({ insert: pathForDraft(path) }))}
                onClose={() => showFiles(false)}
              />
            ) : null}
          </>
        ) : section === 'bots' ? (
          <BotsHome
            bots={roster.bots}
            error={roster.error}
            runningProfiles={runningProfiles}
            rooms={groupRooms.rooms}
            canStartRooms={groupRooms.capabilities?.supported === true && connected}
            onOpen={openBot}
            onAsk={askBot}
            onOpenRoom={showRoom}
            onCreateRoom={groupRooms.create}
          />
        ) : section === 'tasks' ? (
          <Tasks
            bots={roster.bots}
            connected={connected}
            profile={chatProfile}
            // Only the list's profile: picking one here doesn't open its chats.
            onProfile={setChatProfile}
            onOpenRun={(run, job) => {
              if (!run.id) return
              setSelected({ id: run.id, profile: run.profile ?? job.profile, title: run.title })
              setSection('chats')
            }}
          />
        ) : section === 'pulse' ? (
          <PulsePage
            pulse={pulse}
            onOpenChat={(target, draft) => {
              setSelected({ id: target.id, profile: target.profile, title: target.title })
              setSection('chats')
              if (draft) setQuote(quoteRequest({ draft }))
            }}
            onOpenBoard={() => setSection('tasks')}
          />
        ) : section === 'room' && openRoom ? (
          <RoomView key={openRoom.roomId} room={openRoom} bots={roster.bots ?? []} connected={connected} canStop={groupRooms.capabilities?.canStop === true} canAttach={groupRooms.capabilities?.attachments === true} />
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
          <Settings
            status={status}
            onAddHost={onAddHost}
            bots={(roster.bots ?? []).map(bot => ({ name: bot.name, title: bot.title }))}
            profile={selected.profile ?? 'default'}
          />
        )}
      </div>
    </>
  )
}

function Settings({
  status,
  onAddHost,
  bots,
  profile
}: {
  status: ConnectionStatus
  onAddHost: () => void
  bots: { name: string; title: string }[]
  profile: string
}) {
  const [notifications, setNotifications] = useState(notificationsEnabled)
  const [readAloudOn, setReadAloudOn] = useState(readsRepliesAloud)
  const [page, setPage] = useState<'main' | 'usage'>('main')
  if (page === 'usage')
    return (
      <main className="settings">
        <UsagePage bots={bots} profile={profile} onBack={() => setPage('main')} />
      </main>
    )
  const methods = { password: t('User name and password'), token: t('Session token'), open: t('No sign-in') }
  return (
    <main className="settings">
      <h1>{t('Settings')}</h1>
      <dl>
        <dt>Hermes</dt>
        <dd>
          <ul className="hosts">
            {(status.hosts?.length ? status.hosts : status.url ? [{ url: status.url, method: status.method ?? 'open', username: status.username }] : []).map(host => (
              <li key={host.url} className={host.url === status.url ? 'current' : undefined}>
                <span className="host-label">{hostName(host.url)}</span>
                {host.username ? <span className="meta">{host.username}</span> : null}
                <span className="spacer" />
                {host.url === status.url ? (
                  <span className="meta">{t('In use')}</span>
                ) : (
                  <button className="link" onClick={() => void window.conduit.switchHost(host.url)}>
                    {t('Switch')}
                  </button>
                )}
                {host.url !== status.url ? (
                  <button
                    className="link danger"
                    onClick={() => {
                      if (window.confirm(t('Sign out of {host} on this computer?', { host: hostName(host.url) }))) void window.conduit.removeHost(host.url)
                    }}
                  >
                    {t('Sign out')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button className="link add-host" onClick={onAddHost}>
            {t('Add another Hermes…')}
          </button>
        </dd>
        <dt>{t('Dashboard')}</dt>
        <dd>{status.url}</dd>
        <dt>{t('Signed in with')}</dt>
        <dd>
          {status.method ? methods[status.method] : '—'}
          {status.username ? ` (${status.username})` : ''}
        </dd>
        <dt>{t('Usage')}</dt>
        <dd>
          <button className="link" disabled={status.phase !== 'open'} onClick={() => setPage('usage')}>
            {t('Tokens, cost and provider quota')}
          </button>
        </dd>
        <dt>{t('Notifications')}</dt>
        <dd>
          <label className="toggle">
            <input
              type="checkbox"
              checked={notifications}
              onChange={e => {
                setNotificationsEnabled(e.target.checked)
                setNotifications(e.target.checked)
              }}
            />
            {t('When a reply finishes or something needs you in a chat you’re not looking at')}
          </label>
        </dd>
        <dt>{t('Voice')}</dt>
        <dd>
          <label className="toggle">
            <input
              type="checkbox"
              checked={readAloudOn}
              onChange={e => {
                setReadsRepliesAloud(e.target.checked)
                setReadAloudOn(e.target.checked)
              }}
            />
            {t('Read replies aloud')}
          </label>
          <p className="meta settings-caption">{t('Each reply in the open chat is read aloud with Hermes’ voice as it finishes. Calls speak their own replies.')}</p>
        </dd>
        <dt>{t('Language')}</dt>
        <dd>
          <select
            className="language-select"
            value={window.conduit.language.choice}
            onChange={e => {
              // The window reloads in the new language; come back to Settings.
              try {
                sessionStorage.setItem(REOPEN_SECTION, 'settings')
              } catch {
                // Opens on Chats instead.
              }
              window.conduit.setLanguage(e.target.value as LanguageChoice)
            }}
            aria-label={t('Language')}
          >
            <option value="system">{t('Same as this computer')}</option>
            {LANGUAGES.map(language => (
              <option key={language} value={language} lang={language}>
                {LANGUAGE_NAMES[language]}
              </option>
            ))}
          </select>
        </dd>
        <dt>{t('Connection')}</dt>
        <dd>
          {status.phase === 'open' ? t('Connected') : status.phase === 'connecting' ? t('Connecting…') : t('Not connected')}
          {status.phase === 'open' && status.sessionAuthority ? ` · ${t('session authority')}` : ''}
        </dd>
      </dl>
      <button className="secondary" onClick={() => void window.conduit.signOut()}>
        {(status.hosts?.length ?? 0) > 1 ? t('Sign out of {host}', { host: status.hostLabel ?? '' }) : t('Sign out')}
      </button>
    </main>
  )
}
