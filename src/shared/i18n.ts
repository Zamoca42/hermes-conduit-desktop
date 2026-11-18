/**
 * Conduit's words in the person's language: the same thirteen languages the
 * iPhone app ships, with the iPhone app's own translations wherever the
 * desktop says the same thing (scripts/import-ios-strings.mjs copies them
 * in). The English text is the key; a word with no translation stays English.
 *
 *   t('Sign in')                         → "Anmelden"
 *   t('Sign out of {host}', { host })    → "Von {host} abmelden", filled in
 *
 * `test/strings.test.ts` checks that every t() key in the code has every
 * language, with the same {placeholders}.
 */
import catalog from './strings.json'

export const LANGUAGES = ['en', 'de', 'es', 'fr', 'id', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant'] as const
export type Language = (typeof LANGUAGES)[number]

/** Each language in its own words, for Settings' list. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  pl: 'Polski',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  tr: 'Türkçe',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文'
}

const strings = catalog as Record<string, Partial<Record<Language, string>>>
let current: Language = 'en'

/** The language Conduit speaks for a system locale ("de-AT", "zh-TW", "pt-PT"), English when it has none of it. */
export function pickLanguage(locale: string | undefined): Language {
  const tag = (locale ?? '').replace('_', '-').toLowerCase()
  if (!tag) return 'en'
  if (tag.startsWith('zh')) {
    return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-Hant' : 'zh-Hans'
  }
  if (tag.startsWith('pt')) return 'pt-BR'
  const base = tag.split('-')[0]
  return (LANGUAGES as readonly string[]).find(l => l.toLowerCase() === base) as Language | undefined ?? 'en'
}

export function setLanguage(language: Language): void {
  current = language
}

export function language(): Language {
  return current
}

/** `key` in the current language, with each {name} filled from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = current === 'en' ? key : (strings[key]?.[current] ?? key)
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}
