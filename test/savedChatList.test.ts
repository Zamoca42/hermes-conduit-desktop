import { describe, expect, it } from 'vitest'
import { SAVED_ROWS, forgetChatLists, saveChatList, savedChatList } from '../src/renderer/src/state/savedChatList'
import { copyHostData } from '../src/renderer/src/state/hostData'

function memory() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    }
  }
}

const row = (id: string) => ({ id, title: `Chat ${id}`, pinned: false })

describe('saved chat list', () => {
  it('keeps each dashboard its own newest rows', () => {
    const storage = memory()
    saveChatList('http://a', Array.from({ length: SAVED_ROWS + 5 }, (_, i) => row(String(i))), storage)
    saveChatList('http://b', [row('b1')], storage)
    expect(savedChatList('http://a', storage)).toHaveLength(SAVED_ROWS)
    expect(savedChatList('http://b', storage)?.map(r => r.id)).toEqual(['b1'])
    expect(savedChatList('http://c', storage)).toBeNull()
  })

  it('reads nothing from a damaged copy, and drops rows that are not rows', () => {
    const storage = memory()
    storage.setItem('conduit.savedChats.v1.http://a', '{nope')
    expect(savedChatList('http://a', storage)).toBeNull()
    storage.setItem('conduit.savedChats.v1.http://a', JSON.stringify([row('1'), { id: 2 }]))
    expect(savedChatList('http://a', storage)?.map(r => r.id)).toEqual(['1'])
  })

  it('goes with a dashboard signed out, and moves with Edit Connection', () => {
    const storage = memory()
    saveChatList('http://a', [row('1')], storage)
    saveChatList('http://b', [row('2')], storage)
    copyHostData('http://a', 'http://a2', storage)
    expect(savedChatList('http://a2', storage)?.map(r => r.id)).toEqual(['1'])
    forgetChatLists(['http://a2'], storage)
    expect(savedChatList('http://b', storage)).toBeNull()
    expect(savedChatList('http://a2', storage)).not.toBeNull()
  })
})
