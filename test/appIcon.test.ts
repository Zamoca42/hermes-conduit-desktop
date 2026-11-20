import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

const { appIconFile } = await import('../src/main/appIcon')
const { trayFile } = await import('../src/main/tray')

describe('the app icon choice', () => {
  it('picks the packaged icon for each choice, with the Mac its inset version', () => {
    expect(appIconFile('dark', 'win32')).toBe('app-icon-dark.png')
    expect(appIconFile('light', 'win32')).toBe('app-icon-light.png')
    expect(appIconFile('light', 'darwin')).toBe('app-icon-light-mac.png')
  })

  it('gives the Windows tray the same icon', () => {
    expect(trayFile('dark')).toBe('tray.png')
    expect(trayFile('light')).toBe('tray-light.png')
  })
})
