import { useEffect, useLayoutEffect, useRef } from 'react'
import type { TranscriptItem, TranscriptState } from '../state/transcript'
import { Icon } from './icons'
import { Markdown } from './Markdown'

function clock(ms?: number): string {
  return ms ? new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''
}

/** "terminal" → "Ran a command", the way the phone names its tool steps. */
function toolTitle(name: string, done: boolean): string {
  const known: Record<string, [string, string]> = {
    terminal: ['Running a command', 'Ran a command'],
    execute_code: ['Running code', 'Ran code'],
    read_file: ['Reading a file', 'Read a file'],
    write_file: ['Writing a file', 'Wrote a file'],
    patch: ['Editing a file', 'Edited a file'],
    search_files: ['Searching files', 'Searched files'],
    web_search: ['Searching the web', 'Searched the web'],
    web_extract: ['Reading a page', 'Read a page'],
    browser_navigate: ['Opening a page', 'Opened a page'],
    memory: ['Updating memory', 'Updated memory'],
    todo: ['Updating the plan', 'Updated the plan'],
    delegate_task: ['Handing off a task', 'Handed off a task']
  }
  const pair = known[name]
  if (pair) return done ? pair[1] : pair[0]
  const words = name.replace(/[_.-]+/g, ' ').trim()
  return done ? words.charAt(0).toUpperCase() + words.slice(1) : `${words.charAt(0).toUpperCase()}${words.slice(1)}…`
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className={`user${item.pending ? ' pending' : ''}`}>
          <div className="bubble">{item.text}</div>
          <span className="time">{item.pending ? 'Sending…' : clock(item.at)}</span>
        </div>
      )
    case 'assistant':
      return (
        <div className={`assistant${item.streaming ? ' streaming' : ''}`}>
          <Markdown text={item.text} />
        </div>
      )
    case 'thinking':
      return (
        <details className="thinking">
          <summary>
            <Icon name="chats" />
            {item.streaming ? 'Thinking…' : 'Thought'}
            <span className="show">Show</span>
          </summary>
          <div className="thinking-text">{item.text}</div>
        </details>
      )
    case 'tool': {
      const done = item.status === 'done'
      return (
        <div className="card">
          <span className={`card-icon${done ? '' : ' running'}`}>
            <Icon name={done ? 'code' : 'spinner'} style={done ? undefined : { animation: 'spin 1s linear infinite' }} />
          </span>
          <span className="card-body">
            <span className="card-title">
              {toolTitle(item.name, done)}{' '}
              {item.durationS != null ? <span className="time">{item.durationS.toFixed(1)}s</span> : null}
            </span>
            {item.context || item.summary ? <span className="card-detail">{item.summary || item.context}</span> : null}
          </span>
        </div>
      )
    }
    case 'notice':
      return <div className={`notice${item.tone === 'error' ? ' error' : ''}`}>{item.text}</div>
  }
}

export function Transcript({ state, loading, error }: { state: TranscriptState; loading: boolean; error: string | null }) {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow the reply while the reader is at the bottom; leave them be once they scroll up.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [state])

  return (
    <div className="transcript" ref={scroller} aria-live="polite">
      <div className="transcript-inner">
        {loading ? <div className="notice">Loading…</div> : null}
        {error ? <div className="notice error">{error}</div> : null}
        {!loading && !error && state.items.length === 0 ? (
          <div className="welcome">
            <h2>What can Hermes do for you?</h2>
            <span>Ask anything. Enter sends, Shift Enter adds a line.</span>
          </div>
        ) : null}
        {state.items.map(item => (
          <Item key={item.key} item={item} />
        ))}
        {state.running && state.status ? (
          <div className="status-line">
            <span className="running" />
            {state.status}
          </div>
        ) : null}
      </div>
    </div>
  )
}
