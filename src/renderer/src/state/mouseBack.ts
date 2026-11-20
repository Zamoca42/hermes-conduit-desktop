import { useEffect, useRef } from 'react'

/**
 * The mouse's back button, or Alt+Left, leaves the page on screen, as the page's own Back does. Pages register
 * their Back while they show; the newest one answers, so a page opened from
 * another goes back one step at a time.
 */
const backs: Array<{ current: () => void }> = []

/** The handler that answers a back press: the newest registered. */
export function currentBack(): (() => void) | undefined {
  return backs.at(-1)?.current
}

/** True for the mouse's back button: button 3, as Chromium reports XButton1. */
export function isBackButton(event: { button: number }): boolean {
  return event.button === 3
}

let listening = false
function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  // Chromium would navigate on mousedown's default; nothing here has history to go back to.
  window.addEventListener('mousedown', event => {
    if (isBackButton(event) && currentBack()) event.preventDefault()
  })
  window.addEventListener('mouseup', event => {
    if (!isBackButton(event)) return
    const back = currentBack()
    if (!back) return
    event.preventDefault()
    back()
  })
  // Alt+Left, the keyboard's Back in a browser.
  window.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return
    const back = currentBack()
    if (!back) return
    event.preventDefault()
    back()
  })
}

/** While `onBack` is given, the mouse's back button calls it. */
export function useMouseBack(onBack: (() => void) | null | undefined): void {
  const latest = useRef(onBack)
  latest.current = onBack
  const on = !!onBack
  useEffect(() => {
    if (!on) return
    listen()
    const entry = { current: () => latest.current?.() }
    backs.push(entry)
    return () => {
      const at = backs.lastIndexOf(entry)
      if (at >= 0) backs.splice(at, 1)
    }
  }, [on])
}
