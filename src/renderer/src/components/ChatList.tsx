import { useEffect, useMemo, useRef, useState } from 'react'
import { sectionRows, timeLabel, type ChatRow } from '../state/chats'
import type { Bot } from '../state/bots'
import { BotAvatar } from './BotsHome'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import { filterRows, isStarred, isUnread, type ChatFilter, type ChatMarks } from '../state/chatMarks'

const FILTERS: { value: ChatFilter; label: () => string }[] = [
  { value: 'all', label: () => t('All') },
  { value: 'starred', label: () => t('Starred') },
  { value: 'unread', label: () => t('Unread') },
  { value: 'running', label: () => t('Running') }
]

interface Props {
  rows: ChatRow[] | null
  error: string | null
  selectedId: string | null
  runningIds: ReadonlySet<string>
  runningStatus?: string
  onSelect: (row: ChatRow) => void
  onNewChat: () => void
  /** The bots, for the profile strip and the rows' bot names. */
  bots?: Bot[] | null
  /** The profile the list shows (null: every one). */
  profile?: string | null
  onProfile?: (profile: string | null) => void
  /** A row's menu (right-click or ⋯): Pin or Unpin, Rename, Delete. */
  onPin?: (row: ChatRow) => void
  onRename?: (row: ChatRow, title: string) => void
  onDelete?: (row: ChatRow) => void
  /** Stars and read state, kept on this computer; the filter chips use them. */
  marks?: ChatMarks
  onStar?: (row: ChatRow) => void
  onToggleRead?: (row: ChatRow) => void
  /** Opens Projects, the phone's Chats › Projects. */
  onProjects?: () => void
}

const sameProfile = (row: ChatRow, name: string) => (row.profile ?? 'default').toLowerCase() === name.toLowerCase()

export function ChatList({
  rows,
  error,
  selectedId,
  runningIds,
  runningStatus,
  onSelect,
  onNewChat,
  bots,
  profile = null,
  onProfile,
  onPin,
  onRename,
  onDelete,
  marks,
  onStar,
  onToggleRead,
  onProjects
}: Props) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ row: ChatRow; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const hasActions = !!(onPin || onRename || onDelete || onStar)
  const [filter, setFilter] = useState<ChatFilter>('all')

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  function finishRename(save: boolean) {
    if (!renaming) return
    const row = rows?.find(r => r.id === renaming.id)
    const title = renaming.title.trim()
    setRenaming(null)
    if (save && row && title && title !== row.title) onRename?.(row, title)
  }
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inProfile = profile ? (rows ?? []).filter(r => sameProfile(r, profile)) : (rows ?? [])
    const marked = marks ? filterRows(inProfile, filter, marks, runningIds) : inProfile
    const filtered = q ? marked.filter(r => `${r.title} ${r.preview ?? ''}`.toLowerCase().includes(q)) : marked
    return sectionRows(filtered)
  }, [rows, query, profile, marks, filter, runningIds])
  const showStrip = !!onProfile && (bots?.length ?? 0) > 1
  const botName = (row: ChatRow) => {
    if (!row.profile || row.profile === 'default' || profile) return null
    return bots?.find(b => b.name === row.profile)?.title ?? row.profile
  }

  // Bring the open chat into view once its row is there: a chat just made
  // from the composer shows up a moment after its first send.
  const scroller = useRef<HTMLDivElement>(null)
  const revealed = useRef<string | null>(null)
  const present = !!selectedId && sections.some(s => s.rows.some(r => r.id === selectedId))
  useEffect(() => {
    if (!present || revealed.current === selectedId) return
    revealed.current = selectedId
    scroller.current?.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [present, selectedId])

  return (
    <section className="chatlist" aria-label={t('Chats')}>
      <div className="chatlist-head">
        <h1>{t('Chats')}</h1>
        {onProjects ? (
          <button className="round" aria-label={t('Projects')} title={t('Projects')} onClick={onProjects}>
            <Icon name="folder" />
          </button>
        ) : null}
        <button
          className="round"
          aria-label={t('New chat')}
          title={window.conduit.platform === 'darwin' ? t('New chat (⌘N)') : t('New chat (Ctrl+N)')}
          onClick={onNewChat}
        >
          <Icon name="plus" />
        </button>
      </div>
      <label className="chatlist-search">
        <Icon name="search" />
        <span className="sr-only">{t('Search chats')}</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search chats')} />
      </label>
      {showStrip ? <ProfileStrip bots={bots!} profile={profile} onProfile={onProfile!} /> : null}
      {marks ? (
        <div className="filter-chips" role="tablist" aria-label={t('Filter')}>
          {FILTERS.map(({ value, label }) => (
            <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'on' : undefined} onClick={() => setFilter(value)}>
              {label()}
            </button>
          ))}
        </div>
      ) : null}
      <div className="chatlist-scroll" ref={scroller}>
        {rows === null && !error ? <div className="empty">{t('Loading chats…')}</div> : null}
        {error ? <div className="empty">{t('Couldn’t load your chats: {error}', { error })}</div> : null}
        {rows && sections.length === 0 && !query.trim() ? (
          <div className="empty">
            {filter === 'starred'
              ? t('No starred chats. Star one from its menu to keep it here.')
              : filter === 'unread'
                ? t('No unread chats.')
                : filter === 'running'
                  ? t('Nothing is running.')
                  : t('No chats yet. Start one with the + button.')}
          </div>
        ) : null}
        {sections.map(section => (
          <div key={section.title} role="group" aria-label={section.title}>
            <div className="sect">{section.title}</div>
            {section.rows.map(row => {
              const running = runningIds.has(row.id)
              return (
                <div
                  key={row.id}
                  className="row-wrap"
                  onContextMenu={
                    hasActions
                      ? e => {
                          e.preventDefault()
                          setMenu({ row, x: e.clientX, y: e.clientY })
                        }
                      : undefined
                  }
                >
                  {renaming?.id === row.id ? (
                    <input
                      className="row-rename"
                      aria-label={t('Rename')}
                      autoFocus
                      value={renaming.title}
                      onChange={e => setRenaming({ id: row.id, title: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter') finishRename(true)
                        else if (e.key === 'Escape') finishRename(false)
                      }}
                      onBlur={() => finishRename(true)}
                    />
                  ) : (
                    <button className="row" aria-current={row.id === selectedId ? 'true' : undefined} onClick={() => onSelect(row)}>
                      <span className="row-top">
                        <span className="row-title">
                          {marks && isUnread(marks, row) && row.id !== selectedId ? <span className="unread-dot" role="img" aria-label={t('Unread')} /> : null}
                          {row.pinned ? <Icon name="pin" className="row-pin" /> : null}
                          {marks && isStarred(marks, row) ? <Icon name="star" className="row-pin row-star" /> : null}
                          {row.title}
                        </span>
                        <span className="meta row-time">{timeLabel(row.activeAt)}</span>
                      </span>
                      {running ? (
                        <span className="running">
                          {t('Running')}
                          {runningStatus && row.id === selectedId ? ` · ${runningStatus}` : ''}
                        </span>
                      ) : row.preview || botName(row) ? (
                        <span className="meta">
                          {botName(row) ? `${botName(row)} · ` : ''}
                          {row.preview ?? ''}
                        </span>
                      ) : null}
                    </button>
                  )}
                  {hasActions && renaming?.id !== row.id ? (
                    <button
                      className="row-more"
                      aria-label={t('More')}
                      title={t('More')}
                      aria-haspopup="menu"
                      onClick={e => {
                        e.stopPropagation()
                        const box = e.currentTarget.getBoundingClientRect()
                        setMenu(m => (m?.row.id === row.id ? null : { row, x: box.right, y: box.bottom }))
                      }}
                    >
                      <Icon name="more" />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {menu ? (
        <div
          className="host-menu row-menu"
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 140) }}
        >
          {onPin ? (
            <button role="menuitem" onClick={() => onPin(menu.row)}>
              {menu.row.pinned ? t('Unpin') : t('Pin')}
            </button>
          ) : null}
          {onStar && marks ? (
            <button role="menuitem" onClick={() => onStar(menu.row)}>
              {isStarred(marks, menu.row) ? t('Unstar') : t('Star')}
            </button>
          ) : null}
          {onToggleRead && marks && menu.row.id !== selectedId ? (
            <button role="menuitem" onClick={() => onToggleRead(menu.row)}>
              {isUnread(marks, menu.row) ? t('Mark as read') : t('Mark as unread')}
            </button>
          ) : null}
          {onRename ? (
            <button role="menuitem" onClick={() => setRenaming({ id: menu.row.id, title: menu.row.title })}>
              {t('Rename')}
            </button>
          ) : null}
          {onDelete ? (
            <button role="menuitem" className="danger" onClick={() => onDelete(menu.row)}>
              {t('Delete')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** All, then each bot's face, the chosen one with its name: the list's profile. */
export function ProfileStrip({ bots, profile, onProfile }: { bots: Bot[]; profile: string | null; onProfile: (profile: string | null) => void }) {
  return (
    <div
      className="profile-strip"
      role="tablist"
      aria-label={t('Bots')}
      // A mouse wheel scrolls the strip sideways.
      onWheel={e => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      <button role="tab" className="profile-chip all" aria-selected={profile === null} onClick={() => onProfile(null)}>
        {t('All')}
      </button>
      {bots.map(bot => (
        // Only the chosen bot shows its name, so the strip fits the list's width; the rest are faces.
        <button
          key={bot.name}
          role="tab"
          className={`profile-chip${profile === bot.name ? '' : ' face-only'}`}
          aria-selected={profile === bot.name}
          aria-label={bot.title}
          title={bot.title}
          onClick={() => onProfile(profile === bot.name ? null : bot.name)}
        >
          <BotAvatar bot={bot} size={22} />
          {profile === bot.name ? <span>{bot.title}</span> : null}
        </button>
      ))}
    </div>
  )
}
