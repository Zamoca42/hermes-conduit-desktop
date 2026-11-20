import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import type { BotWork } from '../state/useWork'
import { shownTitle, sideWorkstreams, statusText, needsYou, type WorkItem, type WorkSnapshot } from '../state/work'
import { BotAvatar, workPill } from './BotsHome'

/**
 * The sidebar while a bot opened from Bots home is on screen, as the iPad's
 * Bots column stays beside an open Bot Chat: the bots, the open one ringed,
 * and under it its workstreams. A bot opens its Bot Chat, a workstream its
 * chat; Chats in the rail goes back to the sessions list.
 */
export function BotSideList({
  bots,
  profile,
  selectedId,
  work,
  workByBot,
  host,
  onOpenBot,
  onOpenWork,
  onBotsHome
}: {
  bots: Bot[]
  /** The open bot's profile. */
  profile: string
  selectedId: string | null
  /** The open bot's work. */
  work: WorkSnapshot | null | undefined
  workByBot: ReadonlyMap<string, BotWork>
  host?: string
  onOpenBot: (bot: Bot) => void
  onOpenWork: (item: WorkItem) => void
  onBotsHome: () => void
}) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const shown = bots.filter(bot => !bot.hidden || same(bot.name, profile))
  const streams = sideWorkstreams(work)
  return (
    <section className="chatlist bot-side" aria-label={t('Bots')}>
      <div className="chatlist-head">
        <h1>
          <button className="bot-side-home" title={t('Bots')} onClick={onBotsHome}>
            {t('Bots')}
          </button>
        </h1>
      </div>
      <div className="chatlist-scroll">
        {shown.map(bot => {
          const open = same(bot.name, profile)
          const pill = workPill(workByBot.get(bot.name))
          return (
            <div key={bot.name} className="bot-side-group">
              <button className={`row bot-side-bot${open ? ' open' : ''}`} aria-current={open && selectedId === (bot.botChatId ?? null) ? 'true' : undefined} onClick={() => onOpenBot(bot)}>
                <span className="bot-side-face">
                  <BotAvatar bot={bot} size={30} host={host} />
                </span>
                <span className="bot-side-text">
                  <span className="row-title">{bot.title}</span>
                  {pill ? <span className={`meta bot-side-pill${pill.needs ? ' needs' : ''}`}>{pill.text}</span> : bot.lastLine ? <span className="meta">{bot.lastLine}</span> : null}
                </span>
              </button>
              {open && streams.length ? (
                <div className="bot-side-work" role="group" aria-label={t('{bot}’s work', { bot: bot.title })}>
                  {streams.map(item => (
                    <button
                      key={item.ref}
                      className="row bot-side-stream"
                      aria-current={selectedId === item.sessionId ? 'true' : undefined}
                      onClick={() => onOpenWork(item)}
                    >
                      <span className="row-title">{shownTitle(item)}</span>
                      <span className={`meta${needsYou(item) ? ' bot-side-pill needs' : ''}`}>{statusText(item)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
