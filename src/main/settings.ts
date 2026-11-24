/**
 * The app's own settings, in the data folder beside connection.json. For
 * now that's the language ("system" follows the computer's, or one of
 * Conduit's languages), the theme ("system", dark or light) and the lock.
 */
import { app, nativeTheme } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from './atomicWrite'
import { join } from 'node:path'
import { LANGUAGES, pickLanguage, setLanguage, type Language } from '../shared/i18n'
import type { AppIconChoice, LanguageChoice, ThemeChoice } from '../shared/ipc'

const path = () => join(app.getPath('userData'), 'settings.json')

function read(): { language?: unknown; theme?: unknown; lock?: unknown; askHost?: unknown; appIcon?: unknown; launchAtLogin?: unknown } {
  try {
    return JSON.parse(readFileSync(path(), 'utf8')) as { language?: unknown; theme?: unknown; lock?: unknown; askHost?: unknown }
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
    writeFileAtomic(path(), JSON.stringify({ ...read(), language: valid }, null, 2))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  const language = resolvedLanguage(valid)
  setLanguage(language)
  return language
}

const THEMES: readonly ThemeChoice[] = ['system', 'dark', 'light']

/** Settings > Appearance > App icon, as on the phone: the dark icon (the default) or the light one. */
export function appIconChoice(): AppIconChoice {
  return read().appIcon === 'light' ? 'light' : 'dark'
}

export function chooseAppIcon(choice: AppIconChoice): AppIconChoice {
  const valid: AppIconChoice = choice === 'light' ? 'light' : 'dark'
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), appIcon: valid }, null, 2))
  } catch {
    // Not saved: it still applies until Conduit quits.
  }
  return valid
}

export function themeChoice(): ThemeChoice {
  const stored = read().theme
  return THEMES.includes(stored as ThemeChoice) ? (stored as ThemeChoice) : 'system'
}

/** Saves the choice and gives it to Chromium, so the window's `prefers-color-scheme` and Electron's own UI follow it. */
export function chooseTheme(choice: ThemeChoice = themeChoice(), save = true): ThemeChoice {
  const valid: ThemeChoice = THEMES.includes(choice) ? choice : 'system'
  if (save) {
    try {
      writeFileAtomic(path(), JSON.stringify({ ...read(), theme: valid }, null, 2))
    } catch {
      // Not saved: it still applies until Conduit quits.
    }
  }
  nativeTheme.themeSource = valid
  return valid
}

/** Whether Conduit asks for Touch ID or Windows Hello before it opens the saved hosts. */
export const lockOnLaunch = (): boolean => read().lock === true

export function chooseLock(on: boolean): boolean {
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), lock: on }, null, 2))
    return true
  } catch {
    return false
  }
}

/** Ask Which Dashboard at Launch: with two or more hosts saved, a launch lists them instead of opening the last one. */
export const askHostAtLaunch = (): boolean => read().askHost === true

export function chooseAskHost(on: boolean): boolean {
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), askHost: on }, null, 2))
    return true
  } catch {
    return false
  }
}

/** `--hidden`: the login item starts Conduit in the tray, without its window. */
export const HIDDEN_FLAG = '--hidden'

/** Whether the OS can hold a login item for this app: an installed build on macOS or Windows. */
export const canLaunchAtLogin = (): boolean => app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')

/** Settings > Appearance > Launch at login, as saved here. */
export const launchAtLogin = (): boolean => read().launchAtLogin === true

/**
 * The login item Windows holds for this app: the Run entry names the exe and
 * `--hidden`, so the OS reports the entry as on only when both are asked for.
 */
const loginItemQuery = (): Electron.LoginItemSettingsOptions => (process.platform === 'win32' ? { path: process.execPath, args: [HIDDEN_FLAG] } : {})

/** What the OS itself says, so a login item removed outside Conduit turns the switch off too. */
export function loginItemOn(): boolean {
  if (!canLaunchAtLogin()) return false
  try {
    return app.getLoginItemSettings(loginItemQuery()).openAtLogin
  } catch {
    return false
  }
}

/** Registers or removes the OS login item: the Mac's at sign-in, Windows' Run entry with --hidden. */
export function applyLoginItem(on: boolean): boolean {
  if (!canLaunchAtLogin()) return false
  try {
    const query = loginItemQuery()
    app.setLoginItemSettings({ openAtLogin: on, ...query })
    return app.getLoginItemSettings(query).openAtLogin === on
  } catch {
    return false
  }
}

/** Saves the switch and gives it to the OS; true when the OS took it. */
export function chooseLaunchAtLogin(on: boolean): boolean {
  if (!canLaunchAtLogin()) return false
  try {
    writeFileAtomic(path(), JSON.stringify({ ...read(), launchAtLogin: on }, null, 2))
  } catch {
    // Not saved: the login item still changes until Conduit quits.
  }
  return applyLoginItem(on)
}

/**
 * At every launch: a login item the user asked for here but removed outside
 * Conduit is put back (a moved app drops the Windows Run entry's path), while
 * one added outside Conduit is kept — the switch reads the OS, not this file.
 */
export function syncLoginItem(): void {
  if (!canLaunchAtLogin() || !launchAtLogin() || loginItemOn()) return
  applyLoginItem(true)
}

/** A launch the OS started at sign-in keeps to the tray; the tray or a second launch shows the window. */
export function startedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true
  if (process.platform !== 'darwin') return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true
  } catch {
    return false
  }
}
