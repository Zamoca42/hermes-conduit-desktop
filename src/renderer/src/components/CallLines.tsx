import { useLayoutEffect, useRef } from 'react'
import { atEnd } from '../state/scrollEnd'

export interface CallLine {
  id: number
  who: 'user' | 'assistant'
  text: string
}

/**
 * A live call's transcript under its status. It follows the newest line, as
 * the phone's call screen does (anchored at the bottom), unless the user has
 * scrolled up to read; scrolling back to the end follows again. Any upward
 * scroll stops following, however small: the list is only a few lines tall,
 * so the transcript's usual near-the-end allowance would swallow a one-line
 * scroll up. Its own scrolls are noted where they land, so never count.
 */
export function CallLines({ lines }: { lines: readonly CallLine[] }) {
  const list = useRef<HTMLOListElement>(null)
  const following = useRef(true)
  const lastTop = useRef(0)
  // Runs after every render, so a line growing word by word keeps up too.
  useLayoutEffect(() => {
    const el = list.current
    if (!el || !following.current) return
    el.scrollTop = el.scrollHeight
    // Where it landed, clamped: a list that lost a long line from its front
    // (the panels keep the last few) lands higher, which isn't the user scrolling up.
    lastTop.current = el.scrollTop
  })
  if (!lines.length) return null
  return (
    <ol
      ref={list}
      className="voice-call-lines"
      aria-live="polite"
      onScroll={event => {
        const el = event.currentTarget
        if (el.scrollTop < lastTop.current) following.current = false
        else if (atEnd(el)) following.current = true
        lastTop.current = el.scrollTop
      }}
    >
      {lines.map(line => (
        <li key={line.id} className={line.who === 'user' ? 'voice-call-line said' : 'voice-call-line'}>
          {line.text}
        </li>
      ))}
    </ol>
  )
}
