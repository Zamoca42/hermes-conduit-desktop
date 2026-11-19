import { describe, expect, it } from 'vitest'
import {
  ClipInbox,
  CLIP_LIMIT,
  CLIP_MAX_AGE_MS,
  isTransient,
  keepsAfter,
  memoryClipStore,
  pruned,
  withRetries,
  type DictationClip
} from '../src/renderer/src/state/dictationClips'

const clip = (id: string, created: number, over: Partial<DictationClip> = {}): DictationClip => ({
  id,
  host: 'https://one',
  profile: '',
  mime: 'audio/webm',
  base64: 'AAAA',
  duration: 4,
  created,
  ...over
})
const failure = (code?: number, message = 'failed') => Object.assign(new Error(message), { code })

describe('kept dictations', () => {
  it('tries the connection and a busy host again, never a sign-in or Hermes refusing', () => {
    for (const code of [408, 429, 500, 502, 503]) expect(isTransient(failure(code))).toBe(true)
    for (const code of [400, 401, 403, 404, 413, 501]) expect(isTransient(failure(code))).toBe(false)
    expect(isTransient(failure(undefined, 'Request timed out'))).toBe(true)
    expect(isTransient(failure(undefined, 'No speech provider is configured'))).toBe(false)
  })

  it('waits 5, 15, 30 and 60 seconds between tries, then gives up', async () => {
    const waits: number[] = []
    let tries = 0
    const result = withRetries(
      async () => {
        tries++
        throw failure(503)
      },
      async ms => void waits.push(ms)
    )
    await expect(result).rejects.toThrow('failed')
    expect(tries).toBe(5)
    expect(waits).toEqual([5000, 15000, 30000, 60000])
    let second = 0
    expect(
      await withRetries(
        async () => (++second < 2 ? Promise.reject(failure(429)) : 'words'),
        async () => {}
      )
    ).toBe('words')
    let refused = 0
    await expect(
      withRetries(
        async () => (refused++, Promise.reject(failure(401))),
        async () => {}
      )
    ).rejects.toThrow()
    expect(refused).toBe(1)
  })

  it('keeps a long recording Hermes heard nothing in, and lets a short one go', () => {
    expect(keepsAfter('', 12)).toBe(true)
    expect(keepsAfter('', 3)).toBe(false)
    expect(keepsAfter('hello', 30)).toBe(false)
  })

  it('lets recordings go after two weeks and past twenty', () => {
    const now = 100 * CLIP_MAX_AGE_MS
    const clips = Array.from({ length: 25 }, (_, i) => clip(`c${i}`, now - i * 1000))
    clips.push(clip('old', now - CLIP_MAX_AGE_MS - 1))
    const kept = pruned(clips, now)
    expect(kept.length).toBe(CLIP_LIMIT)
    expect(kept[0]!.id).toBe('c0')
    expect(kept.some(c => c.id === 'old' || c.id === 'c24')).toBe(false)
  })

  it('offers a recording on its own host and profile, and not while it uploads', async () => {
    const store = memoryClipStore()
    const inbox = new ClipInbox(store)
    await inbox.keep(clip('a', Date.now()))
    await inbox.keep(clip('b', Date.now(), { profile: 'work' }))
    await inbox.keep(clip('c', Date.now(), { host: 'https://two' }))
    expect(inbox.offered('https://one', '').map(c => c.id)).toEqual(['a'])
    expect(inbox.offered('https://one', '', new Set(['a']))).toEqual([])
    await inbox.release('a')
    expect(inbox.offered('https://one', '')).toEqual([])
    expect((await store.all()).map(c => c.id).sort()).toEqual(['b', 'c'])
    // A relaunch finds what was kept.
    const again = new ClipInbox(store)
    await again.load()
    expect(again.offered('https://one', 'work').map(c => c.id)).toEqual(['b'])
  })
})
