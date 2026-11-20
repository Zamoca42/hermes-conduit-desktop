import { describe, expect, it } from 'vitest'
import { cleanRules, gapChoices, gapText, parseCallsStatus, testCallPrompt, watchPrompt } from '../src/renderer/src/state/callSettings'

describe('Calls from Hermes settings', () => {
  it('reads the host status, keeping settings older plugins lack absent', () => {
    const status = parseCallsStatus({
      ok: true,
      paired: true,
      settings: { enabled: true, when_asked: true, min_gap_s: 120, per_hour: 6, per_day: 20 },
      bounds: { per_hour: { min: 1, max: 30 } },
      rules_max: 400
    })
    expect(status?.paired).toBe(true)
    expect(status?.settings.decides).toBeUndefined()
    expect(status?.bounds.per_hour).toEqual({ min: 1, max: 30 })
    expect(status?.bounds.min_gap_s).toEqual({ min: 30, max: 3600 })
    expect(status?.rulesMax).toBe(400)
    expect(parseCallsStatus({ ok: false })).toBeNull()
  })

  it('offers spacing steps inside the bounds and keeps the current one', () => {
    expect(gapChoices({ min: 60, max: 600 }, 90)).toEqual([60, 90, 120, 300, 600])
    expect(gapText(120, 'en')).toBe('2 minutes')
    expect(gapText(3600, 'en')).toBe('1 hour')
    expect(gapText(30, 'en')).toBe('30 seconds')
  })

  it('keeps the note as the host does', () => {
    expect(cleanRules('  only prod \n\n never before 9 \n')).toBe('only prod\nnever before 9')
  })

  it("leaves the phone's test call and watch requests, the note trimmed as the host keeps it", () => {
    expect(testCallPrompt()).toBe('Call me now to test calls.')
    expect(watchPrompt('  only prod \n\n never before 9 \n')).toBe(
      'Make my scheduled checks that call me match this note. Update the ones I already have instead of adding new ones:\nonly prod\nnever before 9'
    )
  })
})
