import { describe, expect, it } from 'vitest'
import { muteIds, muteOf, mutePath, parseMutes, settingMute } from '../src/renderer/src/state/chatMute'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, extra: Partial<ChatRow> = {}): ChatRow => ({ id, title: id, pinned: false, ...extra })

describe('Muted chats', () => {
  it('reads the route on this computer’s clock and finds a mute by any of the chat’s ids', () => {
    const mutes = parseMutes(
      {
        ok: true,
        chats: [
          { session_ids: ['root', 'tip'], until: 99_999, remaining_s: 60 },
          { session_ids: ['forever'], until: null, remaining_s: null },
          { session_ids: ['ended'], until: 5, remaining_s: 0 },
          { session_ids: [], until: null, remaining_s: null }
        ]
      },
      1000
    )
    expect(mutes).toEqual([
      { ids: ['root', 'tip'], until: 61_000 },
      { ids: ['forever'], until: null }
    ])
    expect(parseMutes({ error: 'nope' })).toBeNull()
    const all = { default: mutes! }
    expect(muteOf(all, row('tip', { lineageRoot: 'elsewhere' }), 2000)).toEqual({ ids: ['root', 'tip'], until: 61_000 })
    expect(muteOf(all, row('branch', { lineageRoot: 'root' }), 2000)).toBeNull()
    expect(muteOf(all, row('tip'), 62_000)).toBeNull()
    expect(muteOf(all, row('forever'), 1e15)?.until).toBeNull()
    expect(muteOf(all, row('tip', { profile: 'work' }), 2000)).toBeNull()
    expect(muteOf(null, row('tip'))).toBeNull()
  })

  it('mutes and unmutes before the plugin answers, one mute per chat', () => {
    const branch = row('chat-2', { lineageRoot: 'chat-1', profile: 'Work' })
    expect(muteIds(branch)).toEqual(['chat-2'])
    let mutes = settingMute(null, branch, 900, 5)
    expect(mutes).toEqual({ work: [{ ids: ['chat-2'], until: 900_005 }] })
    expect(muteOf(mutes, row('chat-1', { profile: 'work' }), 6)).toBeNull()
    mutes = settingMute(mutes, row('chat-1', { profile: 'work' }), null, 6)
    expect(mutes!.work).toEqual([{ ids: ['chat-1'], until: null }, { ids: ['chat-2'], until: 900_005 }])
    mutes = settingMute(mutes, branch, 0)
    expect(muteOf(mutes, branch)).toBeNull()
    expect(muteOf(mutes, row('chat-1', { profile: 'work' }))).not.toBeNull()
  })

  it('asks a named profile’s plugin by name and the default without one', () => {
    expect(mutePath('default')).toBe('/api/plugins/conduit_push/notifications/muted-chats')
    expect(mutePath('my bot')).toBe('/api/plugins/conduit_push/notifications/muted-chats?profile=my%20bot')
  })
})
