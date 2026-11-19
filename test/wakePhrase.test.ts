import { describe, expect, it } from 'vitest'
import { isUsableWakePhrase, matchWakePhrase, wakeTokens } from '../src/shared/wakePhrase'

describe('wake phrases', () => {
  it('needs two words, or two characters without spaces', () => {
    expect(isUsableWakePhrase('hermes')).toBe(false)
    expect(isUsableWakePhrase('hey hermes')).toBe(true)
    expect(isUsableWakePhrase('你')).toBe(false)
    expect(isUsableWakePhrase('你好')).toBe(true)
    expect(isUsableWakePhrase('  ')).toBe(false)
  })

  it('folds case, accents and punctuation', () => {
    expect(wakeTokens('Héy, HERMES!')).toEqual(['hey', 'hermes'])
  })

  it('matches a phrase running through what was said, word for word', () => {
    expect(matchWakePhrase('okay hey hermes what time is it', ['hey hermes'])).toBe(0)
    expect(matchWakePhrase('hey there hermes', ['hey hermes'])).toBe(-1)
    expect(matchWakePhrase('heyhermes', ['hey hermes'])).toBe(-1)
  })

  it('picks the most specific phrase', () => {
    expect(matchWakePhrase('hey fam work please', ['hey fam', 'hey fam work'])).toBe(1)
    expect(matchWakePhrase('hey fam please', ['hey fam', 'hey fam work'])).toBe(0)
  })

  it('matches unspaced scripts as a run of characters', () => {
    expect(matchWakePhrase('你 好 小 助手', ['你好'])).toBe(0)
    expect(matchWakePhrase('안녕 하세요', ['안녕하세요'])).toBe(0)
  })

  it('ignores phrases of one word', () => {
    expect(matchWakePhrase('hermes', ['hermes'])).toBe(-1)
  })
})
