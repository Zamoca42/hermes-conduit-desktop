import { useCallback, useEffect, useRef, useState } from 'react'
import { language } from '@shared/i18n'
import { gateway } from '../gateway'
import { STATUS_PATH, pluginStatus, serves } from './plugin'
import {
  DRAFT_WAIT_S,
  askable,
  draftBody,
  draftGuesses,
  pauseEnabled,
  type DraftGuesses,
  PREDICTIVE_EVENT,
  PREDICT_CAPABILITY,
  PREDICT_PATH,
  REPLIES_WAIT_S,
  guesses,
  predictModel,
  repliesBody,
  repliesEnabled,
  replyCount,
  settledReply
} from './predictive'
import { languageName } from './stepSummaries'
import type { TranscriptState } from './transcript'

// Whether this host's plugin answers predictions, asked again every ten minutes.
let served: { at: number; answer: Promise<boolean> } | null = null
export function predictionsServed(): Promise<boolean> {
  if (!served || Date.now() - served.at > 600_000) {
    served = {
      at: Date.now(),
      answer: gateway
        .http('GET', STATUS_PATH)
        .then(body => serves(pluginStatus(body), [PREDICT_CAPABILITY]))
        .catch(() => false)
    }
  }
  return served.answer
}

/**
 * The open chat's suggested replies: asked once per settled reply, when it
 * settles or the chat opens on it, while Settings > Chat > Predictive has
 * them on. Empty while a turn runs, and gone once the chat moves on.
 */
export interface Predictions {
  /** Suggested replies to the settled reply, best first. */
  replies: string[]
  /** Asks about a paused draft, when While I pause is on and Hermes can be asked. */
  askDraft?: (draft: string) => Promise<DraftGuesses | null>
}

export function usePredictions(state: TranscriptState, sessionId: string | undefined): Predictions {
  const [enabled, setEnabled] = useState(repliesEnabled)
  const [pausing, setPausing] = useState(pauseEnabled)
  const [answer, setAnswer] = useState<{ key: string; replies: string[] } | null>(null)
  const asked = useRef(new Set<string>())
  const reply = sessionId ? settledReply(state.items, state.running) : null
  const key = reply && sessionId ? `${sessionId}|${reply}` : null

  useEffect(() => {
    const changed = () => {
      setEnabled(repliesEnabled())
      setPausing(pauseEnabled())
    }
    window.addEventListener(PREDICTIVE_EVENT, changed)
    return () => window.removeEventListener(PREDICTIVE_EVENT, changed)
  }, [])

  useEffect(() => {
    if (!enabled || !key || !sessionId || asked.current.has(key)) return
    asked.current.add(key)
    let live = true
    let done = false
    void (async () => {
      if (!(await predictionsServed())) return void (done = true)
      try {
        const body = repliesBody(sessionId, replyCount(), languageName(language()), predictModel())
        const response = await gateway.http('POST', PREDICT_PATH, body, (REPLIES_WAIT_S + 5) * 1000)
        if (live) setAnswer({ key, replies: guesses(response) })
      } catch {
        // No chips for this reply: Conduit doesn't ask again for it.
      }
      done = true
    })()
    return () => {
      live = false
      // Left before the answer came: coming back asks again.
      if (!done) asked.current.delete(key)
    }
  }, [enabled, key, sessionId])

  const askDraft = useCallback(
    async (draft: string): Promise<DraftGuesses | null> => {
      if (!sessionId || !askable(draft) || !(await predictionsServed())) return null
      try {
        const body = draftBody(sessionId, draft, replyCount(), languageName(language()), predictModel())
        return draftGuesses(await gateway.http('POST', PREDICT_PATH, body, (DRAFT_WAIT_S + 3) * 1000))
      } catch {
        return null
      }
    },
    [sessionId]
  )

  return { replies: enabled && key && answer?.key === key ? answer.replies : [], askDraft: pausing && sessionId ? askDraft : undefined }
}
