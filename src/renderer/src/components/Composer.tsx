import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import type { ContextWindow } from '../state/context'
import { Icon } from './icons'
import { t } from '@shared/i18n'
import { ATTACHMENT_LIMIT_BYTES, LONG_PASTE_CHARACTERS, displayName, stagePaste, tooLargeMessage, type StagedAttachment } from '../state/attachments'
import { stageFile } from '../state/picture'
import { useRecorder } from '../state/useRecorder'
import { blobToBase64, durationLabel, transcribe, voiceFileName, voicePromptText } from '../state/voice'
import { suggestCommands, type SlashCommand } from '../state/slash'
import { TAP_GUARD_MS } from '../state/predictive'
import { carriesReply, excerpt, insertQuote, replyEnvelope, type QuoteRequest, type ReplyReference } from '../state/quote'

/** The last folder of a path, the way the phone's chip shows it. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Whether a drag carries files (not words or a link). */
function carriesFiles(event: DragEvent | globalThis.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

interface Props {
  placeholder: string
  running: boolean
  disabled: boolean
  model?: string
  cwd?: string
  onSend: (text: string, attachments: StagedAttachment[]) => void
  onStop: () => void
  focusKey: string
  /** Which draft this is: its staged files go when it changes. Defaults to `focusKey`. */
  draftKey?: string
  /** Pictures and files can go with the message: the Attach button, a pasted picture, a long paste, a drop. */
  canAttach?: boolean
  /** Where else a dropped file attaches (the chat around the composer). */
  dropZone?: RefObject<HTMLElement | null>
  /** Told whether anything shows above the field (files, a reply, suggestions), so a small window can make room. */
  onStagedChange?: (staged: boolean) => void
  /** Why the staged files can't go with this message, checked on Send, or null. */
  checkAttachments?: (attachments: StagedAttachment[]) => string | null
  /** A quote from the transcript: words go in the draft, a whole message becomes the "Replying to" chip. */
  quote?: QuoteRequest | null
  /** Suggested replies, best first: shown while the draft is empty and nothing is staged. */
  replies?: string[]
  /** A suggested reply clicked: sent as the next message. */
  onSuggestion?: (text: string) => void
  /** The model chip's click: the Model panel. Without it the chip only shows the model. */
  onModel?: () => void
  /** How full the chat's context window is; the ring opens the Context panel. */
  context?: ContextWindow
  onContext?: () => void
  /** The slash commands this chat takes, suggested as a `/` is typed. None in a room. */
  commands?: SlashCommand[]
  /** The text sent for a draft replying to a message. Defaults to a chat's reply envelope. */
  wrapReply?: (reply: ReplyReference, draft: string) => string
  /** The microphone: a recording typed out (Dictate) or sent as a voice message, transcribed in this profile. */
  voice?: { profile?: string }
}

const chatReply = (reply: ReplyReference, draft: string) => replyEnvelope(reply.text, draft)

/** Enter sends, Shift Enter adds a line; while a turn runs the send button stops it. */
export function Composer({
  placeholder,
  running,
  disabled,
  model,
  cwd,
  onSend,
  onStop,
  focusKey,
  draftKey,
  canAttach,
  dropZone,
  onStagedChange,
  checkAttachments,
  quote,
  replies: guessed,
  onSuggestion,
  wrapReply = chatReply,
  commands,
  onModel,
  context,
  onContext,
  voice
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [staging, setStaging] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyReference | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const recorder = useRecorder()
  const [transcribing, setTranscribing] = useState(false)

  useEffect(() => {
    area.current?.focus()
  }, [focusKey])

  // A draft's files belong to the chat they were staged in, and so does a recording.
  useEffect(() => {
    recorder.cancel()
    setAttachments([])
    setNotice(null)
    setReplyTo(null)
  }, [draftKey ?? focusKey])

  // A quote lands once per request.
  const quoted = useRef<number | null>(null)
  useEffect(() => {
    if (!quote || quote.id === quoted.current) return
    quoted.current = quote.id
    if ('draft' in quote) {
      setText(quote.draft)
      setReplyTo(quote.reply ?? null)
    } else if ('reply' in quote) setReplyTo(quote.reply)
    else if ('insert' in quote) {
      const el = area.current
      const at = el ? el.selectionStart : text.length
      const end = el ? el.selectionEnd : text.length
      setText(current => {
        const before = current.slice(0, at)
        const pad = before && !/\s$/.test(before) ? ' ' : ''
        const words = `${pad}${quote.insert} `
        requestAnimationFrame(() => el?.setSelectionRange(at + words.length, at + words.length))
        return `${before}${words}${current.slice(end)}`
      })
      el?.focus()
      return
    } else setText(current => insertQuote(quote.text, current))
    const el = area.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length))
  }, [quote])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  async function stage(files: File[]) {
    if (!files.length) return
    const tooLarge = files.filter(f => f.size > ATTACHMENT_LIMIT_BYTES)
    const fitting = files.filter(f => f.size <= ATTACHMENT_LIMIT_BYTES)
    const unread: string[] = []
    setNotice(tooLarge.length ? tooLargeMessage(tooLarge.map(f => f.name)) : null)
    setStaging(n => n + 1)
    try {
      const staged = await Promise.all(
        fitting.map(file =>
          stageFile(file, crypto.randomUUID()).catch(() => {
            unread.push(file.name)
            return null
          })
        )
      )
      setAttachments(current => [...current, ...staged.filter((s): s is StagedAttachment => !!s)])
      if (unread.length) setNotice(t("Couldn't read {names}.", { names: unread.join(', ') }))
    } finally {
      setStaging(n => n - 1)
      area.current?.focus()
    }
  }

  // Files dropped on the chat around the composer attach too.
  const stageRef = useRef(stage)
  stageRef.current = stage
  useEffect(() => {
    const zone = dropZone?.current
    if (!zone || !canAttach) return
    let depth = 0
    const over = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    }
    const enter = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event) || disabled) return
      depth++
      setDragging(true)
    }
    const leave = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      if (!disabled) void stageRef.current(Array.from(event.dataTransfer?.files ?? []))
    }
    zone.addEventListener('dragover', over)
    zone.addEventListener('dragenter', enter)
    zone.addEventListener('dragleave', leave)
    zone.addEventListener('drop', drop)
    return () => {
      zone.removeEventListener('dragover', over)
      zone.removeEventListener('dragenter', enter)
      zone.removeEventListener('dragleave', leave)
      zone.removeEventListener('drop', drop)
      setDragging(false)
    }
  }, [dropZone, canAttach, disabled])

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!canAttach || disabled) return
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      void stage(files)
      return
    }
    const pasted = event.clipboardData.getData('text/plain')
    if (pasted.length > LONG_PASTE_CHARACTERS) {
      event.preventDefault()
      const paste = stagePaste(pasted, crypto.randomUUID())
      if (paste.size > ATTACHMENT_LIMIT_BYTES) {
        // Too big to go as a file: it goes in the field after all.
        const el = event.currentTarget
        const start = el.selectionStart
        setText(current => current.slice(0, start) + pasted + current.slice(el.selectionEnd))
        return
      }
      setAttachments(current => [...current, paste])
    }
  }

  function remove(id: string) {
    setAttachments(current => current.filter(a => a.id !== id))
    setNotice(null)
    area.current?.focus()
  }

  /** A paste goes back in the field, after what was typed. */
  function unpaste(item: StagedAttachment) {
    if (item.pastedText === undefined) return
    setAttachments(current => current.filter(a => a.id !== item.id))
    setText(current => (current ? `${current}\n${item.pastedText}` : item.pastedText!))
    area.current?.focus()
  }

  // `/` and the start of a name: Hermes' commands that fit, until a space or Esc.
  const suggestions = commands?.length && /^\/[^\s/]*$/.test(text) && text !== dismissed ? suggestCommands(commands, text) : []
  const picked = suggestions[Math.min(highlight, suggestions.length - 1)]
  useEffect(() => setHighlight(0), [text])

  // Staged files, a note, a reply chip or the suggestions: a small window makes room for them.
  const staged = attachments.length > 0 || staging > 0 || !!notice || !!replyTo || !!picked
  useEffect(() => {
    onStagedChange?.(staged)
  }, [staged, onStagedChange])

  /** A pick only puts the command in the field, with a space for its words. */
  function pick(command: SlashCommand) {
    setText(`/${command.name} `)
    area.current?.focus()
  }

  const hasContent = text.trim().length > 0 || attachments.length > 0
  const canSend = !disabled && hasContent && staging === 0

  function send() {
    if (!canSend) return
    const problem = attachments.length ? (checkAttachments?.(attachments) ?? null) : null
    if (problem) {
      setNotice(problem)
      return
    }
    const replying = replyTo && carriesReply(text, attachments.length > 0)
    onSend(replying ? wrapReply(replyTo, text.trim()) : text, attachments)
    setText('')
    setAttachments([])
    setNotice(null)
    // A slash command leaves the reply attached for the next message.
    if (replying) setReplyTo(null)
  }

  useEffect(() => {
    if (recorder.error === 'denied') setNotice(t("Conduit can't use the microphone. Allow it for Conduit in your computer's privacy settings, then try again."))
    else if (recorder.error === 'missing') setNotice(t('No microphone found.'))
    else if (recorder.error) setNotice(recorder.error)
  }, [recorder.error])

  /** The recording's words, typed in where the caret is. */
  async function dictate() {
    const recording = await recorder.stop()
    if (!recording) return
    setTranscribing(true)
    try {
      const words = await transcribe(await blobToBase64(recording.blob), recording.mime, voice?.profile)
      if (!words) {
        setNotice(t("Hermes didn't hear any words."))
        return
      }
      const el = area.current
      setText(current => {
        const at = el && document.activeElement === el ? el.selectionStart : current.length
        const before = current.slice(0, at)
        const pad = before && !/\s$/.test(before) ? ' ' : ''
        const next = `${before}${pad}${words}${current.slice(at)}`
        const caret = at + pad.length + words.length
        requestAnimationFrame(() => {
          el?.focus()
          el?.setSelectionRange(caret, caret)
        })
        return next
      })
      setNotice(null)
    } catch (e) {
      setNotice(t("Hermes couldn't transcribe that: {error}", { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setTranscribing(false)
    }
  }

  /** The recording as a voice message: the audio as a file, and what Hermes heard as the prompt. */
  async function sendVoice() {
    if (running) {
      setNotice(t('Voice messages send once the reply has finished.'))
      return
    }
    const recording = await recorder.stop()
    if (!recording) return
    setTranscribing(true)
    try {
      const base64 = await blobToBase64(recording.blob)
      const extension = recording.mime.includes('ogg') ? 'ogg' : recording.mime.includes('mp4') ? 'm4a' : 'webm'
      const file: StagedAttachment = {
        id: `voice-${Date.now()}`,
        name: voiceFileName(extension),
        kind: 'file',
        mime: recording.mime,
        size: recording.blob.size,
        base64
      }
      if (file.size > ATTACHMENT_LIMIT_BYTES) {
        setNotice(t('This voice message is larger than your attachment size limit.'))
        return
      }
      // Words help every model; without them the file still goes, as the phone sends it.
      const words = await transcribe(base64, recording.mime, voice?.profile).catch(() => '')
      onSend(voicePromptText(recording.duration, words), [file])
      setNotice(null)
    } finally {
      setTranscribing(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (picked && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setHighlight(h => (Math.min(h, suggestions.length - 1) + step + suggestions.length) % suggestions.length)
        return
      }
      // Tab takes the highlighted command; Enter does too, unless it's already what's typed.
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && text.slice(1).toLowerCase() !== picked.name)) {
        event.preventDefault()
        pick(picked)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(text)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape' && running) {
      event.preventDefault()
      onStop()
    }
  }

  const chips = guessed?.length && onSuggestion && !text.trim() && !staged && !running && !disabled ? guessed : null
  return (
    <div className="composer-wrap">
      {chips ? (
        <SuggestedReplies
          replies={chips}
          onSend={onSuggestion!}
          onEdit={reply => {
            setText(reply)
            requestAnimationFrame(() => {
              const field = area.current
              if (field) {
                field.focus()
                field.setSelectionRange(reply.length, reply.length)
              }
            })
          }}
        />
      ) : null}
      <div className={`composer${dragging ? ' dropping' : ''}`}>
        {dragging ? (
          <div className="drop-hint">
            <Icon name="paperclip" />
            {t('Drop to attach')}
          </div>
        ) : null}
        {attachments.length || staging ? (
          <div className="staged">
            {attachments.map(a => (
              <span key={a.id} className="staged-chip" title={a.pastedText !== undefined ? t('Click to put the text back in the message') : a.name}>
                {a.kind === 'image' ? <img src={`data:${a.mime};base64,${a.base64}`} alt="" /> : <Icon name="file" />}
                {a.pastedText !== undefined ? (
                  <button className="staged-name link" onClick={() => unpaste(a)}>
                    {displayName(a.name)}
                  </button>
                ) : (
                  <span className="staged-name">{displayName(a.name)}</span>
                )}
                <button className="staged-remove" aria-label={t('Remove {name}', { name: displayName(a.name) })} onClick={() => remove(a.id)}>
                  <Icon name="close" />
                </button>
              </span>
            ))}
            {staging ? <span className="staged-chip busy">{t('Attaching…')}</span> : null}
          </div>
        ) : null}
        {picked ? (
          <div className="slash-suggestions" role="listbox" aria-label={t('Slash commands')}>
            {suggestions.map((command, i) => (
              <button
                key={command.name}
                role="option"
                aria-selected={command === picked}
                className={command === picked ? 'active' : undefined}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(command)}
              >
                <span className="slash-name">/{command.name}</span>
                <span className="slash-description">{command.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {replyTo ? (
          <div className="reply-chip" title={replyTo.text}>
            <span className="reply-chip-body">
              <span className="reply-chip-name">{t('Replying to {name}', { name: replyTo.author })}</span>
              <span className="reply-chip-text">{excerpt(replyTo.text)}</span>
            </span>
            <button className="staged-remove" aria-label={t('Remove the reply')} onClick={() => setReplyTo(null)}>
              <Icon name="close" />
            </button>
          </div>
        ) : null}
        {notice ? <div className="composer-notice">{notice}</div> : null}
        <label className="sr-only" htmlFor="composer-input">
          {t('Message')}
        </label>
        {recorder.recording || transcribing ? (
          <div className="voice-strip" role="status">
            {transcribing ? (
              <span className="voice-busy">
                <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                {t('Transcribing')}
              </span>
            ) : (
              <>
                <span className="voice-dot" />
                <span className="voice-time">{durationLabel(recorder.elapsed)}</span>
                <span className="voice-meter" aria-label={t('Microphone input level')}>
                  <span style={{ transform: `scaleX(${Math.min(1, recorder.level * 2.5)})` }} />
                </span>
                <button className="secondary" onClick={recorder.cancel}>
                  {t('Cancel')}
                </button>
                <button className="secondary" onClick={() => void dictate()} title={t('Type out what you said')}>
                  {t('Dictate')}
                </button>
                {canAttach ? (
                  <button className="primary" onClick={() => void sendVoice()}>
                    {t('Send voice message')}
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
        <textarea
          id="composer-input"
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="composer-row">
          {canAttach ? (
            <>
              <button className="attach" aria-label={t('Attach')} title={t('Attach')} disabled={disabled} onClick={() => picker.current?.click()}>
                <Icon name="paperclip" />
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={e => {
                  void stage(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
            </>
          ) : null}
          {voice ? (
            <button
              className="attach"
              aria-label={t('Record')}
              title={t('Record: dictate, or send a voice message')}
              disabled={disabled || recorder.recording || transcribing}
              onClick={() => {
                setNotice(null)
                recorder.clearError()
                void recorder.start()
              }}
            >
              <Icon name="mic" />
            </button>
          ) : null}
          {model && onModel ? (
            <button className="chip chip-button" title={t('Model')} aria-haspopup="dialog" disabled={disabled} onClick={onModel}>
              {model}
            </button>
          ) : model ? (
            <span className="chip" title={t('Model')}>
              {model}
            </span>
          ) : null}
          {context && onContext ? (
            <button
              className="chip chip-button context-chip"
              title={t('Context: {percent}% full', { percent: Math.round(context.percent) })}
              aria-label={t('Context: {percent}% full', { percent: Math.round(context.percent) })}
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={onContext}
            >
              <ContextRing percent={context.percent} />
              {Math.round(context.percent)}%
            </button>
          ) : null}
          {cwd ? (
            <span className="chip" title={t('Working folder: {folder}', { folder: cwd })}>
              {folderName(cwd)}
            </span>
          ) : null}
          <span className="hint">{running ? t('Esc stops') : t('Enter sends · Shift Enter new line')}</span>
          {running && !hasContent ? (
            <button className="send stop" aria-label={t('Stop')} title={t('Stop (Esc)')} onClick={onStop}>
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" aria-label={t('Send')} disabled={!canSend} onClick={send}>
              <Icon name="send" style={{ strokeWidth: 2.2 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** The window's fullness as a small ring, amber, then orange past 80%. */
export function ContextRing({ percent, size = 14 }: { percent: number; size?: number }) {
  const radius = (size - 3) / 2
  const length = 2 * Math.PI * radius
  const shown = Math.min(100, Math.max(0, percent))
  return (
    <svg className={`context-ring${shown >= 80 ? ' full' : ''}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} className="track" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="fill"
        strokeDasharray={`${(shown / 100) * length} ${length}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/** One row of suggested replies, after the phone's PredictiveRow: click sends, right-click (or Alt-click) puts it in the draft to edit first. */
function SuggestedReplies({ replies, onSend, onEdit }: { replies: string[]; onSend: (text: string) => void; onEdit: (text: string) => void }) {
  const shownAt = useRef(performance.now())
  const joined = replies.join('\n')
  useEffect(() => {
    shownAt.current = performance.now()
  }, [joined])
  return (
    <div className="suggested-replies" role="group" aria-label={t('Suggested replies')}>
      {replies.map(reply => (
        <button
          key={reply}
          className="suggested-reply"
          title={t('Click to send. Right-click to edit it first.')}
          onClick={e => {
            if (performance.now() - shownAt.current < TAP_GUARD_MS) return
            if (e.altKey) onEdit(reply)
            else onSend(reply)
          }}
          onContextMenu={e => {
            e.preventDefault()
            onEdit(reply)
          }}
        >
          {reply}
        </button>
      ))}
    </div>
  )
}
