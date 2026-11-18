import { describe, expect, it } from 'vitest'
import { delegateChain, fallbackJson, fallbackList, moved, sameList, savedValue } from '../src/renderer/src/state/fallbacks'

describe('fallbacks', () => {
  it('reads objects and legacy provider/model strings, keeping routing', () => {
    const list = fallbackList([{ provider: 'openrouter', model: 'a/b', base_url: 'http://x' }, 'nous/hermes-4', 'bare', '', 3])
    expect(list).toEqual([
      { provider: 'openrouter', model: 'a/b', extras: { base_url: 'http://x' } },
      { provider: 'nous', model: 'hermes-4', extras: {} },
      { provider: '', model: 'bare', extras: {} }
    ])
    expect(fallbackJson(list[0])).toEqual({ base_url: 'http://x', provider: 'openrouter', model: 'a/b' })
  })
  it('the subagents follow the chat while unset or null', () => {
    expect(delegateChain({}).inherits).toBe(true)
    expect(delegateChain({ delegation: { fallback_providers: null } }).inherits).toBe(true)
    expect(delegateChain({ delegation: { fallback_providers: [] } })).toEqual({ inherits: false, entries: [] })
  })
  it('saves null to follow, else only complete entries in order', () => {
    const list = fallbackList(['a/x', { provider: 'b', model: '' }])
    expect(savedValue(true, list)).toBeNull()
    expect(savedValue(false, list)).toEqual([{ provider: 'a', model: 'x' }])
  })
  it('moves within the list only', () => {
    expect(moved([1, 2, 3], 2, -1)).toEqual([1, 3, 2])
    expect(moved([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(sameList(fallbackList(['a/x']), fallbackList([{ provider: 'a', model: 'x' }]))).toBe(true)
  })
})
