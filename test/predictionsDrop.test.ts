// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { TranscriptStore } from '../src/renderer/src/state/transcriptStore'
import { emptyTranscript, type TranscriptItem } from '../src/renderer/src/state/transcript'

const http = vi.fn()
vi.mock('../src/renderer/src/gateway', () => ({ gateway: { http: (...args: unknown[]) => http(...args) } }))

const { usePredictions } = await import('../src/renderer/src/state/usePredictions')
const { instructionsKey, setRepliesEnabled } = await import('../src/renderer/src/state/predictive')

const settled = new TranscriptStore({
  ...emptyTranscript,
  items: [
    { key: 'u1', kind: 'user', text: 'Plan the trip' },
    { key: 'a1', kind: 'assistant', text: 'Here is a plan.' }
  ] as unknown as TranscriptItem[]
})

describe('suggested replies when the instructions change in another window (hermes-conduit#2970)', () => {
  afterEach(() => {
    http.mockReset()
    localStorage.clear()
  })

  it('drops the replies made under the old instructions', async () => {
    setRepliesEnabled(true)
    http.mockImplementation(async (method: string) =>
      method === 'GET'
        ? { version: '0.190.0', capabilities: ['predict', 'predict-custom-instructions'] }
        : { replies: [{ text: 'Book the hotel' }] }
    )
    const hook = renderHook(() => usePredictions(settled, 's1'), undefined)
    await settle()
    expect(hook.result().replies).toEqual(['Book the hotel'])
    // Another window's Settings edits the instructions: only a storage event says so here.
    localStorage.setItem(instructionsKey('replies'), 'Be brief')
    window.dispatchEvent(new StorageEvent('storage', { key: instructionsKey('replies') }))
    await settle()
    expect(hook.result().replies).toEqual([])
    hook.unmount()
  })
})
