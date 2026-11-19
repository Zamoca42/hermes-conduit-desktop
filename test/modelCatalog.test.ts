import { describe, expect, it } from 'vitest'
import { catalogKey, catalogNote, refusesRefresh } from '../src/renderer/src/state/modelCatalog'
import { GatewayError } from '../src/renderer/src/gateway'

const rows = [{ slug: 'openai', name: 'OpenAI', models: ['gpt-6'] }]

describe('a model picker’s catalog', () => {
  it('says a failed read, an empty catalog and loading apart', () => {
    expect(catalogNote({ providers: null, answered: false, failed: false, loading: true })).toBe('loading')
    // Kept models show while Hermes answers, with no loader.
    expect(catalogNote({ providers: rows, answered: false, failed: false, loading: true })).toBeNull()
    expect(catalogNote({ providers: rows, answered: true, failed: true, loading: false })).toBe('failed')
    expect(catalogNote({ providers: null, answered: false, failed: true, loading: false })).toBe('failed')
    expect(catalogNote({ providers: [], answered: true, failed: false, loading: false })).toBe('empty')
    expect(catalogNote({ providers: [{ slug: 'x', name: 'X', models: [] }], answered: true, failed: false, loading: false })).toBe('empty')
    // Kept as empty but not yet answered says nothing.
    expect(catalogNote({ providers: [], answered: false, failed: false, loading: true })).toBeNull()
    expect(catalogNote({ providers: rows, answered: true, failed: false, loading: false })).toBeNull()
  })

  it('keeps one catalog for the same question asked in any order', () => {
    expect(catalogKey({ explicit_only: true, profile: 'a' })).toBe(catalogKey({ profile: 'a', explicit_only: true }))
    expect(catalogKey({ explicit_only: true, profile: 'a' })).not.toBe(catalogKey({ explicit_only: true, profile: 'b' }))
  })

  it('reads from the cache on a Hermes that refuses the refresh flag', () => {
    expect(refusesRefresh(new GatewayError('invalid params: unknown field refresh', 4001, 'invalid_params'))).toBe(true)
    expect(refusesRefresh(new GatewayError('invalid params: refresh', 4000))).toBe(true)
    expect(refusesRefresh(new GatewayError('timed out', 4000))).toBe(false)
    expect(refusesRefresh(new Error('refresh'))).toBe(false)
  })
})
