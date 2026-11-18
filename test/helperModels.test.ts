import { describe, expect, it } from 'vitest'
import { hasOwnModel, helperSummary, parseModelSettings } from '../src/renderer/src/state/helperModels'

describe('parseModelSettings', () => {
  const raw = {
    main: { provider: 'openrouter', model: 'anthropic/claude' },
    tasks: [
      { task: 'vision', provider: 'auto', model: '', label: 'Vision', hint: 'x' },
      { task: 'compression', provider: 'openrouter', model: 'small', inherit_from: 'vision' },
      { task: 'pulse_memory', provider: 'auto', model: '' },
      { task: 'vision', provider: 'x', model: 'dup' },
      { task: 'new_thing', provider: 'auto', model: '', label: '', hint: 'A newer slot.' },
      { task: 'labelled', provider: 'auto', model: '', label: ' Fancy ' },
      null
    ]
  }

  it('keeps the main model and one slot per task, leaving out the ones set elsewhere', () => {
    const settings = parseModelSettings(raw)
    expect(settings.main).toEqual({ provider: 'openrouter', model: 'anthropic/claude' })
    expect(settings.slots.map(slot => slot.task)).toEqual(['vision', 'compression', 'new_thing', 'labelled'])
  })

  it('names known slots, a newer one by its label or key, and who a slot follows', () => {
    const [vision, compression, newer, labelled] = parseModelSettings(raw).slots
    expect(vision.title).toBe('Image reading')
    expect(compression.follows).toBe('Image reading')
    expect(newer.title).toBe('New thing')
    expect(newer.caption).toBe('A newer slot.')
    expect(labelled.title).toBe('Fancy')
  })

  it('counts slots with a model of their own', () => {
    const { slots } = parseModelSettings(raw)
    expect(slots.filter(hasOwnModel).map(slot => slot.task)).toEqual(['compression'])
    expect(helperSummary(slots)).toBe('1 of 4 have a model of their own')
    expect(helperSummary(slots.filter(slot => !hasOwnModel(slot)))).toBe('All use the chat model')
  })

  it('reads nothing as empty', () => {
    expect(parseModelSettings(null)).toEqual({ main: { provider: '', model: '' }, slots: [] })
  })
})
