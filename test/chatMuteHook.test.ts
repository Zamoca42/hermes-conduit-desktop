// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { renderHook, settle } from './hookHarness'
import { muteOf, useChatMute } from '../src/renderer/src/state/chatMute'
import type { ChatRow } from '../src/renderer/src/state/chats'

const row: ChatRow = { id: 'chat-1', title: 'Chat', pinned: false }

describe('the muted chats hook', () => {
  it('drops a read that started before a mute, and keeps what the write answered', async () => {
    let answerRead: (body: unknown) => void = () => {}
    const calls: string[] = []
    const http = (method: 'GET' | 'PUT', _path: string, body?: unknown) => {
      calls.push(method)
      if (method === 'GET') return new Promise<unknown>(resolve => (answerRead = resolve))
      const { mute_s } = body as { mute_s: number | null }
      return Promise.resolve({ ok: true, chats: mute_s === 0 ? [] : [{ session_ids: ['chat-1'], until: null, remaining_s: null }] })
    }
    const hook = renderHook(() => useChatMute(http, true, ['default'], 'v1', 'https://h'), {})
    await settle()
    expect(calls).toEqual(['GET'])

    act(() => hook.result().setMute(row, null))
    await settle()
    expect(muteOf(hook.result().mutes, row)?.until).toBeNull()

    // The read sent before the mute answers with the old list: it's dropped.
    await act(async () => answerRead({ ok: true, chats: [] }))
    await settle()
    expect(muteOf(hook.result().mutes, row)).not.toBeNull()
    hook.unmount()
  })

  it('reads another host afresh and never shows the first host\'s mutes there', async () => {
    let muted = true
    const http = () => Promise.resolve({ ok: true, chats: muted ? [{ session_ids: ['chat-1'], until: null, remaining_s: null }] : [] })
    const hook = renderHook(({ host }: { host: string }) => useChatMute(http, true, ['default'], 'v1', host), { host: 'https://a' })
    await settle()
    expect(muteOf(hook.result().mutes, row)).not.toBeNull()
    muted = false
    hook.rerender({ host: 'https://b' })
    await settle()
    expect(hook.result().available).toBe(true)
    expect(muteOf(hook.result().mutes, row)).toBeNull()
    hook.unmount()
  })
})
