import { useEffect, useMemo, useRef, useState } from 'react'
import { locale, t } from '@shared/i18n'
import {
  DOWN_REASONS,
  RESTS,
  actionMessage,
  backReason,
  backText,
  canAct,
  canBeDone,
  canPutAwayForGood,
  clearedTitle,
  hasChat,
  heading,
  isCleared,
  isHeld,
  isRatable,
  isResting,
  layout,
  lookedText,
  reasonTitle,
  refusalText,
  restTitle,
  stamp,
  tint,
  type PulseCard
} from '../state/pulse'
import type { PulseState } from '../state/usePulse'
import { Icon } from './icons'
import { Markdown } from './Markdown'
import { PulseSettings } from './PulseSettings'

interface Props {
  pulse: PulseState
  /** Opens a card's chat; with `draft`, left in its composer. A card from no chat gets a new chat in Pulse's profile. */
  onOpenChat: (target: { id: string | null; profile: string; title?: string }, draft?: string) => void
  /** Opens Tasks > Board, for a card from a Kanban task's worker. */
  onOpenBoard: () => void
}

type Menu = { kind: 'down' | 'later'; card: PulseCard; x: number; y: number }

/**
 * The Pulse screen, after the phone's: what's new since the last look, the
 * earlier cards, and Done and cleared, each card with its Why?, Do it, Done,
 * Not now and thumbs. Opening it marks every card seen.
 */
export function PulsePage({ pulse, onOpenChat, onOpenBoard }: Props) {
  const { feed, error, availability } = pulse
  const language = locale()
  // The cards unseen when the screen opened stay New until it's left.
  const [fresh, setFresh] = useState<Set<number> | null>(null)
  const [why, setWhy] = useState<Set<number>>(new Set())
  const [showCleared, setShowCleared] = useState(false)
  const [busy, setBusy] = useState<Set<number>>(new Set())
  const [note, setNote] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const seenSent = useRef(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (!feed || fresh) return
    setFresh(new Set(feed.cards.filter(card => !card.seenAt && !isCleared(card)).map(card => card.id)))
    if (!seenSent.current && feed.unseen > 0) {
      seenSent.current = true
      void pulse.markSeen().catch(() => undefined)
    }
  }, [feed, fresh, pulse])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const sections = useMemo(() => (feed ? layout(feed.cards, fresh ?? new Set()) : null), [feed, fresh])

  /** Runs a tap on a card; a refusal says why. */
  const act = async (card: PulseCard, action: () => Promise<unknown>) => {
    setBusy(current => new Set(current).add(card.id))
    setNote(null)
    try {
      await action()
    } catch (e) {
      setNote(refusalText(e))
    } finally {
      setBusy(current => {
        const next = new Set(current)
        next.delete(card.id)
        return next
      })
    }
  }

  const doIt = (card: PulseCard) => {
    const profile = card.profile || feed?.profile || 'default'
    if (hasChat(card)) onOpenChat({ id: card.chatId, profile, title: card.chatTitle || undefined }, actionMessage(card))
    else onOpenChat({ id: null, profile: feed?.profile ?? profile }, actionMessage(card))
    void pulse.acted(card.id).catch(() => undefined)
  }

  const cardView = (card: PulseCard) => {
    const cleared = isCleared(card)
    const isBusy = busy.has(card.id)
    const reason = backReason(card, Date.now(), language) ?? card.why
    const looked = lookedText(card, language)
    const explains = !!(reason || looked)
    return (
      <article key={card.id} className={`pulse-card${cleared ? ' cleared' : ''}`}>
        <div className="pulse-topic">
          <span className="pulse-dot" style={{ background: tint(card) }} />
          <span className="pulse-heading" style={{ color: tint(card) }}>
            {heading(card)}
          </span>
          {card.createdAt ? <span className="meta">· {stamp(card.createdAt, Date.now(), language)}</span> : null}
          {isHeld(card) ? <span className="meta">{t('For the morning brief')}</span> : null}
          <span className="spacer" />
          {explains ? (
            <button
              className="link-button"
              aria-expanded={why.has(card.id)}
              onClick={() =>
                setWhy(current => {
                  const next = new Set(current)
                  if (next.has(card.id)) next.delete(card.id)
                  else next.add(card.id)
                  return next
                })
              }
            >
              {t('Why?')}
            </button>
          ) : null}
        </div>
        <div className={`pulse-news${card.doneAt ? ' done' : ''}`}>
          {card.kind === 'followup' ? <p>{card.news || card.title}</p> : <Markdown text={card.news || card.title} />}
        </div>
        {card.quote && !cleared ? <p className="pulse-quote">“{card.quote}”</p> : null}
        {hasChat(card) ? (
          <button
            className="pulse-source"
            onClick={() =>
              onOpenChat({
                id: card.chatId,
                profile: card.profile || 'default',
                title: card.chatTitle || undefined
              })
            }
          >
            <Icon name="chats" />
            <span>{card.chatTitle || t('Open the chat')}</span>
          </button>
        ) : card.kanbanTask !== undefined ? (
          <button className="pulse-source" onClick={onOpenBoard}>
            <Icon name="tasks" />
            <span>{card.kanbanTask ? t('Kanban task {task}', { task: card.kanbanTask }) : t('Tasks')}</span>
          </button>
        ) : null}
        {why.has(card.id) ? (
          <div className="pulse-why">
            {reason ? <p>{reason}</p> : null}
            {looked ? <p>{looked}</p> : null}
          </div>
        ) : null}
        {cleared ? (
          <div className="pulse-actions">
            <span className={`pulse-cleared${isResting(card) ? '' : ' done'}`}>
              <Icon name={isResting(card) ? 'clock' : 'check'} />
              {clearedTitle(card, Date.now(), language)}
            </span>
            <span className="spacer" />
            {isResting(card) ? (
              <button className="secondary" disabled={isBusy} onClick={() => void act(card, () => pulse.dismiss(card.id, false))}>
                {t('Put back')}
              </button>
            ) : card.doneAt && canBeDone(card) ? (
              <button className="secondary" disabled={isBusy} onClick={() => void act(card, () => pulse.done(card.id, false))}>
                {t('Undo Done')}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="pulse-actions">
            {canAct(card) ? (
              <button className="primary" disabled={isBusy} onClick={() => doIt(card)}>
                {t('Do it')}
              </button>
            ) : null}
            {canBeDone(card) ? (
              <button className="secondary" disabled={isBusy} onClick={() => void act(card, () => pulse.done(card.id, true))}>
                {t('Done')}
              </button>
            ) : null}
            <button className="secondary" disabled={isBusy} onClick={e => setMenu({ kind: 'later', card, x: e.clientX, y: e.clientY })}>
              {t('Not now')}
            </button>
            <span className="spacer" />
            {isRatable(card) ? (
              <>
                <button
                  className={`thumb${card.rating === 'up' ? ' on' : ''}`}
                  aria-label={t('Useful')}
                  title={t('Useful')}
                  aria-pressed={card.rating === 'up'}
                  disabled={isBusy}
                  onClick={() => void act(card, () => pulse.rate(card.id, 'up'))}
                >
                  👍
                </button>
                <button
                  className={`thumb${card.rating === 'down' ? ' on' : ''}`}
                  aria-label={t('Not useful')}
                  title={t('Not useful')}
                  aria-pressed={card.rating === 'down'}
                  disabled={isBusy}
                  onClick={e => setMenu({ kind: 'down', card, x: e.clientX, y: e.clientY })}
                >
                  👎
                </button>
              </>
            ) : null}
          </div>
        )}
        {card.rating === 'down' && card.reason && !cleared ? <span className="meta pulse-reason">{reasonTitle(card.reason)}</span> : null}
      </article>
    )
  }

  let body: React.ReactNode
  if (availability === 'missing') {
    body = (
      <div className="needs-empty">
        <Icon name="pulse" />
        <p>{t('Update the Conduit plugin on this host to use Pulse.')}</p>
      </div>
    )
  } else if (availability === 'off' && !feed?.cards.length) {
    body = (
      <div className="needs-empty">
        <Icon name="pulse" />
        <strong>{t('Pulse is off')}</strong>
        <button className="secondary" onClick={() => setSettingsOpen(true)}>
          {t('Turn on Pulse')}
        </button>
      </div>
    )
  } else if (!feed) {
    body = error ? (
      <div className="needs-empty">
        <strong>{t("Couldn't read Pulse")}</strong>
        <p>{error}</p>
        <button className="secondary" onClick={() => void pulse.reload()}>
          {t('Try again')}
        </button>
      </div>
    ) : (
      <p className="meta">{t('Loading…')}</p>
    )
  } else if (!feed.cards.length) {
    body = (
      <div className="needs-empty">
        <Icon name="pulse" />
        <strong>{t('Nothing yet')}</strong>
        <p>{t('Your reports, your morning brief and the news on what Hermes promised to check land here.')}</p>
      </div>
    )
  } else if (sections) {
    const newCount = sections.fresh.length
    body = (
      <>
        <p className="needs-sub">
          {newCount ? t('{count} new since you last looked', { count: newCount }) : !sections.earlier.length ? t("You're all caught up") : null}
        </p>
        {sections.fresh.length ? (
          <>
            <h2 className="pulse-section">{t('New')}</h2>
            {sections.fresh.map(cardView)}
          </>
        ) : null}
        {sections.earlier.length ? (
          <>
            {sections.fresh.length ? <h2 className="pulse-section">{t('Earlier')}</h2> : null}
            {sections.earlier.map(cardView)}
          </>
        ) : null}
        {sections.cleared.length ? (
          <>
            <button className="pulse-cleared-toggle" aria-expanded={showCleared} onClick={() => setShowCleared(open => !open)}>
              {t('Done and cleared')} · {sections.cleared.length}
            </button>
            {showCleared ? sections.cleared.map(cardView) : null}
          </>
        ) : null}
      </>
    )
  }

  return (
    <main className="needs pulse-page">
      {settingsOpen ? (
        <div className="needs-inner">
          <PulseSettings onBack={() => setSettingsOpen(false)} onChanged={() => void pulse.reload()} />
        </div>
      ) : (
        <div className="needs-inner">
          <div className="pulse-head">
            <h1>{t('Pulse')}</h1>
            <span className="spacer" />
            {availability === 'on' && feed && !feed.quietNow ? (
              <button className="secondary" onClick={() => void pulse.quiet(true).catch(e => setNote(refusalText(e)))}>
                {t('Quiet for today')}
              </button>
            ) : null}
            {availability !== 'missing' ? (
              <button
                className="staged-remove pulse-settings-button"
                aria-label={t('Pulse settings')}
                title={t('Pulse settings')}
                onClick={() => setSettingsOpen(true)}
              >
                <Icon name="settings" />
              </button>
            ) : null}
          </div>
          {feed?.quietNow ? (
            <div className="pulse-quiet">
              <div>
                <strong>{t('Pulse is quiet')}</strong>
                {feed.quietEndsAt ? <span className="meta">{backText(feed.quietEndsAt, Date.now(), language)}</span> : null}
              </div>
              {feed.quietNow === 'until' ? (
                <button className="secondary" onClick={() => void pulse.quiet(false).catch(e => setNote(refusalText(e)))}>
                  {t('End quiet time')}
                </button>
              ) : null}
            </div>
          ) : null}
          {note ? (
            <div className="model-note" role="status">
              {note}
              <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
                <Icon name="close" />
              </button>
            </div>
          ) : null}
          {body}
        </div>
      )}
      {menu ? (
        <div
          className="host-menu row-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 240),
            top: Math.min(menu.y, window.innerHeight - 260)
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="menu-title">{menu.kind === 'down' ? t('What was wrong with it?') : t('Not now, until when?')}</div>
          {menu.kind === 'down' ? (
            <>
              {DOWN_REASONS.map(reason => (
                <button
                  key={reason}
                  role="menuitem"
                  onClick={() => {
                    const card = menu.card
                    setMenu(null)
                    void act(card, () => pulse.rate(card.id, 'down', reason))
                  }}
                >
                  {reasonTitle(reason)}
                </button>
              ))}
              <button
                role="menuitem"
                onClick={() => {
                  const card = menu.card
                  setMenu(null)
                  void act(card, () => pulse.rate(card.id, 'down'))
                }}
              >
                {t('Just thumbs down')}
              </button>
            </>
          ) : (
            <>
              {RESTS.map(rest => (
                <button
                  key={rest}
                  role="menuitem"
                  onClick={() => {
                    const card = menu.card
                    setMenu(null)
                    void act(card, () => pulse.dismiss(card.id, true, rest))
                  }}
                >
                  {restTitle(rest)}
                </button>
              ))}
              {canPutAwayForGood(menu.card) ? (
                <button
                  role="menuitem"
                  onClick={() => {
                    const card = menu.card
                    setMenu(null)
                    void act(card, () => pulse.dismiss(card.id, true))
                  }}
                >
                  {t("Don't bring it back")}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </main>
  )
}
