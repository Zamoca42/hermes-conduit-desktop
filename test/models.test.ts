import { describe, expect, it } from 'vitest'
import { groupModels, reasoningTitle } from '../src/renderer/src/state/models'
import { chatSettings } from '../src/renderer/src/state/useChat'

describe('the Model panel', () => {
  const providers = [
    { slug: 'openrouter', name: 'OpenRouter', models: ['anthropic/claude-sonnet', 'openai/gpt-5'], unavailable_models: ['openai/gpt-5'] },
    { slug: 'zai', name: 'Z.AI', models: ['glm-5.3', 'glm-5.3-flash'] },
    { slug: 'empty', name: 'Empty', models: [] }
  ]

  it('lists each provider’s runnable models, narrowed by every word typed', () => {
    expect(groupModels(providers, '')).toEqual([
      { slug: 'openrouter', name: 'OpenRouter', models: ['anthropic/claude-sonnet'] },
      { slug: 'zai', name: 'Z.AI', models: ['glm-5.3', 'glm-5.3-flash'] }
    ])
    expect(groupModels(providers, 'zai flash')).toEqual([{ slug: 'zai', name: 'Z.AI', models: ['glm-5.3-flash'] }])
    expect(groupModels(providers, 'nothing')).toEqual([])
  })

  it('names reasoning levels, and a word it doesn’t know readably', () => {
    expect(reasoningTitle('none')).toBe('Off')
    expect(reasoningTitle('xhigh')).toBe('Extra High')
    expect(reasoningTitle('super_high')).toBe('Super high')
  })

  it('reads the chat’s settings from Hermes’ session info', () => {
    expect(chatSettings({ model: 'm', provider: 'p', reasoning_effort: '', fast: true, service_tier: 'ultrafast', yolo: false })).toEqual({
      model: 'm',
      provider: 'p',
      reasoning: '',
      speed: 'ultrafast',
      yolo: false
    })
    expect(chatSettings({ fast: true, service_tier: 'priority' }).speed).toBe('fast')
    expect(chatSettings(undefined)).toEqual({})
  })
})
