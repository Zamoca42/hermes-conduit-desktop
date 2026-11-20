import { useEffect, useMemo, useRef, useState } from 'react'
import { underSource } from '../state/voiceList'
import { includedInAll, profileGroups, readClosedSections, readGroupByProfile, readLeftOut, shownInAll, writeClosedSections, writeGroupByProfile, writeLeftOut } from '../state/profileGroups'
import { sectionRows, timeLabel, type ChatRow } from '../state/chats'
import type { Bot } from '../state/bots'
import { BotAvatar } from './BotsHome'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import { UpdatingCapsule } from './UpdatingCapsule'
import { filterRows, isStarred, isUnread, type ChatFilter, type ChatMarks } from '../state/chatMarks'
import { sourceName, sourcesIn, type ChatSource } from '../state/chatSources'
import { contentRows, useContentSearch } from '../state/contentSearch'
import { arrangePinned, moved, usePinnedOrder } from '../state/pinnedOrder'
import { gateway } from '../gateway'
import type { HostBadge, OtherChatRow } from '../state/keptHosts'
import { HostBadgeMark } from './CombinedDashboards'
import { EMPTY_NESTING, ancestorsOf, descendants, nestRows, nestSummary } from '../state/chatNesting'

const EXPANDED_NESTS = 'conduit.expanded-nests'
function readExpandedNests(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_NESTS) ?? '[]') as unknown
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}
function writeExpandedNests(ids: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_NESTS, JSON.stringify([...ids].slice(-200)))
  } catch {
    // Kept for this window only.
  }
}

const FILTERS: { value: ChatFilter; label: () => string }[] = [
  { value: 'all', label: () => t('All') },
  { value: 'starred', label: () => t('Starred') },
  { value: 'unread', label: () => t('Unread') },
  { value: 'running', label: () => t('Running') },
  { value: 'waiting', label: () => t('Needs approval') }
]
/** Done chats' chips, offered once the plugin keeps the marks. */
const DONE_FILTERS: { value: ChatFilter; label: () => string }[] = [
  { value: 'inprogress', label: () => t('In progress') },
  { value: 'done', label: () => t('Done') }
]

/** A section of the list: a date's (or Pinned), or a profile's when grouped by profile. */
interface ListSection {
  title: string
  rows: ChatRow[]
  profile?: string
  hidden?: number
  extra?: number
}

interface Props {
  rows: ChatRow[] | null
  error: string | null
  /** Rows that may be out of date are being read again: the Updating… capsule. */
  updating?: boolean
  selectedId: string | null
  runningIds: ReadonlySet<string>
  /** Chats Hermes waits on the user in (an approval or a question): Needs approval on the row. */
  waitingIds?: ReadonlySet<string>
  runningStatus?: string
  onSelect: (row: ChatRow) => void
  onNewChat: () => void
  /** The bots, for the profile strip and the rows' bot names. */
  bots?: Bot[] | null
  /** The profile the list shows (null: every one). */
  profile?: string | null
  onProfile?: (profile: string | null) => void
  /** Edit profile from a face's right-click in the strip. */
  onEditProfile?: (bot: Bot) => void
  /** A row's menu (right-click or ⋯): Pin or Unpin, Rename, Delete. */
  onPin?: (row: ChatRow) => void
  onRename?: (row: ChatRow, title: string) => void
  onDelete?: (row: ChatRow) => void
  /** Stars and read state, kept on this computer; the filter chips use them. */
  marks?: ChatMarks
  onStar?: (row: ChatRow) => void
  onToggleRead?: (row: ChatRow) => void
  /** Done chats, kept by the plugin: left out on a plugin that doesn't keep them. */
  isDone?: (row: ChatRow) => boolean
  onDone?: (row: ChatRow) => void
  /** Opens Projects, the phone's Chats › Projects. */
  onProjects?: () => void
  /** The host, so a Hermes without message search isn't asked again. */
  searchScope?: string
  /** Opens every pinned reply; left out while there are none. */
  onPinnedReplies?: () => void
  /** Move to Project: the projects a chat can move into (its profile's, each with its folder), read when asked. */
  moveTargets?: (row: ChatRow) => Promise<MoveTarget[]>
  onMove?: (row: ChatRow, target: MoveTarget) => void
  /** Open Beside: the row opens and the chat on screen stays beside it; only in a window wide enough for both. */
  onOpenBeside?: (row: ChatRow) => void
  canOpenBeside?: (row: ChatRow) => boolean
  /** Combined dashboards: the other hosts' chats, only in All, each opening through a switch. */
  otherRows?: OtherChatRow[]
  badgeFor?: (url: string) => HostBadge | null
  onOpenOther?: (row: OtherChatRow) => void
}

export interface MoveTarget {
  id: string
  title: string
  path: string
}

/** Profiles In messages asks at most, one request each. */
const MAX_SEARCH_PROFILES = 8
const NONE: ReadonlySet<string> = new Set()
const NO_ROWS: OtherChatRow[] = []
/** Grouped by profile, another host's section shows its newest five until Show more. */
const OTHER_HOST_ROWS = 5
const isOther = (row: ChatRow): row is OtherChatRow => typeof (row as Partial<OtherChatRow>).host === 'string'
const searchHttp = (path: string) => gateway.http('GET', path)
const prefsHttp = (method: 'GET' | 'PUT', path: string, body?: unknown) => gateway.http(method, path, body)

const sameProfile = (row: ChatRow, name: string) => (row.profile ?? 'default').toLowerCase() === name.toLowerCase()

export function ChatList({
  rows,
  updating,
  error,
  selectedId,
  runningIds,
  waitingIds = NONE,
  runningStatus,
  onSelect,
  onNewChat,
  bots,
  profile = null,
  onProfile,
  onEditProfile,
  onPin,
  onRename,
  onDelete,
  marks,
  onStar,
  onToggleRead,
  isDone,
  onDone,
  onProjects,
  onPinnedReplies,
  searchScope = '',
  moveTargets,
  onMove,
  onOpenBeside,
  canOpenBeside,
  otherRows = NO_ROWS,
  badgeFor,
  onOpenOther
}: Props) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ row: ChatRow; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const hasActions = !!(onPin || onRename || onDelete || onStar)
  // Move to Project's targets: null while they're read.
  const [moving, setMoving] = useState<MoveTarget[] | null | false>(false)
  const canMove = !!onMove && !!moveTargets
  useEffect(() => setMoving(false), [menu])
  async function startMove(row: ChatRow) {
    setMoving(null)
    const targets = await moveTargets!(row).catch(() => [])
    setMoving(current => (current === null ? targets : current))
  }
  const [filter, setFilter] = useState<ChatFilter>('all')
  /** The Sources filter: one source's chats, or null for every source. */
  const [source, setSource] = useState<ChatSource | null>(null)

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
  const pinOrder = usePinnedOrder(searchScope, rows, prefsHttp)
  // All profiles, grouped by profile: a section per profile with its pinned chats and five newest (issue 1560, #1571).
  // Offered under All with two or more profiles, as the profile strip is.
  const canGroup = !profile && (bots?.length ?? 0) > 1
  const [groupByProfile, setGroupByProfile] = useState(readGroupByProfile)
  const grouped = canGroup && groupByProfile
  const [showingAll, setShowingAll] = useState<Set<string>>(() => new Set())
  const [closedSections, setClosedSections] = useState<string[]>(readClosedSections)
  const toggleSection = (p: string) => {
    const next = closedSections.includes(p) ? closedSections.filter(x => x !== p) : [...closedSections, p]
    setClosedSections(next)
    writeClosedSections(next)
  }
  const profileTitle = (p: string) => bots?.find(b => b.name.toLowerCase() === p)?.title ?? p
  // Show in All: the profiles All lists, kept by the names left out (the phone's sheet from the All chip).
  const [leftOut, setLeftOut] = useState<string[]>(readLeftOut)
  const [showInAll, setShowInAll] = useState(false)
  const botNames = useMemo(() => (bots ?? []).map(b => b.name), [bots])
  const allLeftOut = canGroup ? leftOut : []
  const includeInAll = (name: string, on: boolean) => {
    const next = on ? leftOut.filter(p => p.toLowerCase() !== name.toLowerCase()) : [...leftOut, name]
    setLeftOut(next)
    writeLeftOut(next)
  }
  // Pinned rows move while the list shows every pinned chat: not during a search or under a filter, nor grouped by profile.
  const canReorder = !query.trim() && filter === 'all' && !source
  const { sections, listed, allowed, pinnedSection, nesting } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inProfile = profile
      ? (rows ?? []).filter(r => sameProfile(r, profile))
      : allLeftOut.length
        ? (rows ?? []).filter(r => shownInAll(r.profile, botNames, allLeftOut))
        : (rows ?? [])
    const marked = marks ? filterRows(inProfile, isDone || !DONE_FILTERS.some(f => f.value === filter) ? filter : 'all', marks, runningIds, waitingIds, isDone) : inProfile
    const sourced = source ? marked.filter(r => underSource(r, source)) : marked
    const filtered = q ? sourced.filter(r => `${r.title} ${r.preview ?? ''}`.toLowerCase().includes(q)) : sourced
    // Another combined host's chats, only in All with no filter: found by title or by the host's name.
    const others =
      !profile && filter === 'all' && !source
        ? otherRows.filter(r => !q || `${r.title} ${r.preview ?? ''} ${badgeFor?.(r.host)?.name ?? ''}`.toLowerCase().includes(q))
        : []
    const sections = sectionRows(grouped ? filtered : [...filtered, ...others])
    // The Pinned section in the person's order, arranged from every pinned chat the profile shown has.
    const pinned = arrangePinned(sectionRows(inProfile.filter(r => r.pinned))[0]?.rows ?? [], pinOrder.orders)
    const shown = new Set(filtered.map(r => r.id))
    const arranged: ListSection[] = grouped
      ? profileGroups(
          filtered,
          includedInAll(botNames, allLeftOut),
          {
            // A search or a status or Starred filter lists every match; a source filter is still a browse.
            capped: !q && filter === 'all',
            showsAll: p => showingAll.has(p),
            openId: selectedId,
            pinnedOrder: list => arrangePinned(list, pinOrder.orders)
          }
        ).map(group => ({ title: profileTitle(group.profile), rows: group.rows, profile: group.profile, hidden: group.hidden, extra: group.extra }))
      : sections.map(section => (section.rows[0]?.pinned ? { ...section, rows: pinned.filter(r => shown.has(r.id)) } : section))
    if (grouped) {
      // A section per other host, after this host's profiles.
      for (const host of [...new Set(others.map(r => r.host))]) {
        const key = `host:${host}`
        const all = others.filter(r => r.host === host).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
        const capped = !q && !showingAll.has(key) && all.length > OTHER_HOST_ROWS
        arranged.push({
          title: badgeFor?.(host)?.name ?? host,
          rows: capped ? all.slice(0, OTHER_HOST_ROWS) : all,
          profile: key,
          hidden: capped ? all.length - OTHER_HOST_ROWS : 0,
          extra: !capped && !q && all.length > OTHER_HOST_ROWS ? all.length - OTHER_HOST_ROWS : 0
        })
      }
    }
    // A job under the call or chat it came from, while the list is a browse: a search or a filter lists every row flat (the phone's nests).
    const nesting = !q && filter === 'all' && !source ? nestRows(arranged.flatMap(section => section.rows.filter(r => !isOther(r)))) : EMPTY_NESTING
    const nestedOut = nesting.nested.size
      ? arranged
          .map(section => ({ ...section, rows: section.rows.filter(r => isOther(r) || !nesting.nested.has(r.id)) }))
          .filter(section => section.profile !== undefined || section.rows.length)
      : arranged
    return { sections: nestedOut, listed: filtered, allowed: filter !== 'all' || source ? sourced : undefined, pinnedSection: pinned, nesting }
  }, [rows, query, profile, marks, filter, runningIds, waitingIds, isDone, source, pinOrder.orders, grouped, showingAll, selectedId, bots, botNames, allLeftOut, otherRows, badgeFor])
  /**
   * The pins a pinned row moves among: the Pinned section, or grouped by
   * profile its own section's, so a move there orders only that profile's
   * pins, as the phone's section does.
   */
  const pinsBeside = (row: ChatRow): ChatRow[] => {
    if (!grouped) return pinnedSection
    return sections.find(section => section.profile !== undefined && section.rows.some(r => r.id === row.id))?.rows.filter(r => r.pinned) ?? []
  }
  const movePinned = (row: ChatRow, to: number) => {
    const pins = pinsBeside(row)
    const from = pins.findIndex(r => r.id === row.id)
    const next = moved(pins, from, to)
    if (next !== pins) pinOrder.reorder(next)
  }
  const [expandedNests, setExpandedNests] = useState<Set<string>>(readExpandedNests)
  // The open chat's parents stay open, so its row shows.
  const openAncestors = useMemo(() => ancestorsOf(nesting, selectedId), [nesting, selectedId])
  const toggleNest = (id: string, open: boolean) =>
    setExpandedNests(current => {
      const next = new Set(current)
      if (open) next.add(id)
      else next.delete(id)
      writeExpandedNests(next)
      return next
    })
  type Item = { row: ChatRow; depth: number } | { nest: ChatRow; depth: number; open: boolean }
  const withNests = (list: ChatRow[]): Item[] => {
    if (!nesting.children.size) return list.map(row => ({ row, depth: 0 }))
    const out: Item[] = []
    const walk = (row: ChatRow, depth: number) => {
      out.push({ row, depth })
      if (!nesting.children.has(row.id)) return
      const open = expandedNests.has(row.id) || openAncestors.has(row.id)
      out.push({ nest: row, depth, open })
      if (open) for (const child of nesting.children.get(row.id)!) walk(child, depth + 1)
    }
    for (const row of list) walk(row, 0)
    return out
  }
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)
  // In messages: Hermes' full-text search, on the profile shown or every profile the list holds.
  const searchProfiles = useMemo(
    () =>
      profile
        ? [profile]
        : [...new Set((rows ?? []).filter(r => shownInAll(r.profile, botNames, allLeftOut)).map(r => r.profile || 'default'))].sort().slice(0, MAX_SEARCH_PROFILES),
    [rows, profile, botNames, allLeftOut]
  )
  const content = useContentSearch(query, rows ? searchProfiles : [], searchScope, searchHttp)
  const contentMatches = useMemo(
    () => (content.hits.length ? contentRows(content.hits, listed, rows ?? [], allowed).filter(m => !profile || sameProfile(m.row, profile)) : []),
    [content.hits, listed, rows, allowed, profile]
  )
  // The Sources filter shows once chats come from more than one place.
  const sources = useMemo(() => sourcesIn(rows ?? []), [rows])
  useEffect(() => {
    if (source && !sources.includes(source)) setSource(null)
  }, [sources, source])
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
        {onPinnedReplies ? (
          <button className="round" aria-label={t('Pinned replies')} title={t('Pinned replies')} onClick={onPinnedReplies}>
            <Icon name="pin" />
          </button>
        ) : null}
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
      {showStrip ? (
        <div className="profile-strip-wrap">
          <ProfileStrip bots={bots!} profile={profile} onProfile={onProfile!} onShowInAll={() => setShowInAll(true)} onEditProfile={onEditProfile} />
          {showInAll ? (
            <ShowInAll
              bots={bots!}
              leftOut={leftOut}
              onInclude={includeInAll}
              groupByProfile={groupByProfile}
              onGroupByProfile={on => {
                setGroupByProfile(on)
                writeGroupByProfile(on)
              }}
              onClose={() => setShowInAll(false)}
            />
          ) : null}
        </div>
      ) : null}
      {marks ? (
        <div className="filter-chips" role="tablist" aria-label={t('Filter')}>
          {(isDone ? [...FILTERS, ...DONE_FILTERS] : FILTERS).map(({ value, label }) => (
            <button key={value} role="tab" aria-selected={filter === value} className={filter === value ? 'on' : undefined} onClick={() => setFilter(value)}>
              {label()}
            </button>
          ))}
          {canGroup ? (
            <button
              role="switch"
              aria-checked={groupByProfile}
              className={groupByProfile ? 'on' : undefined}
              onClick={() => {
                setGroupByProfile(!groupByProfile)
                writeGroupByProfile(!groupByProfile)
              }}
            >
              {t('Group by profile')}
            </button>
          ) : null}
          {sources.length > 1 ? (
            <select
              className={`source-filter${source ? ' on' : ''}`}
              aria-label={t('Source')}
              value={source ?? ''}
              onChange={e => setSource((e.target.value || null) as ChatSource | null)}
            >
              <option value="">{t('All Sources')}</option>
              {sources.map(kind => (
                <option key={kind} value={kind}>
                  {sourceName(kind)}
                </option>
              ))}
            </select>
          ) : null}
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
                  : filter === 'waiting'
                    ? t('No chat is waiting on your answer.')
                    : filter === 'inprogress' && isDone
                      ? t('Every chat here is marked done.')
                      : filter === 'done' && isDone
                        ? t('No done chats. Mark one done from its menu.')
                        : t('No chats yet. Start one with the + button.')}
          </div>
        ) : null}
        {sections.map(section => (
          <div key={section.profile ?? section.title} role="group" aria-label={section.title}>
            {section.profile ? (
              <button className="sect sect-profile" aria-expanded={!closedSections.includes(section.profile)} onClick={() => toggleSection(section.profile!)}>
                <Icon name="chevronDown" className={closedSections.includes(section.profile) ? 'closed' : undefined} />
                {section.profile.startsWith('host:') && badgeFor?.(section.profile.slice(5)) ? <HostBadgeMark badge={badgeFor(section.profile.slice(5))!} /> : null}
                {section.title}
              </button>
            ) : (
              <div className="sect">{section.title}</div>
            )}
            {withNests(section.profile && closedSections.includes(section.profile) ? [] : section.rows).map(item => {
              if ('nest' in item) {
                const below = descendants(nesting, item.nest)
                const summary = nestSummary(
                  below,
                  r => runningIds.has(r.id),
                  r => waitingIds.has(r.id)
                )
                return (
                  <button
                    key={`nest:${item.nest.id}`}
                    className="nest-toggle"
                    style={{ paddingInlineStart: `${12 + item.depth * 16}px` }}
                    aria-expanded={item.open}
                    aria-label={`${item.nest.title}, ${summary}`}
                    onClick={() => toggleNest(item.nest.id, !item.open)}
                  >
                    <Icon name="chevronDown" className={item.open ? undefined : 'closed'} />
                    {summary}
                  </button>
                )
              }
              const row = item.row
              const depth = item.depth
              // A closed nest's unread reply shows on its parent, so it never hides.
              const nestUnread =
                !!marks && nesting.children.has(row.id) && !(expandedNests.has(row.id) || openAncestors.has(row.id)) && descendants(nesting, row).some(r => isUnread(marks, r) && r.id !== selectedId)
              if (isOther(row)) {
                const badge = badgeFor?.(row.host) ?? null
                return (
                  <div key={`${row.host}\n${row.id}`} className="row-wrap">
                    <button className="row" onClick={() => onOpenOther?.(row)}>
                      <span className="row-top">
                        <span className="row-title">
                          {badge ? <HostBadgeMark badge={badge} /> : null}
                          {row.title}
                        </span>
                        <span className="meta row-time">{timeLabel(row.activeAt)}</span>
                      </span>
                      {row.preview || (row.profile && row.profile !== 'default') ? (
                        <span className="meta">
                          {row.profile && row.profile !== 'default' ? `${row.profile} · ` : ''}
                          {row.preview ?? ''}
                        </span>
                      ) : null}
                    </button>
                  </div>
                )
              }
              const waits = waitingIds.has(row.id)
              const running = !waits && runningIds.has(row.id)
              return (
                <div
                  key={row.id}
                  style={depth ? { marginInlineStart: `${14 + (depth - 1) * 16}px` } : undefined}
                  className={`row-wrap${depth ? ' nested' : ''}${dragging === row.id ? ' dragging' : ''}${dropAt?.id === row.id ? (dropAt.after ? ' drop-after' : ' drop-before') : ''}`}
                  draggable={canReorder && row.pinned && !renaming ? true : undefined}
                  onDragStart={
                    canReorder && row.pinned
                      ? e => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', row.title)
                          setDragging(row.id)
                        }
                      : undefined
                  }
                  onDragOver={
                    dragging && row.pinned && pinsBeside(row).some(r => r.id === dragging)
                      ? e => {
                          e.preventDefault()
                          const box = e.currentTarget.getBoundingClientRect()
                          const after = e.clientY > box.top + box.height / 2
                          if (dropAt?.id !== row.id || dropAt.after !== after) setDropAt({ id: row.id, after })
                        }
                      : undefined
                  }
                  onDrop={
                    dragging && row.pinned && pinsBeside(row).some(r => r.id === dragging)
                      ? e => {
                          e.preventDefault()
                          const pins = pinsBeside(row)
                          const moving = pins.find(r => r.id === dragging)
                          const from = pins.findIndex(r => r.id === dragging)
                          let to = pins.findIndex(r => r.id === row.id) + (dropAt?.after ? 1 : 0)
                          if (from < to) to -= 1
                          if (moving) movePinned(moving, to)
                          setDragging(null)
                          setDropAt(null)
                        }
                      : undefined
                  }
                  onDragEnd={() => {
                    setDragging(null)
                    setDropAt(null)
                  }}
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
                    <button className={isDone?.(row) ? 'row done' : 'row'} aria-current={row.id === selectedId ? 'true' : undefined} onClick={() => onSelect(row)}>
                      <span className="row-top">
                        <span className="row-title">
                          {(marks && isUnread(marks, row) && row.id !== selectedId) || nestUnread ? <span className="unread-dot" role="img" aria-label={t('Unread')} /> : null}
                          {row.pinned ? <Icon name="pin" className="row-pin" /> : null}
                          {marks && isStarred(marks, row) ? <Icon name="star" className="row-pin row-star" /> : null}
                          {isDone?.(row) ? <Icon name="check" className="row-pin row-done" aria-label={t('Done')} /> : null}
                          {row.title}
                        </span>
                        {row.sourceKind && row.sourceKind !== 'chat' ? <span className="row-source">{sourceName(row.sourceKind)}</span> : null}
                        <span className="meta row-time">{timeLabel(row.activeAt)}</span>
                      </span>
                      {waits ? (
                        <span className="running waiting">{t('Needs approval')}</span>
                      ) : running ? (
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
            {section.profile && !closedSections.includes(section.profile) && (section.hidden || section.extra) ? (
              <button
                className="row show-more"
                onClick={() =>
                  setShowingAll(current => {
                    const next = new Set(current)
                    if (section.hidden) next.add(section.profile!)
                    else next.delete(section.profile!)
                    return next
                  })
                }
              >
                {section.hidden ? t('Show {count} more', { count: section.hidden }) : t('Show fewer')}
              </button>
            ) : null}
          </div>
        ))}
        {query.trim() && (contentMatches.length || content.searching) ? (
          <div role="group" aria-label={t('In messages')}>
            <div className="sect content-sect">
              {t('In messages')}
              {content.searching ? (
                <span className="content-spinner" role="status" aria-label={t('Searching messages')}>
                  <Icon name="spinner" />
                </span>
              ) : null}
            </div>
            {contentMatches.map(match => (
              <div key={match.key} className="row-wrap">
                <button className="row" aria-current={match.row.id === selectedId ? 'true' : undefined} onClick={() => onSelect(match.row)}>
                  <span className="row-top">
                    <span className="row-title">{match.row.title || t('Untitled conversation')}</span>
                    <span className="meta row-time">{timeLabel(match.row.activeAt)}</span>
                  </span>
                  <span className="meta content-snippet">
                    {botName(match.row) ? `${botName(match.row)} · ` : ''}
                    {match.snippet.map((run, i) => (run.match ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>))}
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {rows && query.trim() && !sections.length && !contentMatches.length && !content.searching ? (
          <div className="empty">{t('No matching conversations')}</div>
        ) : null}
      </div>
      <UpdatingCapsule shown={!!updating && sections.length > 0} />
      {menu ? (
        <div
          className="host-menu row-menu"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 220),
            top: Math.max(8, Math.min(menu.y, window.innerHeight - (moving ? 52 + 34 * Math.max(1, moving.length) : 220)))
          }}
        >
          {moving !== false ? (
            <>
              <button
                role="menuitem"
                onClick={e => {
                  e.stopPropagation()
                  setMoving(false)
                }}
              >
                ‹ {t('Move to Project')}
              </button>
              {moving === null ? <div className="menu-note">{t('Loading projects…')}</div> : null}
              {moving && !moving.length ? <div className="menu-note">{t('No Projects')}</div> : null}
              {moving?.map(target => (
                <button key={target.id} role="menuitem" title={target.path} onClick={() => onMove?.(menu.row, target)}>
                  {target.title}
                </button>
              ))}
            </>
          ) : (
            <>
              {onOpenBeside && canOpenBeside?.(menu.row) ? (
                <button role="menuitem" onClick={() => onOpenBeside(menu.row)}>
                  {t('Open Beside')}
                </button>
              ) : null}
              {onPin ? (
                <button
                  role="menuitem"
                  onClick={() => {
                    if (menu.row.pinned) pinOrder.drop(menu.row)
                    onPin(menu.row)
                  }}
                >
                  {menu.row.pinned ? t('Unpin') : t('Pin')}
                </button>
              ) : null}
              {canReorder && menu.row.pinned && pinsBeside(menu.row).length > 1
                ? (() => {
                    const pins = pinsBeside(menu.row)
                    const at = pins.findIndex(r => r.id === menu.row.id)
                    return (
                      <>
                        {at > 0 ? (
                          <button role="menuitem" onClick={() => movePinned(menu.row, at - 1)}>
                            {t('Move Earlier')}
                          </button>
                        ) : null}
                        {at >= 0 && at < pins.length - 1 ? (
                          <button role="menuitem" onClick={() => movePinned(menu.row, at + 1)}>
                            {t('Move Later')}
                          </button>
                        ) : null}
                      </>
                    )
                  })()
                : null}
              {onStar && marks ? (
                <button role="menuitem" onClick={() => onStar(menu.row)}>
                  {isStarred(marks, menu.row) ? t('Unstar') : t('Star')}
                </button>
              ) : null}
              {onDone && isDone ? (
                <button role="menuitem" onClick={() => onDone(menu.row)}>
                  {isDone(menu.row) ? t('Mark as Not Done') : t('Mark as Done')}
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
              {canMove ? (
                <button
                  role="menuitem"
                  aria-haspopup="menu"
                  onClick={e => {
                    e.stopPropagation()
                    void startMove(menu.row)
                  }}
                >
                  {t('Move to Project')} ›
                </button>
              ) : null}
              {onDelete ? (
                <button role="menuitem" className="danger" onClick={() => onDelete(menu.row)}>
                  {t('Delete')}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}

/**
 * Show in All, from the All chip (right-click, or a click while All is
 * already chosen): which profiles All lists, and Group by profile. The last
 * profile left in can't be turned off, so All never lists nothing.
 */
function ShowInAll({
  bots,
  leftOut,
  onInclude,
  groupByProfile,
  onGroupByProfile,
  onClose
}: {
  bots: Bot[]
  leftOut: string[]
  onInclude: (name: string, on: boolean) => void
  groupByProfile: boolean
  onGroupByProfile: (on: boolean) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const included = includedInAll(
    bots.map(b => b.name),
    leftOut
  )
  const isIn = (name: string) => included.some(p => p.toLowerCase() === name.toLowerCase())
  return (
    <div className="host-menu show-in-all" role="dialog" aria-label={t('Show in All')} ref={ref}>
      <strong>{t('Show in All')}</strong>
      <span className="meta">{t("All lists these profiles' chats together, newest first. A new chat asks which profile to use.")}</span>
      {bots.map(bot => (
        <label key={bot.name} className="show-in-all-row">
          <BotAvatar bot={bot} size={22} />
          <span className="show-in-all-name">{bot.title}</span>
          <input
            type="checkbox"
            checked={isIn(bot.name)}
            disabled={isIn(bot.name) && included.length === 1}
            aria-label={t('{name} profile', { name: bot.title })}
            onChange={e => onInclude(bot.name, e.target.checked)}
          />
        </label>
      ))}
      <label className="show-in-all-row group">
        <span className="show-in-all-name">{t('Group by profile')}</span>
        <input type="checkbox" checked={groupByProfile} onChange={e => onGroupByProfile(e.target.checked)} />
      </label>
    </div>
  )
}

/** All, then each bot's face, the chosen one with its name: the list's profile. */
export function ProfileStrip({
  bots,
  profile,
  onProfile,
  onShowInAll,
  onEditProfile
}: {
  bots: Bot[]
  profile: string | null
  onProfile: (profile: string | null) => void
  /** Opens Show in All: from a right-click on All, or a click on All while it's chosen. */
  onShowInAll?: () => void
  /** Edit profile from a face's right-click: the phone's Profiles card Edit menu (name, picture and the rest). */
  onEditProfile?: (bot: Bot) => void
}) {
  const [menu, setMenu] = useState<{ bot: Bot; x: number; y: number } | null>(null)
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
  return (
    <>
    <div
      className="profile-strip"
      role="tablist"
      aria-label={t('Bots')}
      // A mouse wheel scrolls the strip sideways.
      onWheel={e => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
      }}
    >
      <button
        role="tab"
        className="profile-chip all"
        aria-selected={profile === null}
        title={onShowInAll ? t('Right-click to choose which profiles All shows') : undefined}
        onClick={() => (profile === null && onShowInAll ? onShowInAll() : onProfile(null))}
        onContextMenu={
          onShowInAll
            ? e => {
                e.preventDefault()
                onShowInAll()
              }
            : undefined
        }
      >
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
          onContextMenu={
            onEditProfile
              ? e => {
                  e.preventDefault()
                  setMenu({ bot, x: e.clientX, y: e.clientY })
                }
              : undefined
          }
        >
          <BotAvatar bot={bot} size={22} />
          {profile === bot.name ? <span>{bot.title}</span> : null}
        </button>
      ))}
    </div>
    {menu && onEditProfile ? (
      <div className="host-menu row-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 60) }}>
        <button role="menuitem" onClick={() => onEditProfile(menu.bot)}>
          {t('Edit profile')}
        </button>
      </div>
    ) : null}
    </>
  )
}
