/**
 * Conduit in the tray (the Mac's menu bar): it keeps running with its window
 * closed, so Needs you and finished turns still notify. Closing the window
 * hides it; Quit (the tray's, the Mac's ⌘Q) ends the app.
 */
import { Menu, Tray, app, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { MenuAction } from '../shared/ipc'
import { t } from '../shared/i18n'

export interface TrayDeps {
  window: () => BrowserWindow | null
  showWindow: () => void
  command: (action: MenuAction) => void
  quit: () => void
  quickAsk: () => void
}

export function trayIconPath(file: string): string {
  // Packaged: electron-builder's extraResources; in development: the repo's resources/.
  return app.isPackaged ? join(process.resourcesPath, file) : join(__dirname, '../../resources', file)
}

/** The tooltip, and the menu's first line: how many things wait on the user. */
export function trayLabel(waiting: number): string {
  if (waiting <= 0) return 'Conduit'
  return waiting === 1 ? t('Conduit · 1 thing needs you') : t('Conduit · {count} things need you', { count: waiting })
}

export class ConduitTray {
  private tray: Tray | null = null
  private waiting = 0

  constructor(private readonly deps: TrayDeps) {}

  create(): void {
    const mac = process.platform === 'darwin'
    const image = nativeImage.createFromPath(trayIconPath(mac ? 'trayTemplate.png' : 'tray.png'))
    if (mac) image.setTemplateImage(true)
    this.tray = new Tray(image)
    // A click opens the window on Windows and Linux; the Mac shows the menu, as menu bar items do.
    this.tray.on('click', () => {
      if (!mac) this.deps.showWindow()
    })
    this.render()
  }

  setWaiting(count: number): void {
    if (count === this.waiting) return
    this.waiting = count
    this.render()
    // The Mac's Dock and Linux launchers show it as a badge.
    app.setBadgeCount(count)
  }

  /** Builds the menu again, in a new language. */
  refresh(): void {
    this.render()
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private render(): void {
    if (!this.tray) return
    const label = trayLabel(this.waiting)
    this.tray.setToolTip(label)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label, enabled: false },
        { type: 'separator' },
        { label: t('Open Conduit'), click: () => this.deps.showWindow() },
        {
          label: t('New Chat'),
          click: () => {
            this.deps.showWindow()
            this.deps.command('new-chat')
          }
        },
        { label: t('Quick Ask'), accelerator: 'Alt+Space', click: () => this.deps.quickAsk() },
        {
          label: t('Needs You'),
          enabled: this.waiting > 0,
          click: () => {
            this.deps.showWindow()
            this.deps.command('needs-you')
          }
        },
        { type: 'separator' },
        { label: t('Quit Conduit'), click: () => this.deps.quit() }
      ])
    )
  }
}
