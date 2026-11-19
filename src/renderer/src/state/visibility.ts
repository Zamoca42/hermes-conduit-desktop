/**
 * A timed read that runs only while the window shows, as the phone's
 * timed reads stop in the background: ticks while it's hidden are skipped,
 * and showing it again reads at once, so what changed meanwhile is there on
 * return. Returns the cleanup.
 */
export function everyWhileVisible(read: () => void, ms: number, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document): () => void {
  const timer = setInterval(() => {
    if (doc.visibilityState === 'visible') read()
  }, ms)
  let wasVisible = doc.visibilityState === 'visible'
  const onChange = () => {
    const visible = doc.visibilityState === 'visible'
    if (visible && !wasVisible) read()
    wasVisible = visible
  }
  doc.addEventListener('visibilitychange', onChange)
  return () => {
    clearInterval(timer)
    doc.removeEventListener('visibilitychange', onChange)
  }
}
