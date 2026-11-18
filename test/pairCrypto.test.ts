import { createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { b64u, fromB64u, inboxId, makePairKeys, openFromPhone, ownerAuthorization, pairLink, pairWords, parsePairLink, sealForComputer } from '../src/main/pairCrypto'

describe('pairing crypto', () => {
  it('opens what the phone sealed for this key and inbox, and nothing else', () => {
    const keys = makePairKeys()
    const box = sealForComputer(Buffer.from('{"hosts":[]}'), keys.sealPublic, 'inbox-1')
    const opened = openFromPhone(box, keys, 'inbox-1')
    expect(opened.plaintext.toString()).toBe('{"hosts":[]}')
    expect(() => openFromPhone(box, keys, 'inbox-2')).toThrow()
    expect(() => openFromPhone(box, makePairKeys(), 'inbox-1')).toThrow()
    expect(() => openFromPhone(Buffer.from('{"v":2}'), keys, 'inbox-1')).toThrow('Not a pairing envelope.')
  })

  it('shows four words that depend on both keys', () => {
    const a = makePairKeys().sealPublic
    const e1 = makePairKeys().sealPublic
    const e2 = makePairKeys().sealPublic
    const words = pairWords(a, e1)
    expect(words).toHaveLength(4)
    expect(pairWords(a, e1)).toEqual(words)
    expect(pairWords(a, e2)).not.toEqual(words)
    // A fixed vector for the phone's tests: 32 zero bytes and 32 0x01 bytes.
    expect(pairWords(Buffer.alloc(32, 0), Buffer.alloc(32, 1))).toMatchInlineSnapshot(`
      [
        "only",
        "notable",
        "gym",
        "rescue",
      ]
    `)
  })

  it('round-trips the QR link and refuses anything else', () => {
    const keys = makePairKeys()
    const link = { mailbox: 'https://rooms.milim.dev', inbox: inboxId(keys.signPublic), token: 'tok', key: b64u(keys.sealPublic), expires: 1_800_000_000 }
    expect(parsePairLink(pairLink(link))).toEqual(link)
    expect(parsePairLink('conduit://connect?url=x')).toBeNull()
    expect(parsePairLink(pairLink({ ...link, key: 'short' }))).toBeNull()
  })

  it('signs owner requests the way the mailbox checks them', () => {
    const keys = makePairKeys()
    const header = ownerAuthorization(keys.signPrivate, 'post', 'rooms.milim.dev', '/v1/inboxes', Buffer.from('{}'), 1_800_000_000_000)
    const m = /^Mailbox-Ed25519 ts=(\d+),nonce=([A-Za-z0-9_-]+),sig=([A-Za-z0-9_-]+)$/.exec(header)!
    expect(m[1]).toBe('1800000000')
    const bodyHash = 'RBNvo1WzZ4oRRq0W9-hknpT7T8If536DEMBg9hyq_4o' // SHA-256 of "{}"
    const message = ['mailbox-v1', 'POST', 'rooms.milim.dev', '/v1/inboxes', '1800000000', m[2], bodyHash].join('\n')
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(keys.signPublic) }, format: 'jwk' })
    expect(verify(null, Buffer.from(message), pub, fromB64u(m[3]!))).toBe(true)
  })
})
