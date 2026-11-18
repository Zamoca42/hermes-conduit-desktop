import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { agentFromEvent, isActive, merged, parseRoster, withRoster, type DelegateAgent } from './agents'

/**
 * The delegate agents of the open chat: built from its `subagent.*` events,
 * and from `subagent.list` as it opens, reconnects, ends a turn, and every
 * 15 s while one is still running, so a missed end frame can't leave a card
 * running. Another chat starts with none.
 */
export function useAgents(liveId: string | null, connected: boolean, running: boolean) {
  const [agents, setAgents] = useState<DelegateAgent[]>([])
  const current = useRef(liveId)
  current.current = liveId

  const readRoster = useCallback(async () => {
    const sid = current.current
    if (!sid) return
    try {
      const roster = parseRoster(await gateway.rpc('subagent.list', { session_id: sid }))
      if (roster && current.current === sid) setAgents(cards => withRoster(cards, roster))
    } catch {
      // A Hermes without the roster leaves the cards as they are.
    }
  }, [])

  useEffect(() => {
    setAgents([])
    if (liveId && connected) void readRoster()
  }, [liveId, connected, readRoster])

  useEffect(
    () =>
      window.conduit.onEvent(event => {
        if (!event.type.startsWith('subagent.') || !event.session_id || event.session_id !== current.current) return
        const card = agentFromEvent(event.type, event.payload, event.session_id)
        if (!card) return
        setAgents(cards => {
          const i = cards.findIndex(c => c.id === card.id)
          if (i < 0) return [...cards, card]
          const next = [...cards]
          next[i] = merged(cards[i], card)
          return next
        })
      }),
    []
  )

  // A turn that ended: the agents it started are Hermes' to report now.
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) void readRoster()
    wasRunning.current = running
  }, [running, readRoster])

  const anyActive = agents.some(isActive)
  useEffect(() => {
    if (!anyActive || !connected) return
    const timer = setInterval(() => void readRoster(), 15_000)
    return () => clearInterval(timer)
  }, [anyActive, connected, readRoster])

  /** Queues words into a running agent, handed over at its next tool step. False when Hermes turned it down. */
  const steer = useCallback(async (id: string, text: string): Promise<boolean> => {
    const sid = current.current
    if (!sid) return false
    const answer = (await gateway.rpc('subagent.steer', { session_id: sid, subagent_id: id, text })) as { status?: unknown }
    return answer?.status === 'queued'
  }, [])

  const stop = useCallback(
    async (id: string) => {
      const sid = current.current
      if (!sid) return
      await gateway.rpc('subagent.interrupt', { session_id: sid, subagent_id: id })
      await readRoster()
    },
    [readRoster]
  )

  const tail = useCallback(async (id: string): Promise<{ text: string; truncated: boolean } | null> => {
    const sid = current.current
    if (!sid) return null
    const answer = (await gateway.rpc('subagent.tail', { session_id: sid, subagent_id: id })) as { available?: unknown; text?: unknown; truncated?: unknown }
    if (answer?.available !== true || typeof answer.text !== 'string') return null
    return { text: answer.text, truncated: answer.truncated === true }
  }, [])

  return { agents, steer, stop, tail, refresh: readRoster }
}
