import { createContext, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** What a kept scroll position reads and sets on its list. */
export interface Scroller {
  scrollTop: number
}

/**
 * A list's scroll position that outlives the list: a dashboard switch draws
 * the window afresh (App's Shell is keyed by host), and the Bots sidebar
 * opens where it was rather than at the top. The new list may draw short at
 * first (another dashboard's rooms arrive a moment later), so it keeps
 * trying on each draw until it reaches the spot or you scroll yourself.
 */
export class KeptScroll {
  private top = 0
  private restoring = false

  /**
   * A list drew for the first time, or a kept one is shown again: it starts
   * restoring the kept spot. The top too: a kept list shown again still sits
   * where it was when it went away, though the group chat page's list has
   * since scrolled back up.
   */
  opened(): void {
    this.restoring = true
  }

  /** After each draw: puts the list back at the kept spot while restoring. */
  drew(el: Scroller): void {
    if (!this.restoring) return
    el.scrollTop = this.top
    // The browser stops at the list's end; once it reaches the spot, it's done.
    if (el.scrollTop >= this.top - 1) this.restoring = false
  }

  /** The list scrolled: kept, unless it's the restore moving it. */
  scrolled(el: Scroller): void {
    if (!this.restoring) this.top = el.scrollTop
  }

  /** You scrolled, clicked or typed in the list: your spot wins over the kept one. */
  touched(): void {
    this.restoring = false
  }
}

/** The Bots sidebar's, for the whole window: its side pane and its group chat page share it. */
export const botSideScroll = new KeptScroll()

/**
 * Calls `onShown` as a pane kept mounted comes back from away, during that
 * render, so the children drawing it again see what it set (the Bots
 * sidebar's kept scroll restores in its own layout effect, which runs
 * before a parent's). A side effect in render, so `onShown` must be safe to
 * run twice (StrictMode) or for a render that's thrown away: arming a
 * restore that the next draw settles, as `botSideScroll.opened()` does.
 */
export function useShownAgain(away: boolean, onShown?: () => void): void {
  const wasAway = useRef(away)
  if (wasAway.current && !away) onShown?.()
  wasAway.current = away
}

/**
 * A pane's pages, the way you went down them, each with its scroll spot:
 * back on a page puts the pane where it was, and a page opened from it
 * starts at its top (Settings > Voice opens at Voice's top, and Back lands
 * on the row you opened it from, as on the phone).
 */
export class ScrollStack {
  private pages: { view: string; kept: KeptScroll }[] = []

  /** After each draw, with the page on show: it opens, comes back or stays. */
  drew(view: string, el: Scroller): void {
    const at = this.pages.findIndex(page => page.view === view)
    if (at === -1) {
      // Opened from the page on show; the pane's first page stays where the pane is.
      const opened = this.pages.length > 0
      this.pages.push({ view, kept: new KeptScroll() })
      if (opened) el.scrollTop = 0
      return
    }
    const page = this.pages[at]
    if (at < this.pages.length - 1) {
      // Back: the pages opened from it are done with.
      this.pages.length = at + 1
      page.kept.opened()
    }
    page.kept.drew(el)
  }

  /** The pane scrolled: kept for the page on show. */
  scrolled(el: Scroller): void {
    this.pages.at(-1)?.kept.scrolled(el)
  }

  /** You scrolled, clicked or typed in the pane: your spot wins over a restore. */
  touched(): void {
    this.pages.at(-1)?.kept.touched()
  }
}

/** The scrolling pane a page draws in (Settings', Pulse's), for pages inside it that open pages of their own. */
export const ScrollPane = createContext<RefObject<HTMLElement | null> | null>(null)

/**
 * Keeps `pane`'s scroll spot for each page `view` names (the pane from
 * ScrollPane if not given): Back returns to where the page was. Call it
 * where the pages switch, every render.
 */
export function useBackScroll(view: string, pane?: RefObject<HTMLElement | null>): void {
  const shared = useContext(ScrollPane)
  const ref = pane ?? shared
  const stack = useRef<ScrollStack | null>(null)
  stack.current ??= new ScrollStack()
  useLayoutEffect(() => {
    if (ref?.current) stack.current?.drew(view, ref.current)
  })
  useEffect(() => {
    const el = ref?.current
    const pages = stack.current
    if (!el || !pages) return
    const scrolled = () => pages.scrolled(el)
    const touched = () => pages.touched()
    el.addEventListener('scroll', scrolled, { passive: true })
    el.addEventListener('wheel', touched, { passive: true })
    el.addEventListener('pointerdown', touched)
    el.addEventListener('keydown', touched)
    return () => {
      el.removeEventListener('scroll', scrolled)
      el.removeEventListener('wheel', touched)
      el.removeEventListener('pointerdown', touched)
      el.removeEventListener('keydown', touched)
    }
  }, [ref])
}
