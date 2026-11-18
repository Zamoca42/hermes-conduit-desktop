import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { language } from '@shared/i18n'
import { gateway } from '../gateway'
import { STATUS_PATH, pluginStatus, serves } from './plugin'
import type { StepItem } from './runs'
import {
  ANSWER_WAIT_MS,
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_PATH,
  SIDE_QUESTION_WAIT_S,
  cleaned,
  explainQuestion,
  explainWords,
  isAsked,
  isQuestion,
  languageName,
  lastRun,
  question,
  runKey,
  saveSummary,
  savedSummary,
  sideQuestionAnswer,
  summariesEnabled,
  summaryScope,
  summaryMaxSteps,
  words
} from './stepSummaries'
import type { ToolItem, TranscriptState } from './transcript'

// Whether this host's plugin answers side questions, asked again every ten minutes.
let served: { at: number; answer: Promise<boolean> } | null = null
function sideQuestionsServed(): Promise<boolean> {
  if (!served || Date.now() - served.at > 600_000) {
    served = {
      at: Date.now(),
      answer: gateway
        .http('GET', STATUS_PATH)
        .then(body => serves(pluginStatus(body), [SIDE_QUESTION_CAPABILITY]))
        .catch(() => false)
    }
  }
  return served.answer
}

/** The open host's address, which scopes its summaries. */
export const SummaryHost = createContext('')

export interface StepSummaries {
  /** The summary shown under a run, by its key. */
  summary(steps: StepItem[]): string | null
  /** Whether Hermes is looking back on this run now. */
  lookingBack(steps: StepItem[]): boolean
  /** Explain these steps, or Explain again; undefined where Hermes can't be asked. */
  explain(steps: StepItem[]): (() => void) | undefined
}

/** A chat's step summaries: the saved ones, an automatic one for each finished turn when switched on, and Explain. */
export function useStepSummaries(state: TranscriptState, sessionId: string | undefined, profile: string | undefined): StepSummaries {
  const scope = summaryScope(useContext(SummaryHost), profile)
  const [, setVersion] = useState(0)
  const asking = useRef(new Set<string>())
  const asked = useRef(new Set<string>())
  // Whether the plugin answers side questions; without it, a hidden /btw asks.
  const [routed, setRouted] = useState<boolean | null>(null)
  const available = !!sessionId && routed !== null
  // Questions asked as a /btw, by their exact words, until answered or waited out.
  const waiting = useRef(new Map<string, { key: string; at: number }>())

  useEffect(() => {
    let live = true
    if (sessionId) void sideQuestionsServed().then(ok => live && setRouted(ok))
    return () => {
      live = false
    }
  }, [sessionId])

  const settle = useCallback(
    (key: string, answer: string | null) => {
      const paragraph = answer ? cleaned(answer) : null
      if (paragraph) saveSummary(scope, key, paragraph)
      asking.current.delete(key)
      setVersion(v => v + 1)
    },
    [scope]
  )

  // A /btw's answer comes on the chat's stream, matched by its question.
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        if (event.type !== 'btw.complete' || !sessionId || event.session_id !== sessionId) return
        const payload = (event.payload ?? {}) as { text?: unknown; question?: unknown }
        const question = typeof payload.question === 'string' ? payload.question : ''
        const asked = isQuestion(question) ? waiting.current.get(question) : undefined
        if (!asked) return
        waiting.current.delete(question)
        if (Date.now() - asked.at < ANSWER_WAIT_MS && asking.current.has(asked.key)) settle(asked.key, typeof payload.text === 'string' ? payload.text : null)
      }),
    [sessionId, settle]
  )

  const ask = useCallback(
    async (key: string, text: string) => {
      if (!sessionId || asking.current.has(key)) return
      asking.current.add(key)
      setVersion(v => v + 1)
      if (!routed) {
        try {
          // A gateway without prompt.btw leaves the run's count.
          await gateway.rpc('prompt.btw', profile ? { session_id: sessionId, text, profile } : { session_id: sessionId, text })
          const at = Date.now()
          waiting.current.set(text, { key, at })
          // Unanswered by then, the run stops looking back and Explain asks again.
          setTimeout(() => {
            if (waiting.current.get(text)?.at !== at) return
            waiting.current.delete(text)
            if (asking.current.has(key)) settle(key, null)
          }, ANSWER_WAIT_MS)
        } catch {
          settle(key, null)
        }
        return
      }
      let answer: string | null = null
      try {
        answer = sideQuestionAnswer(
          await gateway.http(
            'POST',
            SIDE_QUESTION_PATH,
            { session_id: sessionId, question: text, wait_s: SIDE_QUESTION_WAIT_S },
            (SIDE_QUESTION_WAIT_S + 15) * 1000
          )
        )
      } catch {
        // The run keeps its count; its Explain asks again.
      }
      settle(key, answer)
    },
    [sessionId, routed, profile, settle]
  )

  // A turn that just finished here: its last run, once, when summaries are on. Opening an older chat asks nothing.
  const wasRunning = useRef(false)
  useEffect(() => {
    const finished = wasRunning.current && !state.running
    wasRunning.current = state.running
    if (!finished || !available || !summariesEnabled()) return
    const run = lastRun(state.items)
    const key = run ? runKey(run) : null
    if (!run || !key || !isAsked(run, summaryMaxSteps()) || asked.current.has(key) || savedSummary(scope, key)) return
    asked.current.add(key)
    const tools = run.filter(s => s.kind === 'tool').length
    void ask(key, question(languageName(language()), words(tools)))
  }, [available, state.running, state.items, scope, ask])

  return {
    summary: steps => {
      const key = runKey(steps)
      return key ? savedSummary(scope, key) : null
    },
    lookingBack: steps => {
      const key = runKey(steps)
      return !!key && asking.current.has(key)
    },
    explain: steps => {
      const key = runKey(steps)
      const tools = steps.filter((s): s is ToolItem => s.kind === 'tool')
      if (!available || !key || !tools.length || tools.some(s => s.status === 'running')) return undefined
      return () => void ask(key, explainQuestion(languageName(language()), explainWords(tools.length), tools))
    }
  }
}
