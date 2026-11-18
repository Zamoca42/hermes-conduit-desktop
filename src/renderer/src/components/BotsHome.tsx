import { useState, type FormEvent } from 'react'
import { timeLabel } from '../state/chats'
import { botColor, homeLayout, keptColor, type Bot } from '../state/bots'
import { starterFace } from '../state/starterFaces'
import { useAvatar } from '../state/useBots'
import { Icon } from './icons'
import { StarterFaceArt } from './StarterFaceArt'

/** A bot's picture, else its starter face (on the color Hermes keeps for it, when it has one). */
export function BotAvatar({ bot, size }: { bot: Bot; size: number }) {
  const url = useAvatar(bot.name, bot.hasAvatar)
  const color = botColor(bot)
  return (
    <span
      className="bot-avatar"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 25%, transparent)` }}
      aria-hidden="true"
    >
      {url ? <img src={url} alt="" draggable={false} /> : <StarterFaceArt face={starterFace(bot.face)} background={keptColor(bot.color)} />}
    </span>
  )
}

interface Props {
  bots: Bot[] | null
  error: string | null
  runningProfiles: ReadonlySet<string>
  onOpen: (bot: Bot) => void
  onAsk: (bot: Bot, text: string) => void
}

/**
 * Bots home: one bot gets the whole page with an Ask field, two sit side by
 * side, and more make a grid of portraits (the phone's layouts C, A and the
 * grid). A bot opens its Bot Chat.
 */
export function BotsHome({ bots, error, runningProfiles, onOpen, onAsk }: Props) {
  const layout = homeLayout(bots?.length ?? 0)
  return (
    <main className="bots">
      <div className={`bots-inner ${layout}`}>
        <h1>Bots</h1>
        {bots === null && !error ? <div className="empty">Loading your bots…</div> : null}
        {error ? <div className="empty">Couldn’t load your bots: {error}</div> : null}
        {bots && layout === 'one' && bots[0] ? (
          <OneBot bot={bots[0]} running={runningProfiles.has(bots[0].name)} onOpen={onOpen} onAsk={onAsk} />
        ) : null}
        {bots && layout !== 'one' ? (
          <div className={layout === 'two' ? 'bots-two' : 'bots-grid'}>
            {bots.map(bot => (
              <BotTile key={bot.name} bot={bot} large={layout === 'two'} running={runningProfiles.has(bot.name)} onOpen={onOpen} />
            ))}
          </div>
        ) : null}
      </div>
    </main>
  )
}

function OneBot({ bot, running, onOpen, onAsk }: { bot: Bot; running: boolean; onOpen: (bot: Bot) => void; onAsk: (bot: Bot, text: string) => void }) {
  const [text, setText] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    onAsk(bot, text.trim())
    setText('')
  }
  return (
    <section className="bot-hero">
      <button className="bot-hero-face" onClick={() => onOpen(bot)} aria-label={`Open ${bot.title}`}>
        <BotAvatar bot={bot} size={168} />
      </button>
      <h2>{bot.title}</h2>
      {running ? <span className="running">Working</span> : bot.description ? <p className="meta">{bot.description}</p> : null}
      {bot.lastLine ? (
        <button className="bot-last" onClick={() => onOpen(bot)}>
          <span>{bot.lastLine}</span>
          {bot.lastActive ? <span className="meta">{timeLabel(bot.lastActive)}</span> : null}
        </button>
      ) : null}
      <form className="bot-ask" onSubmit={submit}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={`Ask ${bot.title}…`} aria-label={`Ask ${bot.title}`} />
        <button type="submit" className="round send" aria-label="Send" disabled={!text.trim()}>
          <Icon name="send" />
        </button>
      </form>
    </section>
  )
}

function BotTile({ bot, large, running, onOpen }: { bot: Bot; large: boolean; running: boolean; onOpen: (bot: Bot) => void }) {
  return (
    <button className={`bot-tile${large ? ' large' : ''}`} onClick={() => onOpen(bot)}>
      <BotAvatar bot={bot} size={large ? 128 : 84} />
      <span className="bot-name">
        {bot.pinned ? <span className="pin" aria-label="Pinned">•</span> : null}
        {bot.title}
      </span>
      {running ? (
        <span className="running">Working</span>
      ) : (
        <span className="meta bot-line">{bot.lastLine ?? bot.description ?? (bot.model ? bot.model : 'No chats yet')}</span>
      )}
      {bot.lastActive ? <span className="meta bot-time">{timeLabel(bot.lastActive)}</span> : null}
    </button>
  )
}
