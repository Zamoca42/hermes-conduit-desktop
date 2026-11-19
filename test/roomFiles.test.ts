import { describe, expect, it } from 'vitest'
import { roomMessage, roomItems } from '../src/renderer/src/state/groups'
import { LINKED_MAX_BYTES, ROOM_FILES_PATH, isStoredRoomFile, linkedRoomFilesProblem, pictureFromRead, roomFilesText, storedReference } from '../src/renderer/src/state/roomFiles'

const staged = (name: string, size: number, base64 = 'aGk=') => ({ id: name, name, size, mime: 'image/png', base64, kind: 'image' }) as never

describe('files in a room with other people’s agents', () => {
  it('holds a file over the 16 MB such a room shares', () => {
    expect(linkedRoomFilesProblem([staged('a.png', LINKED_MAX_BYTES)])).toBeNull()
    expect(linkedRoomFilesProblem([staged('big.mov', LINKED_MAX_BYTES + 1)])).toBe("big.mov is larger than the 16 MB a room with other people's agents can share with them.")
    expect(linkedRoomFilesProblem([staged('a.mov', LINKED_MAX_BYTES + 1), staged('b.mov', LINKED_MAX_BYTES + 1)])).toContain(': a.mov, b.mov.')
  })

  it('stores each file with the plugin and puts its line above the words', async () => {
    const calls: unknown[] = []
    const text = await roomFilesText(
      async (path, body, timeout) => {
        calls.push([path, body, timeout])
        return calls.length === 1 ? { ok: true, ref_text: '@file:/h/conduit/room-files/20261119-ab/a.png' } : { ok: true, path: '/h/conduit/room-files/20261119-cd/my b.png' }
      },
      'Look',
      [staged('a.png', 2), staged('my b.png', 2)]
    )
    expect(text).toBe('@file:/h/conduit/room-files/20261119-ab/a.png\n@file:`/h/conduit/room-files/20261119-cd/my b.png`\n\nLook')
    expect(calls[0]).toEqual([ROOM_FILES_PATH, { name: 'a.png', data_base64: 'aGk=' }, 180_000])
    expect(storedReference({ ok: false, path: '/x' })).toBeNull()
    await expect(roomFilesText(async () => ({ ok: true }), '', [staged('a.png', 2)])).rejects.toThrow()
  })

  it('reads a message’s file lines apart, and its pictures back from the plugin', () => {
    const message = roomMessage({ text: '@file:/h/conduit/room-files/20261119-ab/a.png\n@file:"C:\\H\\conduit\\room-files\\x\\notes.txt"\n\nLook' })
    expect(message.text).toBe('Look')
    expect(message.files).toEqual([
      { kind: 'image', name: 'a.png', path: '/h/conduit/room-files/20261119-ab/a.png' },
      { kind: 'file', name: 'notes.txt', path: 'C:\\H\\conduit\\room-files\\x\\notes.txt' }
    ])
    // Not every leading line a file: the words stay as they are.
    expect(roomMessage({ text: '@file:/a.png\n@url:https://x\nHi' }).files).toEqual([])
    expect(isStoredRoomFile('/h/conduit/room-files/20261119-ab/a.png')).toBe(true)
    expect(isStoredRoomFile('/etc/passwd')).toBe(false)
    expect(pictureFromRead({ dataUrl: 'data:image/png;base64,aGk=' })).toBe('data:image/png;base64,aGk=')
    expect(pictureFromRead({ dataUrl: 'data:text/html;base64,aGk=' })).toBeNull()
  })

  it('unnames a post the host made for someone before reading its files', () => {
    const items = roomItems(
      null,
      [{ eventId: 'e', seq: 1, kind: 'message.user', actor: { id: 'u' }, payload: { text: 'Bo: @file:/h/conduit/room-files/1-a/p.png\nBo: \nBo: Hi' }, post: { by: 'Bo' }, createdAt: 1 } as never],
      { host: 'Ana' }
    )
    expect(items[0]).toMatchObject({ kind: 'person', name: 'Bo', text: 'Hi', files: [{ kind: 'image', name: 'p.png' }] })
  })
})
