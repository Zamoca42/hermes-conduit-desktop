import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  flags: { packaged: true, openAtLogin: false, calls: [] as unknown[] },
  dir: ''
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return hoisted.flags.packaged
    },
    getPath: () => hoisted.dir,
    setLoginItemSettings: (settings: { openAtLogin?: boolean }) => {
      hoisted.flags.calls.push(settings)
      if (typeof settings.openAtLogin === 'boolean') hoisted.flags.openAtLogin = settings.openAtLogin
    },
    getLoginItemSettings: () => ({ openAtLogin: hoisted.flags.openAtLogin }),
    getPreferredSystemLanguages: () => ['en'],
    getLocale: () => 'en',
    getVersion: () => '1.0.0'
  },
  nativeTheme: { themeSource: 'system' }
}))

const { HIDDEN_FLAG, applyLoginItem, canLaunchAtLogin, chooseLaunchAtLogin, launchAtLogin, loginItemOn, syncLoginItem } = await import(
  '../src/main/settings'
)

hoisted.dir = mkdtempSync(join(tmpdir(), 'conduit-login-item-'))
const settingsFile = join(hoisted.dir, 'settings.json')

beforeEach(() => {
  hoisted.flags.calls.length = 0
  hoisted.flags.openAtLogin = false
  hoisted.flags.packaged = true
  rmSync(settingsFile, { force: true })
})

afterAll(() => rmSync(hoisted.dir, { recursive: true, force: true }))

describe('launch at login', () => {
  it('keeps to the OS, and does nothing in a run from source', () => {
    hoisted.flags.packaged = false
    expect(canLaunchAtLogin()).toBe(false)
    expect(chooseLaunchAtLogin(true)).toBe(false)
    expect(applyLoginItem(true)).toBe(false)
    expect(hoisted.flags.calls).toEqual([])
  })

  it('saves the switch and registers the login item with --hidden on Windows', () => {
    const plat = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      expect(chooseLaunchAtLogin(true)).toBe(true)
      expect(launchAtLogin()).toBe(true)
      expect(loginItemOn()).toBe(true)
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ launchAtLogin: true })
      expect(hoisted.flags.calls[0]).toMatchObject({ openAtLogin: true, args: [HIDDEN_FLAG] })
      expect(loginItemOn()).toBe(true)
      expect(chooseLaunchAtLogin(false)).toBe(true)
      expect(launchAtLogin()).toBe(false)
      expect(loginItemOn()).toBe(false)
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({ launchAtLogin: false })
    } finally {
      Object.defineProperty(process, 'platform', plat)
    }
  })

  it('puts back a login item removed outside Conduit', () => {
    hoisted.flags.packaged = true
    chooseLaunchAtLogin(true)
    hoisted.flags.calls.length = 0
    // Removed outside Conduit: the OS says off, the file still says on.
    hoisted.flags.openAtLogin = false
    syncLoginItem()
    expect(hoisted.flags.calls).toHaveLength(1)
    expect(loginItemOn()).toBe(true)
    // An item added outside Conduit is kept, and no write follows.
    hoisted.flags.calls.length = 0
    syncLoginItem()
    expect(hoisted.flags.calls).toHaveLength(0)
  })
})
