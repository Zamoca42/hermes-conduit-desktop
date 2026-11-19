import { describe, expect, it } from 'vitest'
import { isDirty, parseFields, planSave, settingsRow, wireValue } from '../src/renderer/src/state/pluginSettings'

const row = {
  key: 'acme/weather',
  name: 'weather',
  settings_schema: [
    { key: 'units', type: 'enum', label: 'Units', choices: ['metric', 'imperial'], value: 'metric' },
    { key: 'days', type: 'number', label: 'Days', value: 3, required: true },
    { key: 'verbose', type: 'boolean', label: 'Verbose', value: false },
    { key: 'extra', type: 'json', label: 'Extra', value: { a: 1 } },
    { key: 'city', type: 'string', label: 'City', default: 'Paris' },
    { key: 'api_key', type: 'secret', label: 'API key', env: 'WEATHER_KEY', has_value: true },
    { key: 'orphan', type: 'secret', label: 'No env' },
    { key: 'units', type: 'string' }
  ]
}

describe('plugin settings', () => {
  it('reads the fields, each key once, and drops a secret with no variable', () => {
    const fields = parseFields(row)
    expect(fields.map(f => f.key)).toEqual(['units', 'days', 'verbose', 'extra', 'city', 'api_key'])
    expect(fields.find(f => f.key === 'days')!.initial).toBe('3')
    expect(fields.find(f => f.key === 'verbose')!.initial).toBe('false')
    expect(fields.find(f => f.key === 'extra')!.initial).toBe('{\n  "a": 1\n}')
    expect(fields.find(f => f.key === 'city')!.initial).toBe('Paris')
    const secret = fields.find(f => f.key === 'api_key')!
    expect(secret).toMatchObject({ env: 'WEATHER_KEY', hasValue: true, initial: '' })
  })

  it('finds the row by key, then name', () => {
    const response = { plugins: [row, { key: 'other', name: 'acme/weather' }] }
    expect(settingsRow(response, 'acme/weather')).toBe(row)
    expect(settingsRow(response, 'nope', 'weather')).toBe(row)
    expect(settingsRow(response, 'nope')).toBeUndefined()
    expect(settingsRow(null, 'x')).toBeUndefined()
  })

  it('sends only what changed, secrets apart', () => {
    const fields = parseFields(row)
    expect(isDirty(fields, { units: 'metric', api_key: '  ' })).toBe(false)
    const draft = { units: 'imperial', days: '2,5', verbose: 'true', city: 'Paris', api_key: ' sk-1 ' }
    expect(isDirty(fields, draft)).toBe(true)
    expect(planSave(fields, draft)).toEqual({ values: { units: 'imperial', days: 2.5, verbose: true }, secrets: { WEATHER_KEY: 'sk-1' } })
  })

  it('refuses what doesn’t fit', () => {
    const fields = parseFields(row)
    const get = (k: string) => fields.find(f => f.key === k)!
    expect(() => planSave(fields, { days: ' ' })).toThrow('Days is required.')
    expect(() => wireValue(get('days'), 'abc')).toThrow('Days: enter a number.')
    expect(() => wireValue(get('units'), 'kelvin')).toThrow('Units: pick one of the choices.')
    expect(() => wireValue(get('extra'), 'null')).toThrow('Extra: enter a JSON list or object.')
    expect(wireValue(get('extra'), '[1]')).toEqual([1])
  })
})
