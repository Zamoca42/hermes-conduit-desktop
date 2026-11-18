/**
 * The app's own settings, in the data folder beside connection.json. For
 * now that's the language: "system" follows the computer's, or one of
 * Conduit's languages.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANGUAGES, pickLanguage, setLanguage, type Language } from '../shared/i18n'
import type { LanguageChoice } from '../shared/ipc'

const path = () => join(app.getPath('userData'), 'settings.json')

function read(): { language?: unknown } {
  try {
    return JSON.parse(readFileSync(path(), 'utf8')) as { language?: unknown }
  } catch {
    return {}
  }
}

export function languageChoice(): LanguageChoice {
  const stored = read().language
  return typeof stored === 'string' && (LANGUAGES as readonly string[]).includes(stored) ? (stored as Language) : 'system'
}

/** The language Conduit speaks: the chosen one, else the computer's. */
export function resolvedLanguage(choice = languageChoice()): Language {
  return choice === 'system' ? pickLanguage(app.getPreferredSystemLanguages()[0] ?? app.getLocale()) : choice
}

/** Saves the choice and switches the main process (tray, menus, errors) to it. */
export function chooseLanguage(choice: LanguageChoice): Language {
  const valid: LanguageChoice = choice === 'system' || (LANGUAGES as readonly string[]).includes(choice) ? choice : 'system'
  try {
    writeFileSync(path(), JSON.stringify({ ...read(), language: valid }, null, 2))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  const language = resolvedLanguage(valid)
  setLanguage(language)
  return language
}
