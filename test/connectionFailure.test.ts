import { describe, expect, it } from 'vitest'
import { connectionFailureKind } from '../src/main/connectionFailure'
import { trustSystemRoots } from '../src/main/systemRoots'

const failed = (code: string) => new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) })

describe('connection failures', () => {
  it('names each failure by the check that failed, the most specific first', () => {
    expect(connectionFailureKind(failed('CERT_NOT_YET_VALID'))).toBe('tlsBadDate')
    expect(connectionFailureKind(failed('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe('tlsHostnameMismatch')
    expect(connectionFailureKind(failed('UNABLE_TO_GET_ISSUER_CERT_LOCALLY'))).toBe('tlsUntrusted')
    expect(connectionFailureKind(failed('DEPTH_ZERO_SELF_SIGNED_CERT'))).toBe('tlsUntrusted')
    expect(connectionFailureKind(failed('ERR_SSL_WRONG_VERSION_NUMBER'))).toBe('tlsFailure')
    expect(connectionFailureKind(failed('EAI_AGAIN'))).toBe('hostNotFound')
    expect(connectionFailureKind(failed('EHOSTUNREACH'))).toBe('unreachable')
    expect(connectionFailureKind(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))).toBe('timedOut')
    // A host with several addresses fails each.
    expect(connectionFailureKind(new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]) }))).toBe('unreachable')
    expect(connectionFailureKind(new Error('something else'))).toBeNull()
  })

  it('adds the computer’s own roots to Node’s, or leaves them when it can’t', () => {
    let set: string[] = []
    const api = { getCACertificates: (type?: string) => (type === 'system' ? ['sys', 'both'] : ['node', 'both']), setDefaultCACertificates: (certs: string[]) => (set = certs) }
    expect(trustSystemRoots(api as never)).toBe(true)
    expect(set).toEqual(['node', 'both', 'sys'])
    expect(trustSystemRoots({ getCACertificates: () => [], setDefaultCACertificates: () => undefined } as never)).toBe(false)
    expect(trustSystemRoots({} as never)).toBe(false)
  })
})
