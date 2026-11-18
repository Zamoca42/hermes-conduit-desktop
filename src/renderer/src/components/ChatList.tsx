import { useMemo, useState } from 'react'
import { sectionRows, timeLabel, type ChatRow } from '../state/chats'
import { Icon } from './icons'

interface Props {
  rows: ChatRow[] | null
  error: string | null
  selectedId: string | null
  runningIds: ReadonlySet<string>
  runningStatus?: string
  onSelect: (row: ChatRow) => void
  onNewChat: () => void
}

export function ChatList({ rows, error, selectedId, runningIds, runningStatus, onSelect, onNewChat }: Props) {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? (rows ?? []).filter(r => `${r.title} ${r.preview ?? ''}`.toLowerCase().includes(q)) : (rows ?? [])
    return sectionRows(filtered)
  }, [rows, query])

  return (
    <section className="chatlist" aria-label="Chats">
      <div className="chatlist-head">
        <h1>Chats</h1>
        <button className="round" aria-label="New chat" title="New chat (Ctrl N)" onClick={onNewChat}>
          <Icon name="plus" />
        </button>
      </div>
      <label className="chatlist-search">
        <Icon name="search" />
        <span className="sr-only">Search chats</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" />
      </label>
      <div className="chatlist-scroll">
        {rows === null && !error ? <div className="empty">Loading chats…</div> : null}
        {error ? <div className="empty">Couldn’t load your chats: {error}</div> : null}
        {rows && rows.length === 0 ? <div className="empty">No chats yet. Start one with the + button.</div> : null}
        {sections.map(section => (
          <div key={section.title} role="group" aria-label={section.title}>
            <div className="sect">{section.title}</div>
            {section.rows.map(row => {
              const running = runningIds.has(row.id)
              return (
                <button
                  key={row.id}
                  className="row"
                  aria-current={row.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(row)}
                >
                  <span className="row-top">
                    <span className="row-title">{row.title}</span>
                    <span className="meta row-time">{timeLabel(row.activeAt)}</span>
                  </span>
                  {running ? (
                    <span className="running">Running{runningStatus && row.id === selectedId ? ` · ${runningStatus}` : ''}</span>
                  ) : row.preview || (row.profile && row.profile !== 'default') ? (
                    <span className="meta">
                      {row.profile && row.profile !== 'default' ? `${row.profile} · ` : ''}
                      {row.preview ?? ''}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
