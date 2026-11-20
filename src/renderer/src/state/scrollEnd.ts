/** How far from the end a reader still counts as at the latest message. */
export const NEAR_END = 48

/** Whether a scroller is at (or within NEAR_END of) its end. */
export function atEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END
}
