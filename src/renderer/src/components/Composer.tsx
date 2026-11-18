import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './icons'

/** The last folder of a path, the way the phone's chip shows it. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

interface Props {
  placeholder: string
  running: boolean
  disabled: boolean
  model?: string
  cwd?: string
  onSend: (text: string) => void
  onStop: () => void
  focusKey: string
}

/** Enter sends, Shift Enter adds a line; while a turn runs the send button stops it. */
export function Composer({ placeholder, running, disabled, model, cwd, onSend, onStop, focusKey }: Props) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    area.current?.focus()
  }, [focusKey])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  function send() {
    if (disabled || !text.trim()) return
    onSend(text)
    setText('')
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

  const canSend = !disabled && text.trim().length > 0
  return (
    <div className="composer-wrap">
      <div className="composer">
        <label className="sr-only" htmlFor="composer-input">
          Message
        </label>
        <textarea
          id="composer-input"
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-row">
          {model ? <span className="chip" title="Model">{model}</span> : null}
          {cwd ? (
            <span className="chip" title={`Working folder: ${cwd}`}>
              {folderName(cwd)}
            </span>
          ) : null}
          <span className="hint">{running ? 'Esc stops' : 'Enter sends · Shift Enter new line'}</span>
          {running && !canSend ? (
            <button className="send stop" aria-label="Stop" title="Stop (Esc)" onClick={onStop}>
              <Icon name="stop" />
            </button>
          ) : (
            <button className="send" aria-label="Send" disabled={!canSend} onClick={send}>
              <Icon name="send" style={{ strokeWidth: 2.2 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
