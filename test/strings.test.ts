import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import catalog from '../src/shared/strings.json'
import { LANGUAGES, pickLanguage, setLanguage, t } from '../src/shared/i18n'

const strings = catalog as Record<string, Record<string, string>>

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'vendor' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

/** Every t('…') key in the code, with where it is. */
function keysInCode(): Map<string, string> {
  const keys = new Map<string, string>()
  const call = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g
  for (const file of sources(join(__dirname, '../src'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(call)) {
      if (match[1] === '`' && match[2]!.includes('${')) throw new Error(`${file}: t() takes a fixed key, with {placeholders}: ${match[2]}`)
      keys.set(match[2]!.replace(/\\(['"`\\])/g, '$1'), file)
    }
  }
  return keys
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('strings', () => {
  it('has every key in every language, with the same placeholders', () => {
    const missing: string[] = []
    for (const [key, file] of keysInCode()) {
      const entry = strings[key]
      for (const language of LANGUAGES.filter(l => l !== 'en')) {
        const value = entry?.[language]
        if (!value) missing.push(`${language}: ${JSON.stringify(key)} (${file})`)
        else expect(placeholders(value), `${language}: ${key}`).toEqual(placeholders(key))
      }
    }
    expect(missing).toEqual([])
  })

  it('keeps no key the code no longer uses', () => {
    const used = keysInCode()
    expect(Object.keys(strings).filter(key => !used.has(key))).toEqual([])
  })

  it('picks the language for a locale', () => {
    expect(pickLanguage('de-AT')).toBe('de')
    expect(pickLanguage('zh-TW')).toBe('zh-Hant')
    expect(pickLanguage('zh-CN')).toBe('zh-Hans')
    expect(pickLanguage('zh-Hant-HK')).toBe('zh-Hant')
    expect(pickLanguage('pt-PT')).toBe('pt-BR')
    expect(pickLanguage('nl-NL')).toBe('en')
    expect(pickLanguage(undefined)).toBe('en')
  })

  it('fills placeholders, and falls back to English', () => {
    setLanguage('de')
    expect(t('A key nobody translated {x}', { x: 1 })).toBe('A key nobody translated 1')
    setLanguage('en')
  })
})
