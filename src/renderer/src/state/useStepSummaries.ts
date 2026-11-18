import { useCallback, useEffect, useRef, useState } from 'react'
import { language } from '@shared/i18n'
import { gateway } from '../gateway'
import { STATUS_PATH, pluginStatus, serves } from './plugin'
import type { StepItem } from './runs'
import {
  SIDE_QUESTION_CAPABILITY,
  SIDE_QUESTION_PATH,
  SIDE_QUESTION_WAIT_S,
  cleaned,
  explainQuestion,
  explainWords,
  isAsked,
  languageName,
  lastRun,
  question,
  runKey,
  saveSummary,
  savedSummary,
  sideQuestionAnswer,
  summariesEnabled,
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
  const scope = profile || 'default'
  const [, setVersion] = useState(0)
  const asking = useRef(new Set<string>())
  const asked = useRef(new Set<string>())
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let live = true
    if (sessionId) void sideQuestionsServed().then(ok => live && setAvailable(ok))
    return () => {
      live = false
    }
  }, [sessionId])

  const ask = useCallback(
    async (key: string, text: string) => {
      if (!sessionId || asking.current.has(key)) return
      asking.current.add(key)
      setVersion(v => v + 1)
      try {
        const answer = sideQuestionAnswer(
          await gateway.http(
            'POST',
            SIDE_QUESTION_PATH,
            { session_id: sessionId, question: text, wait_s: SIDE_QUESTION_WAIT_S },
            (SIDE_QUESTION_WAIT_S + 15) * 1000
          )
        )
        const paragraph = answer ? cleaned(answer) : null
        if (paragraph) saveSummary(scope, key, paragraph)
      } catch {
        // The run keeps its count; its Explain asks again.
      } finally {
        asking.current.delete(key)
        setVersion(v => v + 1)
      }
    },
    [sessionId, scope]
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
