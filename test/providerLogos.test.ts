import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BY_SLUG, BY_WORD, providerInitial, providerLogo } from '../src/renderer/src/state/providerLogos'

const folder = 'src/renderer/src/assets/provider-logos'

describe('provider logos', () => {
  it('matches by slug, alias, custom spelling, then a whole word', () => {
    expect(providerLogo('openai-codex')).toBe('openai')
    expect(providerLogo('custom:openrouter')).toBe('openrouter')
    expect(providerLogo('mine', 'Mine', ['kimi-cn'])).toBe('kimi')
    expect(providerLogo('lab-vllm', 'Lab')).toBe('vllm')
    expect(providerLogo('custom', 'Azure OpenAI')).toBe('azure')
    expect(providerLogo('local', 'LM Studio')).toBe('lmstudio')
    expect(providerLogo('foxai', 'Fox AI')).toBeNull()
    expect(providerInitial('  together')).toBe('T')
  })

  it('bundles every logo it names, and nothing else', () => {
    const files = readdirSync(folder).filter(f => f.endsWith('.svg'))
    const names = new Set(files.map(f => f.replace(/(\.mono)?\.svg$/, '')))
    for (const logo of new Set([...Object.values(BY_SLUG), ...BY_WORD.map(([, logo]) => logo)])) expect(names.has(logo), logo).toBe(true)
    expect(names.size).toBe(43)
    expect(existsSync(`${folder}/LICENSE.txt`)).toBe(true)
  })
})
