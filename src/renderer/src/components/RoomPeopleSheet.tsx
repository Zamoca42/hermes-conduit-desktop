import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import type { Room, RoomMember } from '../state/groups'
import { clippedNote, canTakeOut, roomChoicesClient, takeOutMessage, takeOutTitle, toolsLabel, type AgentChoices } from '../state/roomChoices'
import { roomCopiesClient, outLine, type RoomCopy } from '../state/roomCopies'
import { shareDetail, toolsDetail } from '../state/roomInvites'
import { linksMessage } from '../state/roomLinks'
import { ask } from '../state/dialogs'

const choicesClient = roomChoicesClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))
const copiesClient = roomCopiesClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))

/**
 * Group Info's people in a room with other people's agents, after the
 * phone's members section: each member with its owner, your agents' choices
 * for the room (What it can do, What it may share, Search my past chats,
 * Run work and a note), and Take Out for another person's agent in a room
 * you host or your own in a room someone else hosts.
 */
export function RoomPeopleSheet({
  room,
  copy,
  nameOf,
  canSetChoices,
  freeBusy,
  canLeave,
  onChanged,
  onClose
}: {
  room: Room
  copy: RoomCopy | null
  nameOf: (member: RoomMember) => string
  canSetChoices: boolean
  freeBusy: boolean
  /** The plugin takes agents out (room-leave). */
  canLeave: boolean
  /** Who's in changed: read the room again. */
  onChanged: () => void
  onClose: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const host = copy ? copy.from : null
  const over = copy ? copy.status === 'ended' || copy.status === 'left' : false
  // Choices matter only beside other people's agents.
  const offersChoices = canSetChoices && room.members.some(m => m.peer)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, working])

  const takeOut = async (member: RoomMember) => {
    const name = nameOf(member)
    if (working || !(await ask(`${takeOutTitle(name)}\n\n${takeOutMessage(name, member, host)}`))) return
    setWorking(member.memberId)
    setError(null)
    setNote(null)
    try {
      const outcome = copy ? (await copiesClient.leave(copy, [member.profile!.trim()])).kind : await choicesClient.remove(room.roomId, member.memberId)
      if (outcome === 'sending') setNote(t('Your Hermes is still sending this. The room shows it once it has.'))
      onChanged()
    } catch (e) {
      setError(t('Could not take this agent out: {reason}', { reason: linksMessage(e) }))
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="shortcuts-backdrop" onClick={() => !working && onClose()}>
      <div className="shortcuts-sheet link-sheet room-people-sheet" role="dialog" aria-modal="true" aria-label={t('Members')} onClick={e => e.stopPropagation()}>
        <header>
          <span />
          <h2>{t('Members')}</h2>
          <button type="button" className="link" onClick={onClose} disabled={!!working}>
            {t('Done')}
          </button>
        </header>
        {error ? <p className="error-text">{error}</p> : null}
        {note ? <p className="meta">{note}</p> : null}
        {room.members.map(member => {
          const name = nameOf(member)
          const profile = member.profile?.trim() ?? ''
          const yours = !member.peer && !member.out && !!profile && offersChoices
          const takesOut = canLeave && canTakeOut(member, copy ? { over } : null)
          return (
            <div key={member.memberId} className="room-person-row">
              <div className="room-person-line">
                <div className="link-row-text">
                  <strong>{name}</strong>
                  {member.owner ? <span className="meta">{member.owner}</span> : null}
                  {member.out ? <span className="meta">{outLine(member.out)}</span> : null}
                </div>
                {yours ? (
                  <button className="secondary" aria-expanded={open === profile} onClick={() => setOpen(open === profile ? null : profile)}>
                    {open === profile ? t('Done') : t('Edit')}
                  </button>
                ) : null}
                {takesOut ? (
                  <button className="link danger" disabled={!!working} onClick={() => void takeOut(member)}>
                    {working === member.memberId ? t('Working…') : t('Take Out')}
                  </button>
                ) : null}
              </div>
              {yours && open === profile ? <AgentChoicesEditor roomId={room.roomId} profile={profile} name={name} freeBusy={freeBusy} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** One agent's choices for the room, after the phone's RoomAgentChoicesView: each change saved as it's made, one at a time. */
function AgentChoicesEditor({ roomId, profile, name, freeBusy }: { roomId: string; profile: string; name: string; freeBusy: boolean }) {
  const key = `${roomId}|${profile}`
  const [choices, setChoices] = useState<AgentChoices | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(key)
  current.current = key

  const load = async (at: string) => {
    try {
      const read = await choicesClient.read(roomId, profile)
      if (at !== current.current) return
      setChoices(read)
      setDraft(read.note)
    } catch (e) {
      if (at === current.current) setError(t('Could not read this setting from the host: {reason}', { reason: linksMessage(e) }))
    }
  }

  useEffect(() => {
    setChoices(null)
    setError(null)
    void load(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Shows the change, sends only it, then shows what the plugin kept; on a refusal, reads back what it kept.
  const change = async (field: string, value: unknown, patch: Partial<AgentChoices>) => {
    if (!choices || saving) return
    const at = key
    setChoices({ ...choices, ...patch })
    setSaving(true)
    setError(null)
    try {
      const kept = await choicesClient.set(roomId, profile, { [field]: value })
      if (at !== current.current) return
      setChoices(kept)
      if (field === 'note') setDraft(kept.note)
    } catch (e) {
      if (at !== current.current) return
      const typed = draft
      await load(at)
      setDraft(typed)
      setError(t('Could not change this setting: {reason}', { reason: linksMessage(e) }))
    } finally {
      setSaving(false)
    }
  }

  if (!choices) return error ? <p className="error-text">{error}</p> : <p className="meta">{t('Loading…')}</p>
  const tools: [string, string][] = [
    ['talk', toolsLabel('talk')],
    ['look', toolsLabel('look')]
  ]
  // Offered where the plugin shares when you're busy; else shown while it's the choice.
  if (freeBusy || choices.tools === 'data') tools.push(['data', toolsLabel('data')])
  if (choices.tools === 'custom') tools.push(['custom', toolsLabel('custom')])
  return (
    <div className="invite-choices agent-choices">
      {!choices.saved ? <p className="meta">{t("These are {name}'s defaults. A change here applies to this room only.", { name })}</p> : null}
      <label>
        <span>{t('What it can do')}</span>
        <select className="language-select" value={choices.tools} disabled={saving} onChange={e => void change('tools', e.target.value, { tools: e.target.value })}>
          {tools.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      <p className="meta">{toolsDetail(choices, freeBusy)}</p>
      <label>
        <span>{t('What it may share')}</span>
        <select className="language-select" value={choices.share} disabled={saving} onChange={e => void change('share', e.target.value, { share: e.target.value })}>
          <option value="helps">{t('What helps')}</option>
          <option value="ask">{t('Ask me first')}</option>
          <option value="nothing">{t('Nothing personal')}</option>
        </select>
      </label>
      <p className="meta">{shareDetail(choices.share)}</p>
      <label className="toggle">
        <input type="checkbox" checked={choices.searchChats} disabled={saving} onChange={e => void change('search_chats', e.target.checked, { searchChats: e.target.checked })} />
        <span>{t('Search my past chats')}</span>
      </label>
      <p className="meta">{t("It can search your other chats to answer here, other people's messages in them included.")}</p>
      {/* A plugin without Run work sends no run_work. */}
      {choices.runWork !== null ? (
        <>
          <label className="toggle">
            <input type="checkbox" checked={choices.runWork} disabled={saving} onChange={e => void change('run_work', e.target.checked, { runWork: e.target.checked })} />
            <span>{t('Run work')}</span>
          </label>
          <p className="meta">
            {t(
              "It can start work for this room, like research or code. Before each start, and before it sends the work more, it asks you on your phone: Start, Change it or Don't start. What the work finds reaches the room only as your share choices allow."
            )}
          </p>
        </>
      ) : null}
      <label className="agent-note">
        <span>{t('Note for this room')}</span>
        <textarea
          className="input-ask-field"
          rows={3}
          value={draft}
          placeholder={t('Anything it should keep in mind here')}
          disabled={saving}
          onChange={e => setDraft(clippedNote(e.target.value))}
        />
      </label>
      {draft !== choices.note ? (
        <div className="confirm-actions">
          <button className="link" disabled={saving} onClick={() => setDraft(choices.note)}>
            {t('Cancel')}
          </button>
          <span className="spacer" />
          <button className="primary" disabled={saving} onClick={() => void change('note', draft, { note: draft })}>
            {t('Save')}
          </button>
        </div>
      ) : null}
      <p className="meta">
        {t("{name} reads this on each of its turns here. It isn't posted to the room.", { name })} {t('A note holds up to 1,000 characters.')}
      </p>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  )
}
