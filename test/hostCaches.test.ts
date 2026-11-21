import { describe, expect, it } from 'vitest'
import { forgetHostCaches } from '../src/renderer/src/state/hostCaches'
import { keptRosters } from '../src/renderer/src/state/bots'
import { keptOwnRooms } from '../src/renderer/src/state/useGroups'
import { keptCopies } from '../src/renderer/src/state/useRoomCopies'
import { keptCapabilities, keptInvites } from '../src/renderer/src/state/useRoomInvites'
import { keptRoomsByHost } from '../src/renderer/src/state/keptHosts'
import { keepTranscript, keptTranscript } from '../src/renderer/src/state/transcriptCache'
import { keepsFor } from '../src/renderer/src/state/savedHosts'
import type { TranscriptState } from '../src/renderer/src/state/transcript'

const A = 'https://a.example'
const B = 'https://b.example'
const settled = { items: [{ kind: 'assistant', key: 'k', text: 'hi', at: 1 } as TranscriptState['items'][number]], running: false }

describe('a dashboard no longer saved', () => {
  it('takes what each kept cache read for it, and later reads keep nothing for it', () => {
    for (const host of [A, B]) {
      keptRosters.set(host, { bots: [], hidden: [], protocol: false, at: 1 })
      keptOwnRooms.set(host, { capabilities: { supported: true, canStop: false, attachments: false }, rooms: [], at: 1 })
      keptCopies.set(host, [])
      keptCapabilities.set(host, [])
      keptInvites.set(host, [])
      keptRoomsByHost.set(host, { rooms: [], copies: [], at: 1 })
      keepTranscript('s1', undefined, settled, host)
    }
    forgetHostCaches([A])
    for (const map of [keptRosters, keptOwnRooms, keptCopies, keptCapabilities, keptInvites, keptRoomsByHost] as Map<string, unknown>[]) {
      expect(map.has(A)).toBe(true)
      expect(map.has(B)).toBe(false)
    }
    expect(keptTranscript('s1', undefined, A)).not.toBeNull()
    expect(keptTranscript('s1', undefined, B)).toBeNull()
    expect(keepsFor(A)).toBe(true)
    expect(keepsFor(B)).toBe(false)
  })
})
