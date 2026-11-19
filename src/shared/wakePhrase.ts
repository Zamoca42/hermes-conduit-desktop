/**
 * The phone's wake phrase rules (Conduit/Voice/Wake/WakePhraseMatcher.swift):
 * a phrase needs two words, or two characters in a script written without
 * spaces (Han, kana, Hangul, Thai); a transcript matches a phrase that runs
 * through it word for word, and the longest phrase wins when several do.
 */

/** Lowercased, accent-folded runs of letters and digits. */
export function wakeTokens(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u

const usesWordSpacing = (words: string[]) => words.every(word => ![...word].some(ch => UNSPACED.test(ch)))

/** A phrase the listener can use: two words at least, or two characters for scripts without spaces. */
export function isUsableWakePhrase(phrase: string): boolean {
  const words = wakeTokens(phrase)
  if (!words.length) return false
  return usesWordSpacing(words) ? words.length >= 2 : [...words.join('')].length >= 2
}

const containsRun = (needle: string[], haystack: string[]) => {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, i) => haystack[start + i] === word)) return true
  }
  return false
}

/** The index of the phrase `transcript` says (the longest when several match), or -1. */
export function matchWakePhrase(transcript: string, phrases: string[]): number {
  const heard = wakeTokens(transcript)
  if (!heard.length) return -1
  const compact = heard.join('')
  let best = -1
  let bestLength = 0
  phrases.forEach((phrase, index) => {
    if (!isUsableWakePhrase(phrase)) return
    const words = wakeTokens(phrase)
    const spaced = usesWordSpacing(words)
    const matched = spaced ? containsRun(words, heard) : compact.includes(words.join(''))
    const length = spaced ? words.length : [...words.join('')].length
    if (matched && length > bestLength) {
      best = index
      bestLength = length
    }
  })
  return best
}
