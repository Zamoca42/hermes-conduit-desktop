import { describe, expect, it } from 'vitest'
import { GatewayError } from '../src/renderer/src/gateway'
import { isRuntimeGone } from '../src/renderer/src/state/runtimeGone'

describe('isRuntimeGone', () => {
  it("reads Hermes' cleared runtime as gone", () => {
    expect(isRuntimeGone(new GatewayError('session not found', 4001))).toBe(true)
    expect(isRuntimeGone(new GatewayError('not found', 4001, 'not_found'))).toBe(true)
    expect(isRuntimeGone(new Error('Session not found'))).toBe(true)
  })

  it("keeps the authority's other refusals and other errors as they are", () => {
    expect(isRuntimeGone(new GatewayError('no', 4001, 'permission_denied'))).toBe(false)
    expect(isRuntimeGone(new GatewayError('session busy', 4009))).toBe(false)
    expect(isRuntimeGone(new GatewayError('owned', 4090, 'SESSION_NOT_OWNED'))).toBe(false)
    expect(isRuntimeGone(null)).toBe(false)
  })
})
