import { describe, expect, it } from 'vitest'
import { draftRequest, emptyDraft, itemDetails, normalizedOrigin, sourceStatus, vaultItems, vaultSources } from '../src/renderer/src/state/vault'

describe('normalizedOrigin', () => {
  it('keys a site by scheme and host', () => {
    expect(normalizedOrigin('GitHub.com/login')).toBe('https://github.com')
    expect(normalizedOrigin('http://Example.org:8080/x')).toBe('http://example.org:8080')
  })
  it('refuses what is not a web address', () => {
    expect(normalizedOrigin('')).toBeNull()
    expect(normalizedOrigin('two words')).toBeNull()
    expect(normalizedOrigin('ftp://example.com')).toBeNull()
  })
})

describe('draftRequest', () => {
  it('names a login for its site and trims the key', () => {
    const outcome = draftRequest({ ...emptyDraft(), origin: 'github.com', identifier: ' me@x.org ', password: 'pw ', otpSecret: 'abcd efgh-ijkl' })
    expect(outcome).toEqual({
      ok: true,
      request: {
        kind: 'login',
        label: 'github.com',
        origin: 'https://github.com',
        secret: { identifier_type: 'email', identifier: 'me@x.org', password: 'pw ', otp_secret: 'abcdefghijkl' }
      }
    })
  })
  it('needs a site, an identifier and a password for a login', () => {
    expect(draftRequest({ ...emptyDraft(), label: 'x', identifier: 'a', password: 'b' }).ok).toBe(false)
    expect(draftRequest({ ...emptyDraft(), origin: 'a.com', identifier: 'a' }).ok).toBe(false)
  })
  it('checks a card', () => {
    const card = { ...emptyDraft(), kind: 'payment' as const, label: 'Visa', cardNumber: '4242 4242-4242 4242', expMonth: '3', expYear: '29', cvc: '123' }
    const outcome = draftRequest(card)
    expect(outcome.ok && outcome.request.secret).toEqual({ card_number: '4242424242424242', exp_month: '03', exp_year: '29', cvc: '123' })
    expect(draftRequest({ ...card, expMonth: '13' }).ok).toBe(false)
    expect(draftRequest({ ...card, cardNumber: '42x' }).ok).toBe(false)
  })
  it('needs a full address', () => {
    const address = { ...emptyDraft(), kind: 'address' as const, label: 'Home', addressLine1: '1 Main St', city: 'Town', postalCode: '123', country: 'US' }
    expect(draftRequest(address).ok).toBe(true)
    expect(draftRequest({ ...address, city: ' ' }).ok).toBe(false)
  })
})

describe('vault answers', () => {
  const sources = vaultSources({ sources: [{ name: 'bitwarden', display_name: 'Bitwarden', installed: true, enabled: true, unlocked: false }, { nope: 1 }] })
  it('reads sources and items', () => {
    expect(sources).toHaveLength(1)
    expect(sourceStatus(sources[0]!)).toBe('Locked')
    const items = vaultItems({
      items: [
        { id: '1', kind: 'login', label: 'GitHub', origin: 'https://github.com', identifier: 'me', backend: 'bitwarden', has_otp: true },
        { kind: 'login' }
      ]
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.hasOTP).toBe(true)
    expect(itemDetails(items[0]!, sources)).toBe('Login · me · github.com · Bitwarden')
  })
  it('leaves out the site when the label already says it', () => {
    const [item] = vaultItems({ items: [{ id: '2', kind: 'login', label: 'github.com', origin: 'https://github.com', created_at: 'bad' }] })
    expect(itemDetails(item!, sources)).toBe('Login')
  })
})
