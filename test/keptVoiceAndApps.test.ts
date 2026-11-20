import { describe, expect, it } from 'vitest'
import { withoutCredentials } from '../src/renderer/src/state/keptAnswers'
import { availability, packGrokLine, unpackGrokLine } from '../src/renderer/src/state/grokLive'
import { keptLine, keptStatusKey } from '../src/renderer/src/state/useKeptStatus'
import { keptAppsKey, keptSnapshot } from '../src/renderer/src/state/useHostedApps'
import type { Snapshot } from '../src/renderer/src/state/hostedApps'

describe('kept voice status lines', () => {
  it('keep each line apart from its route, per variant', () => {
    expect(keptStatusKey('/api/plugins/conduit_push/gpt-live/status')).toBe('/api/plugins/conduit_push/gpt-live/status#line')
    expect(keptStatusKey('/s', 'api')).toBe('/s#line:api')
    expect(keptStatusKey('/s', 'api')).not.toBe(keptStatusKey('/s', 'plan'))
  })

  it('read back only a line shaped like a check', () => {
    expect(keptLine({ ok: true, model: 'gemini' })).toEqual({ ok: true, model: 'gemini' })
    expect(keptLine({ ok: false, reason: 'no_api_key' })).toEqual({ ok: false, reason: 'no_api_key' })
    expect(keptLine('Available')).toBeNull()
    expect(keptLine(null)).toBeNull()
  })

  it("keep Grok's sign-in kind through the store, which leaves out auth", () => {
    const line = availability({ ok: true, available: true, model: 'grok-voice', voice: 'Ara', auth: 'subscription' })
    expect(withoutCredentials(line)).not.toHaveProperty('auth')
    const kept = withoutCredentials(packGrokLine(line))
    expect(unpackGrokLine(kept)).toEqual(line)
    const off = availability({ ok: true, available: false, reason: 'no credential' })
    expect(unpackGrokLine(withoutCredentials(packGrokLine(off)))).toEqual(off)
    expect(unpackGrokLine({ ok: true })).toBeNull()
  })
})

describe("kept Connectors' Apps", () => {
  const snapshot: Snapshot = {
    available: true,
    catalog: [{ slug: 'gmail', name: 'Gmail', description: 'Mail', category: 'mail', logo: null }],
    statuses: [{ connector: 'gmail', enabled: true, connected: true, connectionStatus: 'active', statusReason: null, gatewayDisabledTools: [] }],
    accounts: [
      { connectionId: 'c1', connector: 'gmail', status: 'active', statusReason: null, label: 'me@example.com', alias: 'Work', active: true, retired: false, createdAt: '2026-11-01' }
    ],
    policy: { member: { revision: 'r1', allowed: null, denied: [], tools: {}, enabledTags: [], disabledTags: [] }, others: [] },
    rulesFailed: false
  }

  it('come back whole through the store, per profile', () => {
    expect(keptSnapshot(withoutCredentials(snapshot))).toEqual(snapshot)
    expect(keptAppsKey('')).toBe(keptAppsKey('default'))
    expect(keptAppsKey('work')).not.toBe(keptAppsKey('default'))
  })

  it('read back only a snapshot', () => {
    expect(keptSnapshot(undefined)).toBeNull()
    expect(keptSnapshot({ available: true })).toBeNull()
    expect(keptSnapshot({ available: false, catalog: [], statuses: [], accounts: [] })).toEqual({
      available: false,
      catalog: [],
      statuses: [],
      accounts: [],
      policy: null,
      rulesFailed: false
    })
  })
})
