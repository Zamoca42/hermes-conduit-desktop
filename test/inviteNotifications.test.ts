import { describe, expect, it } from 'vitest'
import { askNotification, inviteNotification, newlyArrived } from '../src/renderer/src/state/notifications'

const store = () => {
  const all: Record<string, string> = {}
  return { getItem: (k: string) => all[k] ?? null, setItem: (k: string, v: string) => void (all[k] = v) }
}

describe('telling about new invites and asks', () => {
  it('says who invited you to what, as the plugin’s push does', () => {
    expect(inviteNotification({ id: 'L|r', from: 'Ana', name: 'Weekend hike' })).toEqual({
      title: 'Ana invited you to Weekend hike',
      body: 'Choose which of your agents join, or decline.',
      tag: 'room-invite-L|r'
    })
    expect(inviteNotification({ id: 'x', from: '', name: 'Trip' }).title).toBe('Someone invited you to Trip')
    expect(askNotification({ id: 'p', title: 'Share your dates?' }, 'Asked in Trip')).toEqual({ title: 'Asked in Trip', body: 'Share your dates?', tag: 'ask-p' })
  })

  it('tells about each one once, never about what was there at the first read', () => {
    const s = store()
    expect(newlyArrived('k', ['a'], s)).toEqual([])
    expect(newlyArrived('k', ['a', 'b'], s)).toEqual(['b'])
    expect(newlyArrived('k', ['a', 'b'], s)).toEqual([])
    expect(newlyArrived('k', [], s)).toEqual([])
    expect(newlyArrived('k', ['c'], s)).toEqual(['c'])
  })
})
