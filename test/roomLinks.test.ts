import { describe, expect, it } from 'vitest'
import { findInvite, inviteText, parseList, parsePreview, previewStop, roomLinksClient, shownWords } from '../src/renderer/src/state/roomLinks'

const W = ['apple', 'river', 'stone', 'cloud']

describe('Links between Hermes', () => {
  it('reads an invite as the plugin writes it, in any case, and finds one in pasted text', () => {
    expect(inviteText('  CONDUIT://Link/abcd_-12  ')).toBe('conduit://link/abcd_-12')
    expect(inviteText('conduit://link/')).toBeNull()
    expect(inviteText('conduit://link/abcde')).toBeNull() // one character left over
    expect(inviteText('conduit://link/ab=c')).toBeNull()
    expect(inviteText(`conduit://link/${'a'.repeat(2048)}`)).toBeNull()
    expect(inviteText('https://example.com')).toBeNull()
    expect(findInvite('Open this in Conduit to link: conduit://link/AbCd12. Thanks!')).toBe('conduit://link/AbCd12')
    expect(findInvite('nothing here')).toBeNull()
  })

  it('lists Links and invites, leaving out a row it can’t show', () => {
    const list = parseList({
      ok: true,
      links: [
        { id: 'l1', name: 'Ana', status: 'linked', words: W, created_at: 1700000000, plugin: '0.180.0', behind: 'theirs' },
        { id: 'l2', name: 'Bo', status: 'waiting', words: ['too', 'few'] },
        { name: 'no id', status: 'linked', words: W }
      ],
      invites: [{ id: 'i1', name: 'Me', expires_at: 1700086400 }, { id: 'i2', name: 'Me' }],
      mailbox: { reading: true }
    })
    expect(list.links).toEqual([{ id: 'l1', name: 'Ana', status: 'linked', words: W, createdAt: 1700000000, plugin: '0.180.0', behind: 'theirs' }])
    expect(list.invites).toEqual([{ id: 'i1', name: 'Me', expiresAt: 1700086400 }])
    expect(list.mailboxReading).toBe(true)
    expect(parseList({ ok: true, links: [], invites: [] }).mailboxReading).toBe(false)
    expect(() => parseList({ ok: false })).toThrow()
    expect(shownWords(W)).toBe('apple · river · stone · cloud')
  })

  it('says why an invite offers no Link', () => {
    const preview = (more: Record<string, unknown>) => parsePreview({ ok: true, name: 'Ana', words: W, mailbox: 'mail.example', expires_at: 1, expired: false, own: false, ...more })
    expect(previewStop(preview({}))).toBeNull()
    expect(previewStop(preview({ linked_as: '' }))).toBeNull()
    expect(previewStop(preview({ linked_as: 'l1' }))).toEqual({ kind: 'linked', id: 'l1' })
    expect(previewStop(preview({ expired: true, linked_as: 'l1' }))).toEqual({ kind: 'expired' })
    expect(previewStop(preview({ own: true, expired: true }))).toEqual({ kind: 'own' })
  })

  it('sends each request where the plugin takes it, mailbox calls with the long wait', async () => {
    const calls: unknown[][] = []
    const answers: Record<string, unknown> = {
      'DELETE /api/plugins/conduit_push/rooms/links?link_id=a%2Fb': { ok: true, removed: true },
      'POST /api/plugins/conduit_push/rooms/links': { ok: true, link: { id: 'l9', name: 'Ana', status: 'waiting', words: W } },
      'POST /api/plugins/conduit_push/rooms/links/invites': { ok: true, url: 'conduit://link/abcd', invite: { id: 'i1', name: 'Me', expires_at: 5 }, words: W }
    }
    const client = roomLinksClient(async (method, path, body, timeoutMs) => {
      calls.push([method, path, body, timeoutMs])
      return answers[`${method} ${path}`] as never
    })
    expect(await client.unlink('a/b')).toBe(true)
    expect((await client.accept('conduit://link/abcd', 'Me')).status).toBe('waiting')
    expect((await client.invite('Me')).url).toBe('conduit://link/abcd')
    expect(calls.map(c => c[3])).toEqual([55_000, 55_000, 55_000])
    expect(calls[1]![2]).toEqual({ url: 'conduit://link/abcd', name: 'Me' })
  })
})
