import { describe, expect, it } from 'vitest'
import { chooserLines, chooserListed, chooserPick, chooserValue, providerStartsOpen } from '../src/renderer/src/state/modelChooser'

const providers = [
  { slug: 'openrouter', name: 'OpenRouter', models: ['a/one', 'b/two'] },
  { slug: 'anthropic', name: 'Anthropic', models: ['claude-x'] }
]
const groups = providers.map(p => ({ slug: p.slug, models: p.models }))

describe('A model setting on the Model page', () => {
  it('keeps the setting\'s value as provider and model, empty for its default', () => {
    expect(chooserValue('openrouter', 'a/one')).toBe('openrouter\na/one')
    expect(chooserValue('', '')).toBe('')
    expect(chooserPick('openrouter\na/one')).toEqual({ provider: 'openrouter', model: 'a/one' })
    expect(chooserPick('')).toEqual({ provider: '', model: '' })
  })

  it('names the model and its provider on the row, or the setting\'s default', () => {
    expect(chooserLines('anthropic\nclaude-x', providers, 'Same as chats')).toEqual({ title: 'claude-x', detail: 'Anthropic' })
    expect(chooserLines('', providers, 'Same as chats')).toEqual({ title: 'Same as chats', detail: '' })
    // A provider the catalog doesn't list keeps its slug.
    expect(chooserLines('local\nmine', providers, 'Default')).toEqual({ title: 'mine', detail: 'local' })
    expect(chooserLines('local\nmine', null, 'Default')).toEqual({ title: 'mine', detail: 'local' })
  })

  it('tells a saved pick the catalog no longer lists', () => {
    expect(chooserListed('openrouter\nb/two', groups)).toBe(true)
    expect(chooserListed('openrouter\ngone', groups)).toBe(false)
    expect(chooserListed('', groups)).toBe(true)
  })

  it('starts every provider closed but the pick\'s, and opens every match while searching', () => {
    expect(providerStartsOpen('openrouter', '', '')).toBe(false)
    expect(providerStartsOpen('openrouter', 'openrouter\na/one', '')).toBe(true)
    expect(providerStartsOpen('anthropic', 'openrouter\na/one', '')).toBe(false)
    expect(providerStartsOpen('anthropic', '', 'cla')).toBe(true)
  })
})
