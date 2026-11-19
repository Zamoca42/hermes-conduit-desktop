import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import type { Room } from '../state/groups'
import { canCreateWithFar, canPickBot, canPickFar, canPickPerson, draftAgents, ownBotId, type DraftCreation, type OwnHermesBot } from '../state/roomDrafts'
import type { RoomLink } from '../state/roomLinks'
import { BotAvatar } from './BotsHome'
import { Icon } from './icons'

/**
 * New Group Chat, after the phone's GroupCreateSheet: a name, 2 to 6 of your
 * bots, or with people you've linked, at least one bot and a place for each
 * person. Without people it's a room of your own bots on this gateway; with
 * them it's a draft that invites each person over their Link and starts once
 * they've all answered.
 */
export function NewGroupChat({
  bots,
  people,
  ownBots = [],
  peopleOffered,
  startsUnavailable,
  canLink,
  onCreateRoom,
  onCreateDraft,
  onOpenRoom,
  onClose
}: {
  bots: Bot[]
  /** The people you can invite: your Links that are linked. */
  people: RoomLink[]
  /** Your other Hermes' bots, picked like your own. */
  ownBots?: OwnHermesBot[]
  /** This Hermes makes rooms with people you've linked. */
  peopleOffered: boolean
  /** It can't start them yet: Hermes is too old. */
  startsUnavailable: boolean
  /** This Hermes keeps Links, so linking is where to start. */
  canLink: boolean
  onCreateRoom: (roomId: string, name: string, bots: Bot[]) => Promise<Room>
  onCreateDraft: (name: string, agents: Record<string, unknown>[], links: string[], bring: Record<string, string[]>) => Promise<DraftCreation>
  onOpenRoom: (room: Room) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickedPeople, setPickedPeople] = useState<Set<string>>(new Set())
  const [pickedFarIds, setPickedFarIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The picks a draft was made with while its invites were still going out: Create again would invite everyone twice. */
  const [sendingPicks, setSendingPicks] = useState<string | null>(null)
  /** A room's id is minted once for the same name and bots, so a retry never makes a twin. */
  const attempt = useRef<{ key: string; roomId: string } | null>(null)
  const nameField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameField.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const pickedBots = bots.filter(b => picked.has(b.name))
  const invited = people.filter(p => pickedPeople.has(p.id))
  // A far bot that's gone or no longer ready is no longer picked.
  const pickedFar = ownBots.filter(b => pickedFarIds.has(ownBotId(b)) && b.ready)
  const farByLink: Record<string, number> = {}
  for (const bot of pickedFar) farByLink[bot.linkId] = (farByLink[bot.linkId] ?? 0) + 1
  const overLinks = invited.length > 0 || pickedFar.length > 0
  const trimmed = name.trim()
  const picks = JSON.stringify([trimmed, pickedBots.map(b => b.name).sort(), invited.map(p => p.id).sort(), pickedFar.map(ownBotId).sort()])
  const canCreate = !!trimmed && canCreateWithFar(pickedBots.length, farByLink, invited.length) && !busy && (!overLinks || picks !== sendingPicks)

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const create = async () => {
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      if (overLinks) {
        const agents = draftAgents(pickedBots)
        if (!agents) throw new Error(t('Two of these bots would have the same @handle. Rename one, then try again.'))
        const bring: Record<string, string[]> = {}
        for (const bot of pickedFar) (bring[bot.linkId] ??= []).push(bot.profile)
        const links = invited.map(p => p.id)
        const outcome = await onCreateDraft(trimmed, agents, [...links, ...Object.keys(bring).sort().filter(id => !links.includes(id))], bring)
        if (outcome.kind === 'made') return onClose()
        setSendingPicks(picks)
        setError(t('Your Hermes is still sending the invites. The room shows under Group Chats once it has.'))
        return
      }
      const key = JSON.stringify([trimmed, pickedBots.map(b => b.name).sort()])
      if (attempt.current?.key !== key) attempt.current = { key, roomId: crypto.randomUUID() }
      const room = await onCreateRoom(attempt.current.roomId, trimmed, pickedBots)
      onClose()
      onOpenRoom(room)
    } catch (e) {
      setError(t('Could not create the group chat: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shortcuts-backdrop" onClick={() => !busy && onClose()}>
      <div className="shortcuts-sheet link-sheet new-group" role="dialog" aria-modal="true" aria-label={t('New Group Chat')} onClick={e => e.stopPropagation()}>
        <header>
          <button type="button" className="link" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </button>
          <h2>{t('New Group Chat')}</h2>
          <button type="button" className="link" onClick={() => void create()} disabled={!canCreate}>
            {t('Create')}
          </button>
        </header>
        {error ? <p className="error-text">{error}</p> : null}
        <h3>{t('Name')}</h3>
        <input
          ref={nameField}
          className="input-ask-field"
          value={name}
          placeholder={t('Group name')}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void create()}
        />
        <h3>{invited.length ? t('Your bots') : t('Members (2–6)')}</h3>
        {bots.map(bot => {
          const on = picked.has(bot.name)
          const pickable = on || canPickBot(pickedBots.length + pickedFar.length, invited.length)
          return (
            <label key={bot.name} className={`invite-bot-row${pickable ? '' : ' disabled'}`}>
              <input type="checkbox" checked={on} disabled={!pickable || busy} onChange={() => setPicked(toggle(picked, bot.name))} />
              <BotAvatar bot={bot} size={32} />
              <span className="invite-bot-name">
                <strong>{bot.title}</strong>
                <span className="meta">{bot.name}</span>
              </span>
            </label>
          )
        })}
        {ownBots.map(bot => {
          const id = ownBotId(bot)
          const on = pickedFarIds.has(id) && bot.ready
          // Within 6 and within its Hermes' share of the places; one not set up for rooms there can't be picked.
          const pickable = bot.ready && (on || canPickFar(pickedBots.length, farByLink, bot.linkId, invited.length))
          return (
            <label key={id} className={`invite-bot-row${pickable ? '' : ' disabled'}`}>
              <input type="checkbox" checked={on} disabled={!pickable || busy} onChange={() => setPickedFarIds(toggle(pickedFarIds, id))} />
              <span className="person-glyph" aria-hidden="true">
                <Icon name="linked" />
              </span>
              <span className="invite-bot-name">
                <strong>{bot.displayName}</strong>
                <span className="meta">{bot.ready ? t('On {name}', { name: bot.linkName }) : t('On {name} · turn on rooms for it there first', { name: bot.linkName })}</span>
              </span>
            </label>
          )
        })}
        {ownBots.length ? (
          <p className="meta">{t('A room can bring bots from one of your other Hermes beside at least one of your bots here, and then invites no one else. They join by themselves.')}</p>
        ) : null}
        <p className="meta">{t('Group chats run on this gateway. The gateway drives each member’s turn — closing Conduit never stops a room.')}</p>
        {people.length ? (
          <>
            <h3>{t('Multiplayer')}</h3>
            {people.map(person => {
              const on = pickedPeople.has(person.id)
              // Far bots join by themselves only when nobody else is invited.
              const pickable = on || (!pickedFar.length && canPickPerson(pickedBots.length, invited.length))
              return (
                <label key={person.id} className={`invite-bot-row${pickable ? '' : ' disabled'}`}>
                  <input type="checkbox" checked={on} disabled={!pickable || busy} onChange={() => setPickedPeople(toggle(pickedPeople, person.id))} />
                  <span className="person-glyph" aria-hidden="true">
                    <Icon name="linked" />
                  </span>
                  <span className="invite-bot-name">
                    <strong>{person.name}</strong>
                  </span>
                </label>
              )
            })}
            <p className="meta">{t('Each person gets an invite on their Hermes. The room starts once they’ve all answered, or when you start it.')}</p>
            <p className="meta">{t('A room holds up to 6 agents: your bots, and at least one for each person.')}</p>
          </>
        ) : startsUnavailable && peopleOffered ? (
          <>
            <h3>{t('Multiplayer')}</h3>
            <p className="meta">{t("Your Hermes can't host rooms with people you've linked yet. Update Hermes to invite them.")}</p>
          </>
        ) : canLink && peopleOffered ? (
          <>
            <h3>{t('Multiplayer')}</h3>
            <p className="meta">{t('Link with someone to make rooms with their agents.')}</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
