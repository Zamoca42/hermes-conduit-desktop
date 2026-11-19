import { describe, expect, it } from 'vitest'
import { mayGoLater, refusedSend, reportBody, sha256Hex, surfaceFor } from '../src/renderer/src/state/turnSurface'
import { GatewayError } from '../src/renderer/src/gateway'

describe('where a message was sent from', () => {
  it('names the Mac, and a Windows PC only for a plugin that takes it', () => {
    expect(surfaceFor('darwin', ['turn-surface'])).toBe('mac')
    expect(surfaceFor('win32', ['turn-surface'])).toBeNull()
    expect(surfaceFor('win32', ['turn-surface', 'turn-surface-windows'])).toBe('windows')
    expect(surfaceFor('darwin', [])).toBeNull()
    expect(surfaceFor('linux', ['turn-surface', 'turn-surface-windows'])).toBeNull()
  })

  it('reports the hash of the exact text, how it was entered and whether its reply is heard', async () => {
    const digest = await sha256Hex('hello')
    expect(digest).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(reportBody('s1', digest, 'mac', 'typed', true)).toEqual({ session_id: 's1', text_sha256: digest, surface: 'mac', input: 'typed', heard: true })
    // A spoken message's reply is a call's: heard goes only with a typed one.
    expect(reportBody('s1', digest, 'windows', 'spoken', true)).toEqual({ session_id: 's1', text_sha256: digest, surface: 'windows', input: 'spoken' })
  })

  it('drops a report only for a send Hermes refused, and tries a discard again only when it may go later', () => {
    expect(refusedSend(new GatewayError('busy', 4009))).toBe(true)
    // A timeout or a dropped socket may have delivered it.
    expect(refusedSend(new Error('request timed out after 30s: prompt.submit'))).toBe(false)
    expect(refusedSend(new GatewayError('closed'))).toBe(false)
    expect(mayGoLater(new Error('offline'))).toBe(true)
    expect(mayGoLater(new GatewayError('slow', 503))).toBe(true)
    expect(mayGoLater(new GatewayError('later', 429))).toBe(true)
    expect(mayGoLater(new GatewayError('no', 400))).toBe(false)
  })
})
