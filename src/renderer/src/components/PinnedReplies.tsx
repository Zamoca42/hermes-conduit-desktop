import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import { nextBarIndex, normalizedLabel, overview, pinTitle, shownText, type PinnedReply } from '../state/pinnedReplies'
import { inSelectMenu } from './Select'

/** What a chat's transcript is given to pin replies and draw the bar. */
export interface PinControls {
  /** This chat's pins. */
  list: PinnedReply[]
  /** Pins the reply, or the passage of it that was selected. */
  pin: (item: { key: string; text: string }, passage?: string) => void
  unpin: (pin: PinnedReply) => void
  /** Opens the list with this pin's label editor. */
  label: (pin: PinnedReply) => void
  /** Opens the list on this chat's pins. */
  showAll: () => void
  /** The pins with the row ids their replies took. */
  refresh: (pins: PinnedReply[]) => void
  /** A pin to scroll to once the transcript has its reply. */
  reveal?: PinnedReply | null
  onRevealed: () => void
}

/**
 * The slim bar over the chat with one pinned reply. A click goes to that
 * reply and moves the bar to the one before it, round to the latest again;
 * ⋯ has Unpin, the label and the list.
 */
export function PinnedReplyBar({
  pins,
  jump,
  onUnpin,
  onLabel,
  onShowAll
}: {
  /** Oldest first, as the replies sit in the chat. */
  pins: PinnedReply[]
  jump: (pin: PinnedReply) => void
  onUnpin: (pin: PinnedReply) => void
  onLabel: (pin: PinnedReply) => void
  onShowAll: () => void
}) {
  const [shown, setShown] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])
  if (!pins.length) return null
  const index = shown === null ? pins.length - 1 : Math.min(Math.max(shown, 0), pins.length - 1)
  const pin = pins[index]!
  const heading = pins.length > 1 ? t('Pinned reply {n} of {count}', { n: String(index + 1), count: String(pins.length) }) : t('Pinned reply')
  return (
    <div className="pinned-bar">
      <button
        className="pinned-bar-main"
        title={t('Goes to the pinned reply')}
        onClick={() => {
          jump(pin)
          setShown(nextBarIndex(index, pins.length))
        }}
      >
        {pins.length > 1 ? (
          <span className="pinned-bar-ticks" aria-hidden="true">
            {pins.map((p, i) => (
              <span key={p.id} className={i === index ? 'on' : undefined} />
            ))}
          </span>
        ) : null}
        <span className="pinned-bar-text">
          <span className="pinned-bar-heading">{heading}</span>
          <span className="pinned-bar-title">{pinTitle(pin)}</span>
        </span>
      </button>
      <span className="message-more">
        <button
          className="message-action"
          aria-label={t('More')}
          title={t('More')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={e => {
            e.stopPropagation()
            setMenu(m => !m)
          }}
        >
          <Icon name="more" />
        </button>
        {menu ? (
          <div className="host-menu message-menu pinned-bar-menu" role="menu">
            <button role="menuitem" onClick={() => onLabel(pin)}>
              {pin.label ? t('Edit label') : t('Add label')}
            </button>
            <button role="menuitem" onClick={onShowAll}>
              {t('Pinned replies')}
            </button>
            <button role="menuitem" className="danger" onClick={() => onUnpin(pin)}>
              {t('Unpin')}
            </button>
          </div>
        ) : null}
      </span>
    </div>
  )
}

/**
 * Every pin, a section per chat, from the Chats list or the bar: a click
 * opens the chat at the reply. Each pin can be labelled or unpinned.
 */
export function PinnedRepliesSheet({
  pins,
  open,
  initialScope,
  editing: editingFirst,
  chatTitle,
  onOpen,
  onUnpin,
  onLabel,
  onClose
}: {
  pins: PinnedReply[]
  /** The open chat, whose pins come first and which This chat shows. */
  open?: { profile?: string; chat?: string | null }
  initialScope: 'chat' | 'all'
  /** A pin whose label editor is open. */
  editing?: string | null
  /** The title a chat has now, when it's listed. */
  chatTitle: (pin: PinnedReply) => string
  onOpen: (pin: PinnedReply) => void
  onUnpin: (pin: PinnedReply) => void
  onLabel: (pin: PinnedReply, label: string | undefined) => void
  onClose: () => void
}) {
  const sections = overview(pins, open)
  const chatPins = open?.chat
    ? sections.find(s => s.pins[0]!.chat === open.chat && s.pins[0]!.profile.toLowerCase() === (open.profile || 'default').toLowerCase())
    : undefined
  const [scope, setScope] = useState<'chat' | 'all'>(chatPins ? initialScope : 'all')
  const [editing, setEditing] = useState<string | null>(editingFirst ?? null)
  const [draft, setDraft] = useState(() => pins.find(p => p.id === editingFirst)?.label ?? '')
  const done = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!editingFirst) done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || inSelectMenu(event)) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, editingFirst])
  const shown = scope === 'chat' && chatPins ? [chatPins] : sections
  const save = (pin: PinnedReply) => {
    onLabel(pin, normalizedLabel(draft))
    setEditing(null)
  }
  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-sheet pinned-sheet" role="dialog" aria-modal="true" aria-label={t('Pinned replies')} onClick={e => e.stopPropagation()}>
        <header>
          <h2>{t('Pinned replies')}</h2>
          <span className="spacer" />
          <button ref={done} className="link" onClick={onClose}>
            {t('Done')}
          </button>
        </header>
        {chatPins && sections.length > 1 ? (
          <div className="filter-chips" role="tablist" aria-label={t('Show pins from')}>
            {(['chat', 'all'] as const).map(value => (
              <button key={value} role="tab" aria-selected={scope === value} className={scope === value ? 'on' : undefined} onClick={() => setScope(value)}>
                {value === 'chat' ? t('This chat') : t('All chats')}
              </button>
            ))}
          </div>
        ) : null}
        {!pins.length ? (
          <div className="pinned-empty">
            <Icon name="pin" />
            <strong>{t('No pinned replies')}</strong>
            <span className="meta">{t('Choose Pin reply in a reply’s ⋯ menu. It stays at the top of its chat and shows here.')}</span>
          </div>
        ) : (
          shown.map(section => (
            <section key={section.key}>
              <h3>{chatTitle(section.pins[0]!)}</h3>
              <ul>
                {section.pins.map(pin => (
                  <li key={pin.id} className="pinned-row">
                    {editing === pin.id ? (
                      <form
                        className="pinned-label-form"
                        onSubmit={e => {
                          e.preventDefault()
                          save(pin)
                        }}
                      >
                        <input
                          autoFocus
                          aria-label={t('Label')}
                          placeholder={t('Security recommendations')}
                          maxLength={80}
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') {
                              e.stopPropagation()
                              e.nativeEvent.stopImmediatePropagation()
                              setEditing(null)
                            }
                          }}
                        />
                        <span className="meta">{t('A short name for the pins list, such as Security recommendations.')}</span>
                        <span className="pinned-label-actions">
                          <button type="button" className="link" onClick={() => setEditing(null)}>
                            {t('Cancel')}
                          </button>
                          <button type="submit" className="link">
                            {t('Save')}
                          </button>
                        </span>
                      </form>
                    ) : (
                      <>
                        <button className="pinned-row-open" title={t('Opens the chat at this reply')} onClick={() => onOpen(pin)}>
                          {pin.label ? <strong>{pin.label}</strong> : null}
                          <span className={pin.label ? 'meta' : undefined}>
                            {/* A passage reads as a quote of its reply. */}
                            {pin.passage ? (
                              <span className="pinned-passage-mark" aria-hidden="true">
                                “
                              </span>
                            ) : null}
                            {shownText(pin)}
                          </span>
                        </button>
                        <button
                          className="link"
                          onClick={() => {
                            setDraft(pin.label ?? '')
                            setEditing(pin.id)
                          }}
                        >
                          {pin.label ? t('Edit label') : t('Add label')}
                        </button>
                        <button className="link danger" onClick={() => onUnpin(pin)}>
                          {t('Unpin')}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
