import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import {
  MAX_JOINING,
  canJoin,
  canPick,
  canRemove,
  choicesSummary,
  dailyLimitSteps,
  inviteLine,
  joiningAgents,
  names,
  shareDetail,
  takesPartDetail,
  toolsDetail,
  until,
  type Answering,
  type RoomChoices,
  type RoomInvite
} from '../state/roomInvites'
import { BotAvatar } from './BotsHome'
import { ask } from '../state/dialogs'
import { inSelectMenu, Select } from './Select'

/**
 * An invite's join card, after the phone's RoomInviteSheet: the room, who
 * it's from, who else is invited, the host's agents and until when it can be
 * answered. While it waits on you, the bots the plugin can bring, each with
 * its choices for the room, then Join, Just Me or Decline. After, where it
 * stands and your bots in it. It reads the invites every 5 s, for up to 10
 * minutes, while the invite waits on you or on the room.
 */
export function RoomInviteCard({
  invite,
  bots,
  freeBusy,
  onAnswer,
  onRemove,
  onRefresh,
  onClose
}: {
  invite: RoomInvite
  bots: Bot[] | null
  freeBusy: boolean
  onAnswer: (invite: RoomInvite, joining: Record<string, unknown>[], justMe?: boolean) => Promise<Answering>
  onRemove: (invite: RoomInvite) => void
  onRefresh: () => Promise<void>
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [edited, setEdited] = useState<Record<string, RoomChoices>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<'join' | 'alone' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inSelectMenu(event) && !busy) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, busy])

  const following = invite.status === 'waiting' || invite.status === 'joined'
  useEffect(() => {
    if (!following) return
    let ticks = 0
    const timer = setInterval(() => {
      if (++ticks > 120) return clearInterval(timer)
      if (document.visibilityState === 'visible') void onRefresh()
    }, 5000)
    return () => clearInterval(timer)
  }, [following, onRefresh])

  // Your bots it can bring: those whose profile the plugin lists.
  const listed = (bots ?? []).filter(bot => invite.profiles.includes(bot.name))
  const pickedCount = listed.filter(bot => picked.has(bot.name)).length
  const places = Math.min(invite.places, MAX_JOINING)
  const choicesOf = (profile: string) => edited[profile] ?? invite.choices[profile]!

  const answer = async (joining: Record<string, unknown>[], justMe = false) => {
    if (busy) return
    setBusy(justMe ? 'alone' : joining.length ? 'join' : 'decline')
    setError(null)
    setSending(null)
    const outcome = await onAnswer(invite, joining, justMe)
    setBusy(null)
    if (outcome.kind === 'refused') setError(outcome.message)
    else if (outcome.kind === 'sending') setSending(outcome.message)
    // A declined invite has no row: the card goes with it.
    else if (!joining.length && !justMe) onClose()
  }

  const join = () => {
    const unlisted = [...picked].filter(p => !invite.profiles.includes(p))
    if (unlisted.length) {
      setPicked(new Set([...picked].filter(p => invite.profiles.includes(p))))
      return setError(t("Some of the bots you picked can't join this room any more."))
    }
    const joining = joiningAgents(
      listed.filter(bot => picked.has(bot.name)),
      Object.fromEntries(invite.profiles.map(p => [p, choicesOf(p)]))
    )
    if (!joining) return setError(t("Two of these bots would claim the same @handle. Rename one bot's title, then try again."))
    void answer(joining)
  }

  const decline = async () => {
    if (!(await ask(`${t('Decline {name}?', { name: invite.name })}\n\n${t('The person who invited you is told.')}`))) return
    void answer([])
  }

  return (
    <div className="shortcuts-backdrop" onClick={() => !busy && onClose()}>
      <div className="shortcuts-sheet link-sheet invite-card" role="dialog" aria-modal="true" aria-label={invite.name} onClick={e => e.stopPropagation()}>
        <header>
          <span />
          <h2>{invite.name}</h2>
          <button type="button" className="link" onClick={onClose} disabled={!!busy}>
            {t('Done')}
          </button>
        </header>
        {error ? <p className="error-text">{error}</p> : null}
        {sending ? <p className="meta">{sending}</p> : null}
        <h3>{t('Invite')}</h3>
        <p>{inviteLine(invite)}</p>
        {invite.status === 'waiting' && invite.expiresAt !== null ? <p className="meta">{t('Answer by {date}', { date: until(invite.expiresAt) })}</p> : null}
        {invite.people.length ? <p className="meta">{t('Also invited: {names}', { names: names(invite.people) })}</p> : null}
        {invite.hostAgents.length ? <p className="meta">{t('Their agents: {names}', { names: names(invite.hostAgents) })}</p> : null}

        {invite.status === 'waiting' ? (
          <>
            <h3>{t('Your bots')}</h3>
            {places === 0 && bots ? (
              <p className="meta">{t('This room has no places left for your bots.')}</p>
            ) : !listed.length ? (
              <p className="meta">{bots ? t('None of your bots can join this room.') : t('Loading…')}</p>
            ) : null}
            {listed.map(bot => {
              const isPicked = picked.has(bot.name)
              const pickable = isPicked || canPick(pickedCount, invite.places)
              const choices = choicesOf(bot.name)
              return (
                <div key={bot.name} className="invite-bot">
                  <label className={`invite-bot-row${pickable ? '' : ' disabled'}`}>
                    <input
                      type="checkbox"
                      checked={isPicked}
                      disabled={!pickable || !!busy}
                      onChange={() => {
                        const next = new Set(picked)
                        if (isPicked) next.delete(bot.name)
                        else next.add(bot.name)
                        setPicked(next)
                      }}
                    />
                    <BotAvatar bot={bot} size={32} />
                    <span className="invite-bot-name">
                      <strong>{bot.title}</strong>
                      <span className="meta">{bot.name}</span>
                    </span>
                  </label>
                  {isPicked ? (
                    <button className="invite-choices-row" disabled={!!busy} aria-expanded={open === bot.name} onClick={() => setOpen(open === bot.name ? null : bot.name)}>
                      <span>{t("{name}'s choices", { name: bot.title })}</span>
                      <span className="meta">{choicesSummary(choices)}</span>
                    </button>
                  ) : null}
                  {isPicked && open === bot.name ? (
                    <ChoicesEditor
                      original={invite.choices[bot.name]!}
                      choices={choices}
                      freeBusy={freeBusy}
                      onChange={next => setEdited(current => ({ ...current, [bot.name]: next }))}
                    />
                  ) : null}
                </div>
              )
            })}
            <p className="meta">{t('Places for your bots: {count}', { count: places })}</p>
            <p className="meta">{t('Each bot starts with its choices from your last room with the same people, else its defaults.')}</p>
            <div className="invite-answers">
              <button className="primary" disabled={!!busy || !canJoin(pickedCount, invite.places)} onClick={join}>
                {busy === 'join' ? t('Working…') : t('Join')}
              </button>
              {invite.justMeOffered ? (
                <button className="secondary" disabled={!!busy || pickedCount > 0} onClick={() => void answer([], true)}>
                  {busy === 'alone' ? t('Working…') : t('Just Me')}
                </button>
              ) : null}
              <button className="link danger" disabled={!!busy} onClick={decline}>
                {busy === 'decline' ? t('Working…') : t('Decline')}
              </button>
            </div>
          </>
        ) : (
          <>
            {invite.justMe ? <p className="meta">{t('You joined without your bots: you read this room and post in it yourself.')}</p> : null}
            {invite.joined.length ? (
              <>
                <h3>{t('Your bots')}</h3>
                {invite.joined.map(agent => (
                  <p key={agent.profile}>{agent.displayName}</p>
                ))}
              </>
            ) : null}
            {canRemove(invite) ? (
              <div className="invite-answers">
                <button
                  className="link danger"
                  onClick={() => {
                    onRemove(invite)
                    onClose()
                  }}
                >
                  {t('Remove')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/** A bot's choices for a room it's invited to, before it joins. Nothing goes until Join. */
function ChoicesEditor({
  original,
  choices,
  freeBusy,
  onChange
}: {
  original: RoomChoices
  choices: RoomChoices
  freeBusy: boolean
  onChange: (choices: RoomChoices) => void
}) {
  const set = (patch: Partial<RoomChoices>) => onChange({ ...choices, ...patch })
  const tools: [string, string][] = [
    ['talk', t('Talk only')],
    ['look', t('Look things up')]
  ]
  // Use my data where the plugin says when you're busy, else while it's the choice; Custom while it's the choice.
  if (freeBusy || original.tools === 'data' || choices.tools === 'data') tools.push(['data', t('Use my data')])
  if (original.tools === 'custom' || choices.tools === 'custom') tools.push(['custom', t('Custom')])
  return (
    <div className="invite-choices">
      <label>
        <span>{t('What it can do')}</span>
        <Select className="language-select" value={choices.tools} onChange={picked => set({ tools: picked })}>
          {tools.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </Select>
      </label>
      <p className="meta">{toolsDetail(choices, freeBusy)}</p>
      <div className="invite-choice">
        <span>{t('What it may share')}</span>
        <Select segments aria-label={t('What it may share')} value={choices.share} onChange={picked => set({ share: picked })}>
          <option value="helps">{t('What helps')}</option>
          <option value="ask">{t('Ask me first')}</option>
          <option value="nothing">{t('Nothing personal')}</option>
        </Select>
      </div>
      <p className="meta">{shareDetail(choices.share)}</p>
      <label className="toggle">
        <input type="checkbox" checked={choices.searchChats} onChange={e => set({ searchChats: e.target.checked })} />
        <span>{t('Search my past chats')}</span>
      </label>
      <p className="meta">{t("It can search your other chats to answer here, other people's messages in them included.")}</p>
      <div className="invite-choice">
        <span>{t('How it takes part')}</span>
        <Select segments aria-label={t('How it takes part')} value={choices.takesPart} onChange={picked => set({ takesPart: picked })}>
          <option value="joins">{t('Joins in')}</option>
          <option value="asked">{t('When asked')}</option>
          <option value="listens">{t('Listens only')}</option>
        </Select>
      </div>
      <p className="meta">{takesPartDetail(choices.takesPart)}</p>
      <label>
        <span>{t('Turns a day')}</span>
        <Select className="language-select" value={choices.dailyLimit} onChange={picked => set({ dailyLimit: Number(picked) })}>
          {dailyLimitSteps(original.dailyLimit).map(n => (
            <option key={n} value={n}>
              {n.toLocaleString()}
            </option>
          ))}
        </Select>
      </label>
      <p className="meta">{t("The most turns it takes in this room each day. Once they're used up, it says so and sits out until tomorrow.")}</p>
    </div>
  )
}
