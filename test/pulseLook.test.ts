import { describe, expect, it } from 'vitest'
import { amount, extraActions, askAction, lookDay, move, parseLook, pastLimit, relativeDay } from '../src/renderer/src/state/pulseLook'
import { parseCard, wasUpdated } from '../src/renderer/src/state/pulse'

describe('Pulse looks', () => {
  it('reads each shape and falls back to plain', () => {
    expect(parseLook({ shape: 'date', facts: { day: '2026-11-21', what: 'Birthday', whose: 'Dana' } })?.body).toMatchObject({ shape: 'date', what: 'Birthday' })
    expect(parseLook({ shape: 'runs', facts: { job: 'b', results: ['ok', 'fail'] } })?.body).toEqual({ shape: 'runs', job: 'b', results: [true, false] })
    expect(parseLook({ shape: 'runs', facts: { results: ['ok', 'maybe'] } })?.body.shape).toBe('plain')
    expect(parseLook({ shape: 'steps', facts: { names: ['a', 'b'], at: 2 } })?.body.shape).toBe('plain')
    expect(parseLook({ shape: 'status', facts: { label: 'x', state: 'warn' } })?.body).toEqual({ shape: 'status', label: 'x', state: 'warn' })
    expect(parseLook({ shape: 'number', facts: { label: 'n', value: '3.5', better: 'up' } })?.body).toMatchObject({ value: 3.5, better: 'up', was: null })
    expect(parseLook({ shape: 'drawn', facts: { body: { type: 'stats', items: [] } } })?.body.shape).toBe('drawn')
    expect(parseLook({ shape: 'drawn', facts: { body: { type: 'map' } } })?.body.shape).toBe('plain')
    expect(parseLook({ shape: 'brief', facts: { summary: 's', today: ['a'], counts: { held: 2 } } })?.body).toEqual({
      shape: 'brief',
      summary: 's',
      today: ['a'],
      open: [],
      held: 2
    })
    expect(parseLook(null)).toBeNull()
  })
  it('keeps at most two actions, one of each, with what they need', () => {
    const look = parseLook({
      shape: 'plain',
      actions: [
        { does: 'ask', label: 'Plan', say: 'Help me plan' },
        { does: 'ask', label: 'Again', say: 'x' },
        { does: 'open', label: 'Site', url: 'javascript:alert(1)' },
        { does: 'open', label: 'Site', url: 'https://example.org' },
        { does: 'draft', label: 'Draft', text: 'hi' }
      ]
    })
    expect(look?.actions.map(a => a.does)).toEqual(['ask', 'open'])
    expect(askAction(look)?.value).toBe('Help me plan')
    expect(extraActions(look).map(a => a.value)).toEqual(['https://example.org'])
  })
  it('reads the plugin days', () => {
    expect(lookDay('2026-11-20')).toMatchObject({ hasTime: false })
    expect(lookDay('2026-11-20T15:30')?.date.getHours()).toBe(15)
    expect(lookDay('2026-02-30')).toBeNull()
    expect(lookDay('2026-11-20T25:00')).toBeNull()
    expect(relativeDay(new Date(2026, 10, 21), new Date(2026, 10, 20, 23), 'en')).toBe('tomorrow')
  })
  it('says how a number moved', () => {
    expect(move(815, 600, 'down')).toBe('bad')
    expect(move(5, 6, 'down')).toBe('good')
    expect(move(5, 6, null)).toBe('unsaid')
    expect(move(5, 5, 'up')).toBeNull()
    expect(pastLimit(815, 700, 'down')).toBe(true)
    expect(pastLimit(815, 700, null)).toBe(false)
    expect(amount(12.5, '%', 'en')).toBe('12.5%')
    expect(amount(3, 'kg', 'en')).toBe('3 kg')
  })
  it('reads a card rewritten since', () => {
    const card = parseCard({ id: 1, created_at: 100, updated_at: 160, look: { shape: 'plain' } })!
    expect(card.look?.body.shape).toBe('plain')
    expect(wasUpdated(card)).toBe(true)
  })
})
