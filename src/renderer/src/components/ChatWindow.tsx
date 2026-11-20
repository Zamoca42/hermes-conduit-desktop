import { useEffect, useState } from 'react'
import type { ChatWindowRequest, ConnectionStatus } from '@shared/ipc'
import { useChatDisplay } from '../state/display'
import { useBots } from '../state/useBots'
import { BesideChatPane } from './BesideChat'
import { BotAvatar } from './BotsHome'

/**
 * A chat in a window of its own, after the phone's V2ChatWindow: the pane's
 * rows and message box, and Open in Main Window, which opens the chat there
 * and closes this window. A sign-out or a lock closes it.
 */
export function ChatWindow({ chat }: { chat: ChatWindowRequest }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  useEffect(() => {
    const off = window.conduit.onStatus(setStatus)
    void window.conduit.status().then(s => setStatus(current => current ?? s))
    return off
  }, [])
  const connected = status?.phase === 'open'
  const display = useChatDisplay(chat.profile, connected, true)
  // The chat's bot, for the face on each reply as in the main window.
  const bot = useBots(connected).bots?.find(b => b.name === (chat.profile ?? 'default'))
  useEffect(() => {
    document.title = chat.title || 'Conduit'
  }, [chat.title])
  useEffect(() => {
    if (status && (status.phase === 'locked' || status.phase === 'signed-out' || !status.url)) window.close()
  }, [status])
  if (!status?.url) return <div className="chat-window-page" />
  return (
    <div className="chat-window-page">
      <BesideChatPane
        chat={chat}
        sessionAuthority={status.sessionAuthority === true}
        connected={connected}
        author={chat.author ?? 'Hermes'}
        display={display}
        face={bot ? moving => <BotAvatar bot={bot} size={22} moving={moving} /> : undefined}
        onOpenInMain={() => {
          window.conduit.openChat({ storedId: chat.id, profile: chat.profile, title: chat.title })
          window.close()
        }}
      />
    </div>
  )
}
