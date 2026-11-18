import { useState } from 'react'
import type { PendingRequest } from '@shared/ipc'
import { approvalView, clarifyQuestions, lockedAnswers, type ClarifyQuestion } from '../state/needsYou'
import { Icon } from './icons'

/** An approval or a question Hermes is waiting on, answered here. */
export function RequestCard({ request, chatTitle }: { request: PendingRequest; chatTitle?: string }) {
  return request.method === 'approval' ? (
    <ApprovalCard request={request} chatTitle={chatTitle} />
  ) : (
    <ClarifyCard request={request} chatTitle={chatTitle} />
  )
}

function ApprovalCard({ request, chatTitle }: { request: PendingRequest; chatTitle?: string }) {
  const view = approvalView(request.params)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const answer = async (choice: string) => {
    setBusy(choice)
    setError(null)
    const ok = await window.conduit.answerRequest(request.id, { choice })
    if (!ok) setError('This was already answered somewhere else.')
    setBusy(null)
  }

  return (
    <section className="ask" aria-label="Approval needed">
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="code" />
        </span>
        <span className="ask-title">
          Needs your OK{chatTitle ? <span className="ask-chat"> · {chatTitle}</span> : null}
        </span>
      </header>
      <p className="ask-text">{view.description}</p>
      {view.command ? <pre className="ask-command">{view.command}</pre> : null}
      <div className="ask-actions">
        {view.choices.map(c => (
          <button key={c.choice} className={`ask-btn ${c.tone}`} disabled={busy !== null} onClick={() => void answer(c.choice)}>
            {busy === c.choice ? '…' : c.label}
          </button>
        ))}
      </div>
      {error ? <p className="ask-error">{error}</p> : null}
    </section>
  )
}

function ClarifyCard({ request, chatTitle }: { request: PendingRequest; chatTitle?: string }) {
  const questions = clarifyQuestions(request.params)
  const [locked, setLocked] = useState<Record<string, string | null>>(() => lockedAnswers(request.params))
  const [error, setError] = useState<string | null>(null)

  const lock = async (question: ClarifyQuestion, answer: string | string[] | null) => {
    setError(null)
    try {
      const result = await window.conduit.rpc<{ status?: string; remaining?: unknown }>('clarify.lock', {
        request_id: request.id,
        question_id: question.qid,
        answer
      })
      if (result?.status === 'expired') {
        setError('Hermes stopped waiting for this.')
        void window.conduit.dismissRequest(request.id)
        return
      }
      const shown = answer === null ? null : Array.isArray(answer) ? answer.join(', ') : answer
      setLocked(current => ({ ...current, [question.qid]: shown }))
      // The last answer settles the request on the gateway.
      if (Array.isArray(result?.remaining) && result.remaining.length === 0) void window.conduit.dismissRequest(request.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const skipAll = async () => {
    await window.conduit.answerRequest(request.id, {})
  }

  return (
    <section className="ask" aria-label="Question from Hermes">
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="chats" />
        </span>
        <span className="ask-title">
          {questions.length > 1 ? `${questions.length} questions` : 'A question'}
          {chatTitle ? <span className="ask-chat"> · {chatTitle}</span> : null}
        </span>
      </header>
      {questions.map(q => (
        <Question key={q.qid} question={q} locked={q.qid in locked ? locked[q.qid] : undefined} onAnswer={a => void lock(q, a)} />
      ))}
      <div className="ask-actions end">
        <button className="ask-btn plain" onClick={() => void skipAll()}>
          Skip {questions.length > 1 ? 'all' : ''}
        </button>
      </div>
      {error ? <p className="ask-error">{error}</p> : null}
    </section>
  )
}

function Question({
  question,
  locked,
  onAnswer
}: {
  question: ClarifyQuestion
  /** The answer it locked; `null` skipped, undefined still open. */
  locked: string | null | undefined
  onAnswer: (answer: string | string[] | null) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [own, setOwn] = useState('')
  const done = locked !== undefined

  return (
    <div className={`ask-q${done ? ' done' : ''}`}>
      <p className="ask-text">{question.question}</p>
      {done ? (
        <p className="ask-locked">
          <Icon name="check" /> {locked === null ? 'Skipped' : locked}
        </p>
      ) : (
        <>
          {question.choices.length ? (
            <div className="ask-choices">
              {question.choices.map(choice =>
                question.multiSelect ? (
                  <label key={choice} className={`ask-choice${picked.includes(choice) ? ' on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={picked.includes(choice)}
                      onChange={e => setPicked(p => (e.target.checked ? [...p, choice] : p.filter(c => c !== choice)))}
                    />
                    {choice}
                  </label>
                ) : (
                  <button key={choice} className="ask-choice" onClick={() => onAnswer(choice)}>
                    {choice}
                  </button>
                )
              )}
            </div>
          ) : null}
          <form
            className="ask-own"
            onSubmit={e => {
              e.preventDefault()
              if (question.multiSelect && picked.length && !own.trim()) onAnswer(picked)
              else if (own.trim()) onAnswer(question.multiSelect ? [...picked, own.trim()] : own.trim())
            }}
          >
            <input
              value={own}
              onChange={e => setOwn(e.target.value)}
              placeholder={question.choices.length ? 'Or type your own answer' : 'Type your answer'}
              aria-label="Your answer"
            />
            <button type="submit" className="ask-btn primary" disabled={!own.trim() && !(question.multiSelect && picked.length)}>
              Answer
            </button>
            <button type="button" className="ask-btn plain" onClick={() => onAnswer(null)}>
              Skip
            </button>
          </form>
        </>
      )}
    </div>
  )
}
