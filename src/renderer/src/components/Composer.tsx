import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react'
import { Icon } from './icons'
import { t } from '@shared/i18n'
import {
  ATTACHMENT_LIMIT_BYTES,
  LONG_PASTE_CHARACTERS,
  displayName,
  stagePaste,
  tooLargeMessage,
  type StagedAttachment
} from '../state/attachments'
import { stageFile } from '../state/picture'

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
  /** Told whether files are staged (or staging), so a small window can make room for them. */
  onStagedChange?: (staged: boolean) => void
}

/** Enter sends, Shift Enter adds a line; while a turn runs the send button stops it. */
export function Composer({ placeholder, running, disabled, model, cwd, onSend, onStop, focusKey, draftKey, canAttach, dropZone, onStagedChange }: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [staging, setStaging] = useState(0)
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    area.current?.focus()
  }, [focusKey])

  // A draft's files belong to the chat they were staged in.
  useEffect(() => {
    setAttachments([])
    setNotice(null)
  }, [draftKey ?? focusKey])

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

  const staged = attachments.length > 0 || staging > 0 || !!notice
  useEffect(() => {
    onStagedChange?.(staged)
  }, [staged, onStagedChange])

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

  const hasContent = text.trim().length > 0 || attachments.length > 0
  const canSend = !disabled && hasContent && staging === 0

  function send() {
    if (!canSend) return
    onSend(text, attachments)
    setText('')
    setAttachments([])
    setNotice(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape' && running) {
      event.preventDefault()
      onStop()
    }
  }

  return (
    <div className="composer-wrap">
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
                {a.kind === 'image' ? (
                  <img src={`data:${a.mime};base64,${a.base64}`} alt="" />
                ) : (
                  <Icon name="file" />
                )}
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
        {notice ? <div className="composer-notice">{notice}</div> : null}
        <label className="sr-only" htmlFor="composer-input">
          {t('Message')}
        </label>
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
          {model ? <span className="chip" title={t('Model')}>{model}</span> : null}
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
