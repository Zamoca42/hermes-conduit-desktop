import { useEffect, useRef, useState } from 'react'
import { GatewayError, gateway } from '../gateway'
import { answerKeeper, keptAnswer } from './keptAnswers'

/** A status check's line: what Hermes answered, still checking, or the plugin missing (a 404). */
export type CheckedStatus<T> = T | 'checking' | 'missing' | null

type Line = { ok: boolean; reason?: string | null }

/**
 * Where a status check's line is kept: its route, and the variant it was read
 * for (GPT-Live's billing), apart from any answer kept on the route itself.
 */
export function keptStatusKey(path: string, variant?: string): string {
  return `${path}#line${variant ? `:${variant}` : ''}`
}

/** A kept line read back: only one shaped like a check's answer. */
export function keptLine<T extends Line>(value: unknown): T | null {
  return value && typeof value === 'object' && typeof (value as Line).ok === 'boolean' ? (value as T) : null
}

interface Options<T> {
  timeout: number
  /** What the line was read for, when the same route answers for several (GPT-Live's billing). */
  variant?: string
  /** The line as kept, for one holding a name the store would leave out (Grok's `auth`). */
  pack?: (line: T) => unknown
  unpack?: (kept: unknown) => T | null
}

/**
 * A voice mode's status line on Voice settings, after the phone's: it opens on
 * what its last check on this dashboard said, kept as the line it showed, and
 * checks again (Screens that open on their last answer). A failed check says
 * why; a 404 is the plugin missing.
 */
export function useKeptStatus<T extends Line>(on: boolean, path: string, parse: (body: unknown) => T, options: Options<T>): CheckedStatus<T> {
  const { timeout, variant, pack, unpack } = options
  const [status, setStatus] = useState<CheckedStatus<T>>(null)
  // The latest functions, so an inline one doesn't check again on every draw.
  const fns = useRef({ parse, pack, unpack })
  fns.current = { parse, pack, unpack }

  useEffect(() => {
    if (!on) return setStatus(null)
    let live = true
    const key = keptStatusKey(path, variant)
    const { unpack: read = keptLine<T> } = fns.current
    const kept = keptAnswer(key)
    setStatus((kept === undefined ? null : read(kept)) ?? 'checking')
    const keep = answerKeeper(key)
    gateway
      .http('GET', path, undefined, timeout)
      .then(body => {
        if (!live) return
        const line = fns.current.parse(body)
        setStatus(line)
        keep(fns.current.pack ? fns.current.pack(line) : line)
      })
      .catch((e: unknown) => {
        if (!live) return
        setStatus(e instanceof GatewayError && e.code === 404 ? 'missing' : ({ ok: false, reason: e instanceof Error ? e.message : String(e) } as T))
      })
    return () => {
      live = false
    }
  }, [on, path, variant, timeout])

  return status
}
