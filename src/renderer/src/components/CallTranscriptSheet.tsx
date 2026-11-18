import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { loadCallTranscript, speaker, type CallTranscript } from '../state/voiceCalls'
import { Markdown } from './Markdown'

/** What was said on a call saved with the chat, read from the host when its card is opened, after the phone's VoiceChatCallTranscriptSheet. */
export function CallTranscriptSheet({ profile, chatId, callId, onClose }: { profile?: string; chatId: string; callId: string; onClose: () => void }) {
  const [call, setCall] = useState<CallTranscript | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const done = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    setCall(null)
    setProblem(null)
    loadCallTranscript(profile, chatId, callId)
      .then(found => {
        if (!live) return
        if (found) setCall(found)
        else setProblem(t("That call's transcript is no longer available."))
      })
      .catch(e => {
        if (live) setProblem(t('Could not load {name}: {reason}', { name: t('Voice call'), reason: e instanceof Error ? e.message : String(e) }))
      })
    return () => {
      live = false
    }
  }, [profile, chatId, callId])

  useEffect(() => {
    done.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="shortcuts-backdrop" onClick={onClose}>
      <div className="shortcuts-sheet call-transcript" role="dialog" aria-modal="true" aria-label={t('Voice call')} onClick={e => e.stopPropagation()}>
        <header>
          <h2>{t('Voice call')}</h2>
          <span className="spacer" />
          <button ref={done} className="link" onClick={onClose}>
            {t('Done')}
          </button>
        </header>
        {problem ? (
          <div className="notice error">{problem}</div>
        ) : !call ? (
          <div className="notice">{t('Loading…')}</div>
        ) : (
          <ol className="call-transcript-turns">
            {call.turns.map((turn, i) => {
              const name = speaker(turn.role, call.engine)
              return (
                <li key={i} className={turn.role}>
                  {name ? <span className="meta">{name}</span> : null}
                  <div className="call-transcript-bubble">{turn.role === 'assistant' ? <Markdown text={turn.text} /> : turn.text}</div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
