import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { mediaKind, splitReply } from '../state/media'
import { baseName, type Attachment } from '../state/text'
import { displayName } from '../state/attachments'
import type { PendingRequest } from '@shared/ipc'
import type { TranscriptItem, TranscriptState } from '../state/transcript'
import { RequestCard } from './RequestCard'
import { Icon, type IconName } from './icons'
import { Markdown } from './Markdown'
import { GatewayPicture, PictureImage, PictureProfile } from './Picture'
import { locale, t } from '@shared/i18n'

const MEDIA_ICONS: Record<ReturnType<typeof mediaKind>, IconName> = { image: 'image', audio: 'audio', video: 'video', file: 'file' }

/** A file Hermes delivered (`MEDIA:`) or a message named (`@file:`): its name, with the full path on hover. */
function FileCard({ path, label, link }: { path: string; label?: string; link?: boolean }) {
  const name = label || (link ? path : baseName(path))
  const folder = path.slice(0, Math.max(0, path.length - baseName(path).length)).replace(/[\\/]+$/, '')
  return (
    <div className="file-card" title={path}>
      <span className="file-icon">
        <Icon name={link ? 'link' : MEDIA_ICONS[mediaKind(path)]} />
      </span>
      <span className="file-body">
        <span className="file-name">{name}</span>
        {!link && folder ? <span className="file-path">{folder}</span> : null}
      </span>
    </div>
  )
}

function FileChip({ attachment: a }: { attachment: Attachment }) {
  return (
    <span className="chip" title={a.value}>
      <Icon name={a.kind === 'image' ? 'image' : 'file'} />
      <span>{displayName(baseName(a.value))}</span>
    </span>
  )
}

function AttachmentChips({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="attachments">
      {attachments.map((a, i) =>
        a.kind === 'url' ? (
          <a key={i} className="chip" href={a.value} target="_blank" rel="noreferrer" title={a.value}>
            <Icon name="link" />
            <span>{a.value.replace(/^https?:\/\//, '')}</span>
          </a>
        ) : a.kind === 'image' && a.preview ? (
          <PictureImage key={i} src={a.preview} name={baseName(a.value)} />
        ) : a.kind === 'image' ? (
          <GatewayPicture key={i} path={a.value} name={baseName(a.value)} fallback={<FileChip attachment={a} />} />
        ) : (
          <FileChip key={i} attachment={a} />
        )
      )}
    </div>
  )
}

/** A reply's Markdown, with each `MEDIA:` file as a card where the tag stood. */
export const Reply = memo(function Reply({ text }: { text: string }) {
  const blocks = useMemo(() => splitReply(text), [text])
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'markdown' ? (
          <Markdown key={i} text={block.text} />
        ) : mediaKind(block.path) === 'image' ? (
          <GatewayPicture
            key={i}
            path={block.path}
            name={block.alt || baseName(block.path)}
            className="reply-picture"
            fallback={<FileCard path={block.path} label={block.alt} />}
          />
        ) : (
          <FileCard key={i} path={block.path} label={block.alt} />
        )
      )}
    </>
  )
})

export function clock(ms?: number): string {
  return ms ? new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) : ''
}

/** "terminal" → "Ran a command", the way the phone names its tool steps. */
function toolTitle(name: string, done: boolean): string {
  const known: Record<string, [string, string]> = {
    terminal: [t('Running a command'), t('Ran a command')],
    execute_code: [t('Running code'), t('Ran code')],
    read_file: [t('Reading a file'), t('Read a file')],
    write_file: [t('Writing a file'), t('Wrote a file')],
    patch: [t('Editing a file'), t('Edited a file')],
    search_files: [t('Searching files'), t('Searched files')],
    web_search: [t('Searching the web'), t('Searched the web')],
    web_extract: [t('Reading a page'), t('Read a page')],
    browser_navigate: [t('Opening a page'), t('Opened a page')],
    memory: [t('Updating memory'), t('Updated memory')],
    todo: [t('Updating the plan'), t('Updated the plan')],
    delegate_task: [t('Handing off a task'), t('Handed off a task')]
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
          {item.attachments?.length ? <AttachmentChips attachments={item.attachments} /> : null}
          {item.text ? <div className="bubble">{item.text}</div> : null}
          <span className="time">{item.pending ? t('Sending…') : clock(item.at)}</span>
        </div>
      )
    case 'assistant':
      return (
        <div className={`assistant${item.streaming ? ' streaming' : ''}`}>
          <Reply text={item.text} />
        </div>
      )
    case 'thinking':
      return (
        <details className="thinking">
          <summary>
            <Icon name="chats" />
            {item.streaming ? t('Thinking…') : t('Thought')}
            <span className="show">{t('Show')}</span>
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

export function Transcript({
  state,
  loading,
  error,
  requests = [],
  profile
}: {
  state: TranscriptState
  loading: boolean
  error: string | null
  /** The approvals and questions this chat waits on, drawn after its last item. */
  requests?: PendingRequest[]
  /** The chat's profile, whose files its pictures are read from. */
  profile?: string
}) {
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
  }, [state, requests])

  return (
    <PictureProfile.Provider value={profile}>
    <div className="transcript" ref={scroller} aria-live="polite">
      <div className="transcript-inner">
        {loading ? <div className="notice">{t('Loading…')}</div> : null}
        {error ? <div className="notice error">{error}</div> : null}
        {!loading && !error && state.items.length === 0 ? (
          <div className="welcome">
            <h2>{t('What can Hermes do for you?')}</h2>
            <span>{t('Ask anything. Enter sends, Shift Enter adds a line.')}</span>
          </div>
        ) : null}
        {state.items.map(item => (
          <Item key={item.key} item={item} />
        ))}
        {requests.map(request => (
          <RequestCard key={request.id} request={request} />
        ))}
        {state.running && state.status ? (
          <div className="status-line">
            <span className="running" />
            {state.status}
          </div>
        ) : null}
      </div>
    </div>
    </PictureProfile.Provider>
  )
}
