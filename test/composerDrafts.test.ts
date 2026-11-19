import { describe, expect, it } from 'vitest'
import { DraftStore, chatDraft, draftStoreKey, isEmptyDraft } from '../src/renderer/src/state/composerDrafts'

const words = (text: string) => ({ text, attachments: [], replyTo: null })

describe('composer drafts', () => {
  it('keeps a draft for its own chat until an empty one replaces it', () => {
    const store = new DraftStore()
    const a = draftStoreKey('https://one', chatDraft('default', 's1'))
    const b = draftStoreKey('https://one', chatDraft('default', 's2'))
    store.save(a, words('half a thought'))
    expect(store.peek(a)?.text).toBe('half a thought')
    expect(store.peek(b)).toBeNull()
    store.save(a, words(''))
    expect(store.peek(a)).toBeNull()
  })

  it('tells hosts, profiles and new chats apart', () => {
    const one = draftStoreKey('https://one', chatDraft('default', null))
    expect(one).not.toBe(draftStoreKey('https://two', chatDraft('default', null)))
    expect(one).not.toBe(draftStoreKey('https://one', chatDraft('work', null)))
    expect(chatDraft('default', undefined)).toBe(chatDraft('default', null))
  })

  it('holds the 12 most recently left drafts, like the phone', () => {
    const store = new DraftStore()
    for (let i = 0; i < 14; i++) store.save(`k${i}`, words(`draft ${i}`))
    expect(store.size).toBe(12)
    expect(store.peek('k0')).toBeNull()
    expect(store.peek('k1')).toBeNull()
    expect(store.peek('k13')?.text).toBe('draft 13')
    // Leaving a chat again makes its draft the newest.
    store.save('k2', words('draft 2 again'))
    store.save('k14', words('draft 14'))
    expect(store.peek('k2')?.text).toBe('draft 2 again')
    expect(store.peek('k3')).toBeNull()
  })

  it("drops a signed-out host's drafts and keeps the others", () => {
    const store = new DraftStore()
    store.save(draftStoreKey('https://one', 'room'), words('one'))
    store.save(draftStoreKey('https://one:8443', 'room'), words('other port'))
    store.save(draftStoreKey('https://two', 'room'), words('two'))
    store.dropHost('https://one')
    expect(store.peek(draftStoreKey('https://one', 'room'))).toBeNull()
    expect(store.peek(draftStoreKey('https://one:8443', 'room'))?.text).toBe('other port')
    expect(store.peek(draftStoreKey('https://two', 'room'))?.text).toBe('two')
  })

  it('counts a quoted reply or a file as a draft', () => {
    expect(isEmptyDraft(words(''))).toBe(true)
    expect(isEmptyDraft({ text: '', attachments: [], replyTo: { text: 'quoted' } as never })).toBe(false)
  })
})
