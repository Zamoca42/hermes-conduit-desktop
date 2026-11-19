import { afterEach, describe, expect, it, vi } from 'vitest'
import { everyWhileVisible } from '../src/renderer/src/state/visibility'

function fakeDocument(state: DocumentVisibilityState) {
  const listeners = new Set<() => void>()
  return {
    visibilityState: state,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    set(next: DocumentVisibilityState) {
      this.visibilityState = next
      for (const l of listeners) l()
    },
    listeners
  }
}

describe('timed reads while the window shows', () => {
  afterEach(() => vi.useRealTimers())

  it('skips ticks while hidden and reads at once when shown again', () => {
    vi.useFakeTimers()
    const doc = fakeDocument('visible')
    const read = vi.fn()
    const stop = everyWhileVisible(read, 1000, doc as unknown as Document)
    vi.advanceTimersByTime(2000)
    expect(read).toHaveBeenCalledTimes(2)
    doc.set('hidden')
    vi.advanceTimersByTime(5000)
    expect(read).toHaveBeenCalledTimes(2)
    doc.set('visible')
    expect(read).toHaveBeenCalledTimes(3)
    stop()
    vi.advanceTimersByTime(5000)
    expect(read).toHaveBeenCalledTimes(3)
    expect(doc.listeners.size).toBe(0)
  })
})
