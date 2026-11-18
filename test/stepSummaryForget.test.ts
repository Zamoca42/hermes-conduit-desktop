import { beforeEach, describe, expect, it } from 'vitest'
import { forgetSummaries, saveSummary, savedSummary, summaryScope } from '../src/renderer/src/state/stepSummaries'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0
} as Storage

describe('step summaries by host', () => {
  beforeEach(() => store.clear())

  it('keeps each host and profile apart', () => {
    saveSummary(summaryScope('https://one', undefined), 'call_aaaaaaaaaaaa', 'One')
    expect(savedSummary(summaryScope('https://one', 'default'), 'call_aaaaaaaaaaaa')).toBe('One')
    expect(savedSummary(summaryScope('https://two', undefined), 'call_aaaaaaaaaaaa')).toBeNull()
    expect(savedSummary(summaryScope('https://one', 'work'), 'call_aaaaaaaaaaaa')).toBeNull()
  })

  it("forgets a signed-out host's summaries and those kept before hosts scoped them", () => {
    saveSummary(summaryScope('https://one', 'work'), 'call_aaaaaaaaaaaa', 'One')
    saveSummary(summaryScope('https://two', undefined), 'call_bbbbbbbbbbbb', 'Two')
    saveSummary('default', 'call_cccccccccccc', 'Old')
    forgetSummaries(['https://two'])
    expect(savedSummary(summaryScope('https://one', 'work'), 'call_aaaaaaaaaaaa')).toBeNull()
    expect(savedSummary(summaryScope('https://two', 'default'), 'call_bbbbbbbbbbbb')).toBe('Two')
    expect(savedSummary('default', 'call_cccccccccccc')).toBeNull()
    forgetSummaries([])
    expect(store.size).toBe(0)
  })
})
