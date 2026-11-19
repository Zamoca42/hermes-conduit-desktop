import { describe, expect, it } from 'vitest'
import { CHAT_WINDOW_LIMIT, ChatWindowSet } from '../src/main/chatWindowSet'
import { chatWindowRequest } from '../src/shared/chatWindows'

function harness() {
  const made: { id: string; focused: number; closed: boolean; onClosed: () => void }[] = []
  const changes: string[][] = []
  const set = new ChatWindowSet(
    (chat, onClosed) => {
      const window = {
        id: chat.id,
        focused: 0,
        closed: false,
        onClosed,
        focus: () => window.focused++,
        close: () => {
          window.closed = true
          onClosed()
        }
      }
      made.push(window)
      return window
    },
    ids => changes.push(ids)
  )
  return { set, made, changes }
}

describe('chat windows of their own', () => {
  it('opens one per chat, up to three, and focuses a chat’s own window again', () => {
    const { set, made, changes } = harness()
    expect(CHAT_WINDOW_LIMIT).toBe(3)
    expect(set.show({ id: 'a' })).toBe(true)
    expect(set.show({ id: 'a' })).toBe(true)
    expect(made).toHaveLength(1)
    expect(made[0]!.focused).toBe(1)
    expect(set.show({ id: 'b' })).toBe(true)
    expect(set.show({ id: 'c' })).toBe(true)
    expect(set.show({ id: 'd' })).toBe(false)
    expect(set.ids()).toEqual(['a', 'b', 'c'])
    expect(changes.at(-1)).toEqual(['a', 'b', 'c'])
    // The user closing one makes room.
    made[1]!.onClosed()
    expect(set.ids()).toEqual(['a', 'c'])
    expect(set.show({ id: 'd' })).toBe(true)
  })

  it('closes named chats’ windows, or every one on a switch', () => {
    const { set, made, changes } = harness()
    set.show({ id: 'a' })
    set.show({ id: 'b' })
    set.close(['a', 'zzz'])
    expect(made[0]!.closed).toBe(true)
    expect(set.ids()).toEqual(['b'])
    const before = changes.length
    set.close(['zzz'])
    expect(changes).toHaveLength(before)
    set.close()
    expect(set.ids()).toEqual([])
    expect(made.every(w => w.closed)).toBe(true)
  })

  it('reads its chat from the page’s hash', () => {
    const chat = { id: 's1', profile: 'ops', title: 'Plans & “ideas”', author: 'Nahida' }
    expect(chatWindowRequest(`#chat=${encodeURIComponent(JSON.stringify(chat))}`)).toEqual(chat)
    expect(chatWindowRequest('#quick')).toBeNull()
    expect(chatWindowRequest('#chat=%7B%7D')).toBeNull()
    expect(chatWindowRequest('#chat=%zz')).toBeNull()
  })
})
