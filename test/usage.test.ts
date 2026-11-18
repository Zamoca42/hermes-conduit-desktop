import { describe, expect, it } from 'vitest'
import { parseQuotas, parseUsage, reportCost, reportCostIsEstimate, usageFailure, windowFraction, moneyLabel } from '../src/renderer/src/state/usage'

const usage = {
  totals: {
    total_input: 1000,
    total_output: 500,
    total_cache_read: 200,
    total_estimated_cost: 0.5,
    total_actual_cost: 0,
    total_sessions: 3,
    total_api_calls: 9
  },
  daily: [
    { day: '2026-11-17', input_tokens: 600, output_tokens: 300 },
    { day: '2026-11-16', input_tokens: 400, output_tokens: 200 },
    { day: '2026-11-16', input_tokens: 999 },
    { day: 'nonsense', input_tokens: 1 }
  ],
  by_model: [{ model: 'last-model', input_tokens: 1500 }],
  period_days: 7
}

describe('usage report', () => {
  it('reads totals, days in order without repeats, and prefers the models route', () => {
    const models = {
      models: [
        { model: 'small', billing_provider: 'openrouter', input_tokens: 100, output_tokens: 50, estimated_cost: 0.1 },
        { model: 'big', provider: 'anthropic', input_tokens: 900, output_tokens: 450, actual_cost: 0.4 },
        { model: 'big', provider: 'anthropic', input_tokens: 1 },
        { model: '  ', input_tokens: 5 }
      ]
    }
    const report = parseUsage(usage, models, 30)
    expect(report.days).toBe(7)
    expect(report.totals).toMatchObject({ input: 1000, output: 500, cacheRead: 200, sessions: 3, apiCalls: 9 })
    expect(report.daily.map(d => d.day)).toEqual(['2026-11-16', '2026-11-17'])
    expect(report.daily[0]!.usage.input).toBe(400)
    expect(report.models.map(m => `${m.provider}/${m.model}`)).toEqual(['anthropic/big', 'openrouter/small'])
    // Billed and estimated together: the sum of each model's own.
    expect(reportCost(report)).toBeCloseTo(0.5)
    expect(reportCostIsEstimate(report)).toBe(true)
  })

  it('falls back to by_model and to the totals without a models answer', () => {
    const report = parseUsage(usage, null, 30)
    expect(report.models.map(m => m.model)).toEqual(['last-model'])
    const bare = parseUsage({ totals: { total_actual_cost: 2, total_estimated_cost: 1 } }, null, 90)
    expect(bare.days).toBe(90)
    expect(reportCost(bare)).toBe(2)
    expect(reportCostIsEstimate(bare)).toBe(false)
  })

  it('never takes a negative, endless or text count', () => {
    const report = parseUsage({ totals: { total_input: -4, total_output: Infinity, total_sessions: '12' } }, null, 7)
    expect(report.totals).toMatchObject({ input: 0, output: 0, sessions: 12 })
  })

  it('tells a missing route and a lapsed sign-in from a failure', () => {
    expect(usageFailure({ code: 404 })).toBe('unsupported')
    expect(usageFailure({ code: 401 })).toBe('signInRequired')
    expect(usageFailure(new Error('boom'))).toBe('failed')
  })

  it('shows a sliver of cost as under a cent', () => {
    expect(moneyLabel(0.004, 'en')).toBe('<$0.01')
    expect(moneyLabel(1.5, 'en')).toBe('$1.50')
  })
})

describe('provider quota', () => {
  it('keeps providers that report windows, accounts or a limit', () => {
    const quotas = parseQuotas({
      providers: [
        { slug: 'plain', name: 'Plain', models: ['a'] },
        {
          slug: 'codex',
          name: 'ChatGPT',
          usage: {
            windows: [
              { label: 'Session', used_percent: 42, resets_at: '2026-11-18T20:00:00Z' },
              { label: 'Session', used_percent: 99 },
              { label: 'Weekly', used_percent: 130, scope: 'model' },
              { label: 'Bad', used_percent: 'x' }
            ]
          }
        },
        {
          id: 'pool',
          usage: {
            accounts: [
              { id: 'a', state: 'limited' },
              { id: 'a', label: ' Work ', state: 'odd' }
            ]
          }
        },
        { slug: 'limited', limit: { scope: 'models', models: { 'b-model': '2026-11-19T00:00:00Z', 'a-model': null } } },
        { slug: 'codex', usage: { windows: [{ label: 'Again', used_percent: 1 }] } }
      ]
    })
    expect(quotas.map(q => q.slug)).toEqual(['codex', 'pool', 'limited'])
    const codex = quotas[0]!
    expect(codex.title).toBe('ChatGPT')
    expect(codex.windows.map(w => w.label)).toEqual(['Session', 'Weekly'])
    expect(codex.windows[0]!.resetsAt).toBe(Date.parse('2026-11-18T20:00:00Z'))
    expect(windowFraction(codex.windows[1]!)).toBe(1)
    expect(codex.windows[1]!.modelScoped).toBe(true)
    const pool = quotas[1]!
    expect(pool.title).toBe('pool')
    expect(pool.accounts.map(a => [a.id, a.label, a.state])).toEqual([
      ['a', '', 'limited'],
      ['account-1', 'Work', 'unknown']
    ])
    expect(quotas[2]!.limit).toEqual({
      scope: 'models',
      models: [
        { model: 'a-model', resetsAt: undefined },
        { model: 'b-model', resetsAt: Date.parse('2026-11-19T00:00:00Z') }
      ]
    })
  })
})

describe('period days', () => {
  it('fills every day of the period, ending today', async () => {
    const { periodDays } = await import('../src/renderer/src/state/usage')
    const report = parseUsage({ daily: [{ day: '2026-11-17', input_tokens: 5 }] }, null, 7)
    const days = periodDays(report, new Date(2026, 10, 18, 9))
    expect(days.map(d => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'])
    expect(days[5]!.usage.input).toBe(5)
    // A host ahead of this clock: its day is the last bar.
    expect(periodDays(report, new Date(2026, 10, 16, 9)).at(-1)!.day).toBe('2026-11-17')
  })
})
