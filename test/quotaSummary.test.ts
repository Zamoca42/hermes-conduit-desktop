import { describe, expect, it } from 'vitest'
import { providerQuotaLine, quotaLine, quotaSummary, type ProviderQuota } from '../src/renderer/src/state/usage'

const quota = (over: Partial<ProviderQuota>): ProviderQuota => ({ slug: 'p', title: 'P', windows: [], accounts: [], limit: null, ...over })
const NOW = Date.parse('2026-11-20T12:00:00Z')

describe("a model list's provider quota", () => {
  it('reads the tightest account-wide window, a model-scoped one only when there is no other', () => {
    expect(
      quotaSummary(
        quota({
          windows: [
            { label: 'Session', usedPercent: 30, modelScoped: false },
            { label: 'Weekly', usedPercent: 60, modelScoped: false, resetsAt: 5 },
            { label: 'Opus', usedPercent: 95, modelScoped: true }
          ]
        })
      )
    ).toEqual({ left: 0.4, resetsAt: 5 })
    expect(quotaSummary(quota({ windows: [{ label: 'Opus', usedPercent: 90, modelScoped: true }] }))?.left).toBeCloseTo(0.1)
  })

  it('counts the usable account with the most left, and a pool all limited reads limited until the first frees', () => {
    const accounts = [
      { id: 'a', label: '', state: 'ready' as const, windows: [{ label: 'W', usedPercent: 80, modelScoped: false }] },
      { id: 'b', label: '', state: 'unknown' as const, windows: [{ label: 'W', usedPercent: 20, modelScoped: false }] },
      { id: 'c', label: '', state: 'limited' as const, windows: [{ label: 'W', usedPercent: 0, modelScoped: false }] }
    ]
    expect(quotaSummary(quota({ accounts }))?.left).toBeCloseTo(0.8)
    expect(
      quotaSummary(
        quota({
          accounts: [
            { id: 'a', label: '', state: 'limited', windows: [], resetsAt: 9 },
            { id: 'b', label: '', state: 'limited', windows: [], resetsAt: 7 },
            { id: 'c', label: '', state: 'unavailable', windows: [] }
          ]
        })
      )
    ).toEqual({ left: null, resetsAt: 7 })
    expect(quotaSummary(quota({ limit: { scope: 'account', resetsAt: 3 } }))).toEqual({ left: null, resetsAt: 3 })
    expect(quotaSummary(quota({}))).toBeNull()
  })

  it('says how much is left, orange under a fifth, red when limited', () => {
    expect(quotaLine({ left: 0.96 }, NOW)).toEqual({ text: '96% left', tone: 'plain' })
    expect(quotaLine({ left: 0.15 }, NOW).tone).toBe('low')
    expect(quotaLine({ left: 0.004 }, NOW).text).toBe('0.4% left')
    expect(quotaLine({ left: null }, NOW)).toEqual({ text: 'Limited', tone: 'out' })
    expect(quotaLine({ left: 0.5, resetsAt: NOW + 3_600_000 }, NOW).text).toMatch(/^50% left · resets /)
  })

  it('reads a catalog row as Hermes sends it, and nothing from a row without usage', () => {
    expect(providerQuotaLine({ slug: 'openai-codex', name: 'ChatGPT', usage: { windows: [{ label: 'Weekly', used_percent: 4 }] } }, NOW)?.text).toBe('96% left')
    expect(providerQuotaLine({ slug: 'zai', name: 'Z.AI', models: ['glm'] }, NOW)).toBeNull()
  })
})
