import { describe, expect, it } from 'vitest'
import { causeText, isKeptOut, isLookAhead, leftOutReason, lessonText, parseLearned, parseLeftOut, preferenceDetail, subject } from '../src/renderer/src/state/pulseLearned'

describe('what Pulse learned', () => {
  it('reads lessons, levels and preferences, dropping what it does not know', () => {
    const learned = parseLearned({
      lessons: [{ id: 4, kind: 'followup', what: 'sooner', value: '', cause: '2 thumbs up' }, { id: 'x', what: 'level' }],
      levels: { followup: 'push', deadline: 'loud', next: 'brief' },
      preferences: [{ scope: 'kind', value: 'deadline', effect: -0.8, useful: 1, votes: 3 }, { scope: 'weird', effect: 1 }, { scope: 'all' }]
    })
    expect(learned.lessons.map(l => l.id)).toEqual([4])
    expect(learned.levels).toEqual({ followup: 'push', next: 'brief' })
    expect(learned.preferences).toHaveLength(1)
  })

  it('words lessons and causes as the phone does', () => {
    const lesson = { id: 1, kind: 'followup', what: 'sooner', value: '', cause: '', chatTitle: '' }
    expect(lessonText(lesson)).toBe('Check on promises sooner')
    expect(lessonText({ ...lesson, kind: 'deadline', what: 'level', value: 'brief' })).toBe('Deadlines: In the morning brief')
    expect(lessonText({ ...lesson, what: 'rule', value: 'sports' })).toBe('No updates about “sports”')
    expect(lessonText({ ...lesson, what: 'reset', kind: 'place', value: 'chat:default:c1', chatTitle: 'Trip' })).toBe('Reset: Things from “Trip”')
    expect(lessonText({ ...lesson, what: 'part', value: 'night', kind: 'next' })).toBe('Next steps: No notifications at night')
    expect(causeText('set')).toBeNull()
    expect(causeText('2 thumbs down')).toBe('After thumbs down')
  })

  it('describes a preference', () => {
    expect(subject('place', 'area:money', '')).toBe('Things about “Money and finances”')
    expect(subject('timely', 'yes', '')).toBe("What's overdue or due within a day")
    expect(preferenceDetail({ scope: 'kind', value: 'fact', effect: 1.6, useful: 2.5, votes: 4, pushes: 0, chatTitle: '' }, 'en')).toBe(
      'Brings up more · Strong effect · Useful 2.5 out of 4 lately'
    )
    expect(preferenceDetail({ scope: 'loud', value: 'followup', effect: 1, useful: 0, votes: 0, pushes: 3, chatTitle: '' }, 'en')).toBe(
      'Louder · After 3 notifications you acted on within the hour'
    )
  })

  it('reads what was left out and why', () => {
    const entries = parseLeftOut({
      left_out: [
        { id: 1, text: 'Dentist', kind: 'reminder', decision: 'quieted', profile: 'default', chat_id: 'c1', chat_title: 'Health', learned: { scope: 'place', value: 'chat:default:c1', effect: -1 }, created_at: 100 },
        { id: 2, text: 'Trip', decision: 'not_picked', from: 'look_ahead', card_id: 9 },
        { id: 3, text: '' }
      ]
    })
    expect(entries).toHaveLength(2)
    expect(isKeptOut(entries[0]!)).toBe(true)
    expect(entries[0]!.learned?.chatTitle).toBe('Health')
    expect(entries[0]!.createdAt).toBe(100_000)
    expect(isLookAhead(entries[1]!)).toBe(true)
    expect(entries[1]!.cardId).toBe(9)
    expect(leftOutReason(entries[1]!)).toBe('Not picked in the look ahead')
    expect(leftOutReason({ ...entries[1]!, decision: 'skipped', skip: 'covered' })).toBe('Your calendar, reminders or a scheduled job covers it')
  })
})
