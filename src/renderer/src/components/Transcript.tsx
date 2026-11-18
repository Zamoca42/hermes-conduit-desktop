import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { blockquote, copyableReply, excerpt, parseReplyEnvelope, sameQuotedText, type QuoteRequest } from '../state/quote'
import { BoardView } from './BoardView'
import { DEFAULT_DISPLAY, type ChatDisplay } from '../state/display'
import { readAloud, stopReading, useReadingKey } from '../state/readAloud'
import { VOICE_FILE_PREFIX, parseVoiceMessage } from '../state/voice'

export interface MessageMenuItem {
  label: string
  onSelect: () => void
}

/** Copy, and ⋯ with the rest (Quote, Retry…), under a message on hover. */
export function MessageActions({ copy, menu = [] }: { copy: string; menu?: MessageMenuItem[] }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className={`message-actions${open ? ' open' : ''}`}>
      <button
        className="message-action"
        aria-label={copied ? t('Copied') : t('Copy')}
        title={copied ? t('Copied') : t('Copy')}
        onClick={() => {
          window.conduit.copyText(copy)
          setCopied(true)
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
      {menu.length ? (
        <span className="message-more">
          <button
            className="message-action"
            aria-label={t('More')}
            title={t('More')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={e => {
              e.stopPropagation()
              setOpen(o => !o)
            }}
          >
            <Icon name="more" />
          </button>
          {open ? (
            <div className="host-menu message-menu" role="menu">
              {menu.map(item => (
                <button
                  key={item.label}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

/** The "Replying to" card on a sent message: the quoted message in a line, a click away. */
export function QuotedCard({ name, quote, onJump }: { name: string; quote: string; onJump?: () => void }) {
  return (
    <button className="quoted-card" title={onJump ? t('Show the message') : quote} onClick={onJump} disabled={!onJump}>
      <span className="quoted-card-name">{t('Replying to {name}', { name })}</span>
      <span className="quoted-card-text">{excerpt(quote)}</span>
    </button>
  )
}

/** Scrolls to the message a card quoted and flashes it. */
export function revealMessage(container: HTMLElement | null, key: string | undefined) {
  if (!container || !key) return
  const el = container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove('flash')
  void el.offsetWidth
  el.classList.add('flash')
}

/** Words /undo gave back, for the draft: a message that replied to another gets its "Replying to" chip back. */
export function prefillRequest(text: string, author: string): QuoteRequest {
  const envelope = parseReplyEnvelope(text)
  return envelope
    ? ({ id: ++quoteIds, draft: envelope.message, reply: { author, text: envelope.quote } } as QuoteRequest)
    : ({ id: ++quoteIds, draft: text } as QuoteRequest)
}

let quoteIds = 0
/** A fresh quote request. */
export function quoteRequest(content: { text: string } | { reply: { author: string; text: string } } | { draft: string } | { insert: string }): QuoteRequest {
  return { id: ++quoteIds, ...content } as QuoteRequest
}

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

interface ItemProps {
  item: TranscriptItem
  /** Who answers in this chat, for "Replying to". */
  author: string
  onQuote?: (request: QuoteRequest) => void
  /** The card's click for a quote, when the quoted reply is loaded. */
  jump: (quote: string) => (() => void) | undefined
  /** ⋯'s Retry, on the newest reply while it answers the last message sent. */
  onRetry?: () => void
  /** ⋯'s Edit and resend on this message of yours. */
  onEdit?: () => void
  /** A board's follow-up, sent as the user's message: on the last turn's last board. */
  onFollowUp?: (text: string) => void
  /** ⋯'s Show thinking or Hide thinking, on a reply while Thinking is On request. */
  thinkingToggle?: { label: string; onSelect: () => void }
  /** Settings > Chat > Keep tool cards expanded. */
  expandTools?: boolean
}

/** A reply's Copy and ⋯, with Read Aloud (Stop reading response while it plays). */
/** A scheduled job's report the bot was only shown, after the phone's CronReportCard: folded to a preview, Show all opens it. */
function CronReportCard({ job, report, at }: { job: string; report: string; at?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cron-report">
      <div className="cron-report-head">
        <Icon name="clock" />
        <strong>{job}</strong>
        <span className="spacer" />
        {report ? (
          <button className="link" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            {open ? t('Show less') : t('Show all')}
          </button>
        ) : null}
      </div>
      {report ? <div className={open ? 'cron-report-body' : 'cron-report-body folded'}>{open ? <Markdown text={report} /> : report}</div> : null}
      <span className="meta">
        {t('Scheduled job report')}
        {at ? ` · ${clock(at)}` : ''}
      </span>
    </div>
  )
}

function ReplyActions({ messageKey, text, menu }: { messageKey: string; text: string; menu: MessageMenuItem[] }) {
  const reading = useReadingKey() === messageKey
  const profile = useContext(PictureProfile)
  const [problem, setProblem] = useState<string | null>(null)
  const read = {
    label: reading ? t('Stop reading response') : t('Read Aloud'),
    onSelect: () => {
      setProblem(null)
      if (reading) return stopReading()
      readAloud(messageKey, text, profile).catch(e => setProblem(e instanceof Error ? e.message : String(e)))
    }
  }
  return (
    <>
      <MessageActions copy={copyableReply(text)} menu={[...menu, read]} />
      {problem ? (
        <div className="read-problem" role="status">
          {t("Hermes couldn't read this aloud: {error}", { error: problem })}
        </div>
      ) : null}
    </>
  )
}

function Item({ item, author, onQuote, jump, onRetry, onEdit, onFollowUp, thinkingToggle, expandTools }: ItemProps) {
  switch (item.kind) {
    case 'user': {
      const envelope = parseReplyEnvelope(item.text)
      const words = envelope ? envelope.message : item.text
      const voice = parseVoiceMessage(words)
      // A voice message's audio is the message itself, not a file beside it.
      const files = voice ? item.attachments?.filter(a => !baseName(a.value).includes(VOICE_FILE_PREFIX)) : item.attachments
      return (
        <div className={`user${item.pending ? ' pending' : ''}`} data-key={item.key}>
          {envelope ? <QuotedCard name={author} quote={envelope.quote} onJump={jump(envelope.quote)} /> : null}
          {files?.length ? <AttachmentChips attachments={files} /> : null}
          {voice ? (
            <div className="bubble voice-bubble">
              <span className="voice-head">
                <Icon name="mic" />
                {t('Voice message')} · {voice.duration}
              </span>
              {voice.transcript ? <span>{voice.transcript}</span> : null}
            </div>
          ) : words.trim() ? (
            <div className="bubble">{words}</div>
          ) : null}
          <span className="time">{item.pending ? t('Sending…') : clock(item.at)}</span>
          {!item.pending && words.trim() ? (
            <MessageActions
              copy={voice ? voice.transcript || words : words}
              menu={[
                ...(onQuote ? [{ label: t('Quote'), onSelect: () => onQuote(quoteRequest({ text: blockquote(words) })) }] : []),
                ...(onEdit ? [{ label: t('Edit and resend'), onSelect: onEdit }] : [])
              ]}
            />
          ) : null}
        </div>
      )
    }
    case 'assistant':
      return (
        <div className={`assistant${item.streaming ? ' streaming' : ''}`} data-key={item.key}>
          <Reply text={item.text} />
          {!item.streaming && item.text.trim() ? (
            <ReplyActions
              messageKey={item.key}
              text={item.text}
              menu={[
                ...(onQuote ? [{ label: t('Quote'), onSelect: () => onQuote(quoteRequest({ reply: { author, text: item.text } })) }] : []),
                ...(onRetry ? [{ label: t('Retry'), onSelect: onRetry }] : []),
                ...(thinkingToggle ? [thinkingToggle] : [])
              ]}
            />
          ) : null}
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
      if (item.board) return <BoardView board={item.board} onFollowUp={onFollowUp} />
      const head = (
        <>
          <span className={`card-icon${done ? '' : ' running'}`}>
            <Icon name={done ? 'code' : 'spinner'} style={done ? undefined : { animation: 'spin 1s linear infinite' }} />
          </span>
          <span className="card-body">
            <span className="card-title">
              {toolTitle(item.name, done)} {item.durationS != null ? <span className="time">{item.durationS.toFixed(1)}s</span> : null}
            </span>
            {item.context || item.summary ? <span className="card-detail">{item.summary || item.context}</span> : null}
          </span>
        </>
      )
      // A finished call's arguments and result open under it, kept open by Settings > Chat.
      if (!done || (!item.args && !item.result)) return <div className="card">{head}</div>
      return (
        <details className="card-details" open={expandTools}>
          <summary className="card">{head}</summary>
          {item.args ? (
            <div className="card-section">
              <span className="meta">{t('Input')}</span>
              <pre>{item.args}</pre>
            </div>
          ) : null}
          {item.result ? (
            <div className="card-section">
              <span className="meta">{t('Output')}</span>
              <pre>{item.result}</pre>
            </div>
          ) : null}
        </details>
      )
    }
    case 'cron':
      return <CronReportCard job={item.job} report={item.report} at={item.at} />
    case 'review':
      return (
        <details className="review-card" data-key={item.key}>
          <summary>
            <span className="review-label">{t('SELF-IMPROVEMENT REVIEW')}</span>
            <span className="review-summary">{item.summary}</span>
          </summary>
          {item.details.length ? (
            <ul>
              {item.details.map(detail => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </details>
      )
    case 'notice':
      return <div className={`notice${item.tone === 'error' ? ' error' : ''}`}>{item.text}</div>
    case 'output':
      return (
        <div className="command-output" data-key={item.key}>
          {item.command ? <div className="command-name">{item.command}</div> : null}
          {item.format === 'plain' ? (
            <pre>{item.text}</pre>
          ) : (
            <div className="assistant">
              <Markdown text={item.text} />
            </div>
          )}
        </div>
      )
  }
}

export function Transcript({
  state,
  loading,
  error,
  requests = [],
  profile,
  author = 'Hermes',
  onQuote,
  onCommand,
  display = DEFAULT_DISPLAY
}: {
  state: TranscriptState
  loading: boolean
  error: string | null
  /** The approvals and questions this chat waits on, drawn after its last item. */
  requests?: PendingRequest[]
  /** The chat's profile, whose files its pictures are read from. */
  profile?: string
  /** Who answers in this chat, named on "Replying to". */
  author?: string
  /** Quote goes to the composer; without it there is only Copy. */
  onQuote?: (request: QuoteRequest) => void
  /** Runs a slash command for ⋯'s Retry (`/retry`) and Edit and resend (`/undo N`). */
  onCommand?: (command: string) => void
  /** The profile's Thinking and Tool cards settings. */
  display?: ChatDisplay
}) {
  const [thinkingShown, setThinkingShown] = useState(false)
  const showsThinking = display.thinking === 'show' || (display.thinking === 'on_request' && thinkingShown)
  const hasThinking = display.thinking === 'on_request' && state.items.some(i => i.kind === 'thinking')
  const thinkingToggle = hasThinking
    ? { label: thinkingShown ? t('Hide thinking') : t('Show thinking'), onSelect: () => setThinkingShown(shown => !shown) }
    : undefined
  const shown = useMemo(
    () =>
      state.items.filter(item =>
        item.kind === 'thinking' ? showsThinking : item.kind === 'tool' && !item.board ? display.toolCards : item.kind === 'review' ? display.showReviews : true
      ),
    [state.items, showsThinking, display.toolCards, display.showReviews]
  )
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

  // Retry is on the newest reply while it answers the last message sent;
  // Edit and resend on a message of yours with only words, which /undo can give back.
  const actions = useMemo(() => {
    const retryKey = new Set<string>()
    const editTurns = new Map<string, number>()
    let followUpKey: string | undefined
    if (!onCommand || state.running) return { retryKey, editTurns, followUpKey }
    const items = state.items
    // Nothing sent since the last turn's last board: a follow-up asks the next question.
    for (let i = items.length - 1; i >= 0 && items[i]!.kind !== 'user'; i--) {
      const row = items[i]!
      if (row.kind === 'tool' && row.board) {
        if (row.board.next.length) followUpKey = row.key
        break
      }
    }
    const lastUser = items.map(i => i.kind).lastIndexOf('user')
    const lastReply = items.map(i => i.kind).lastIndexOf('assistant')
    if (lastReply > lastUser && lastUser >= 0) retryKey.add(items[lastReply]!.key)
    let turns = 0
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (item.kind !== 'user' || item.pending) continue
      turns++
      if (!item.attachments?.length) editTurns.set(item.key, turns)
    }
    return { retryKey, editTurns, followUpKey }
  }, [state, onCommand])

  const retry = () => {
    const lastUser = state.items.map(i => i.kind).lastIndexOf('user')
    const ranSteps = state.items.slice(lastUser + 1).some(i => i.kind === 'tool')
    // Steps run again: a file written, a message sent, twice.
    if (ranSteps && !window.confirm(`${t('Retry this reply?')}\n\n${t('Steps ran for this reply, and retrying runs them again.')}`)) return
    onCommand?.('/retry')
  }

  const edit = (turns: number) => {
    const later = turns > 1
    if (
      later &&
      !window.confirm(
        `${t('Edit and resend this message?')}\n\n${t('Your later messages and the replies to them leave the chat, and this one goes back in the composer to change and send again.')}`
      )
    )
      return
    onCommand?.(turns > 1 ? `/undo ${turns}` : '/undo')
  }

  const jump = (quote: string) => {
    const target = state.items.find(i => i.kind === 'assistant' && sameQuotedText(i.text, quote))
    return target ? () => revealMessage(scroller.current, target.key) : undefined
  }

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
          {shown.map(item => (
            <Item
              key={item.key}
              item={item}
              author={author}
              onQuote={onQuote}
              jump={jump}
              onRetry={actions.retryKey.has(item.key) ? retry : undefined}
              onEdit={actions.editTurns.has(item.key) ? () => edit(actions.editTurns.get(item.key)!) : undefined}
              onFollowUp={actions.followUpKey === item.key ? onCommand : undefined}
              thinkingToggle={item.kind === 'assistant' ? thinkingToggle : undefined}
              expandTools={display.expandTools}
            />
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
