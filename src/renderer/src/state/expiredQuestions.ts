/**
 * Questions Hermes stopped waiting for, after the phone's (issue 2850,
 * hermes-conduit#2873): a clarify card whose wait ran out (the clarify
 * timeout, an hour by default) or whose turn stopped keeps what it asked and
 * offered, so the person still sees it and can answer in a message instead.
 * One answered on another device (`request.cancel` with reason `resolved`)
 * just goes, as does one the person wrote past (`superseded`: they sent a
 * message instead, which the plugin hands Hermes in its place, hermes-conduit
 * issue 3105). Kept for this run of the app, and a chat's go once the person
 * sends there: the message is their answer.
 */
import { useEffect, useState } from 'react'
import type { PendingRequest } from '../../../shared/ipc'
import { blockquote } from './quote'

export interface ExpiredQuestion {
  request: PendingRequest
  /** Answers locked on this computer before the wait ended, by question id; null skipped. */
  locked: Record<string, string | null>
}

/** The most kept at once, oldest dropped first. */
export const MOST_EXPIRED = 20

const seen = new Map<string, PendingRequest>()
const locks = new Map<string, Record<string, string | null>>()
let expired: ExpiredQuestion[] = []
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(listener => listener())

/** Every question card the window has shown, so a later `request.cancel` can keep it. */
export function noteRequests(requests: readonly PendingRequest[]): void {
  for (const request of requests) if (request.method === 'clarify') seen.set(request.id, request)
}

/** An answer locked on this card, kept with it should the wait end before the last one. */
export function noteLocked(id: string, qid: string, shown: string | null): void {
  locks.set(id, { ...locks.get(id), [qid]: shown })
}

/** The card stops waiting: kept, with what was locked here. */
export function markExpired(request: PendingRequest, locked: Record<string, string | null> = {}): void {
  seen.delete(request.id)
  if (expired.some(e => e.request.id === request.id)) return
  const all = { ...locks.get(request.id), ...locked }
  locks.delete(request.id)
  expired = [...expired, { request, locked: all }].slice(-MOST_EXPIRED)
  changed()
}

/** A `request.cancel` from Hermes: kept unless another device answered it or the person wrote past it. */
export function takeCancel(payload: unknown): void {
  const { id, reason } = (payload ?? {}) as { id?: unknown; reason?: unknown }
  if (typeof id !== 'string') return
  const request = seen.get(id)
  if (!request) return
  if (reason === 'resolved' || reason === 'superseded') {
    seen.delete(id)
    locks.delete(id)
    return
  }
  markExpired(request)
}

/** The person sent a message in this chat: its kept questions are answered. */
export function clearExpired(sessionId: string | null | undefined): void {
  if (!sessionId || !expired.some(e => e.request.sessionId === sessionId)) return
  expired = expired.filter(e => e.request.sessionId !== sessionId)
  changed()
}

/** The kept questions of one live chat. */
export function expiredFor(sessionId: string | null | undefined): ExpiredQuestion[] {
  return sessionId ? expired.filter(e => e.request.sessionId === sessionId) : []
}

export function useExpiredQuestions(sessionId: string | null | undefined): ExpiredQuestion[] {
  const [list, setList] = useState(() => expiredFor(sessionId))
  useEffect(() => {
    const update = () => setList(expiredFor(sessionId))
    update()
    listeners.add(update)
    return () => void listeners.delete(update)
  }, [sessionId])
  return list
}

/** What goes in the draft for a tapped choice: the question quoted, the choice under it; just the quote with none. */
export function answering(question: string, answer: string | null): string {
  const quote = blockquote(question)
  if (!quote) return ''
  const reply = answer?.trim() ?? ''
  return reply ? `${quote}\n\n${reply}` : quote
}

/** For tests. */
export function resetExpiredQuestions(): void {
  seen.clear()
  locks.clear()
  expired = []
  changed()
}
