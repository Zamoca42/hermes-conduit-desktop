/**
 * Quick ask: Alt+Space (Option+Space on the Mac) from anywhere opens a small
 * window over everything to ask Hermes one thing. It hides again on Esc or
 * when it loses focus; the chat it started opens in the main window on
 * request.
 */
import { BrowserWindow, globalShortcut, screen, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'

export const QUICK_ASK_ACCELERATOR = 'Alt+Space'

const WIDTH = 680
/** Just the field, so nothing invisible sits over other apps; a reply grows it. */
const FIELD_HEIGHT = 128
const HEIGHT = 460

export class QuickAsk {
  private window: BrowserWindow | null = null
  private expanded = false
  registered = false

  register(): void {
    try {
      this.registered = globalShortcut.register(QUICK_ASK_ACCELERATOR, () => this.toggle())
    } catch {
      this.registered = false
    }
  }

  unregister(): void {
    if (this.registered) globalShortcut.unregister(QUICK_ASK_ACCELERATOR)
    this.registered = false
  }

  toggle(): void {
    const window = this.ensure()
    if (window.isVisible() && window.isFocused()) {
      window.hide()
      return
    }
    this.place(window)
    window.show()
    window.focus()
    window.webContents.send(IPC.quickAskShown)
  }

  setExpanded(expanded: boolean): void {
    const window = this.window
    if (!window || window.isDestroyed() || expanded === this.expanded) return
    this.expanded = expanded
    const bounds = window.getBounds()
    const height = expanded ? HEIGHT : FIELD_HEIGHT
    // Grow upward from where the field sits, so the field doesn't jump.
    window.setBounds({ ...bounds, y: bounds.y + bounds.height - height, height })
  }

  hide(): void {
    this.window?.hide()
  }

  destroy(): void {
    this.window?.destroy()
    this.window = null
  }

  /** On the display the pointer is on, a third of the way down. */
  private place(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const area = display.workArea
    const height = this.expanded ? HEIGHT : FIELD_HEIGHT
    window.setBounds({
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + area.height / 4 + HEIGHT - height),
      width: WIDTH,
      height
    })
  }

  private ensure(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const window = new BrowserWindow({
      width: WIDTH,
      height: FIELD_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      roundedCorners: true,
      title: t('Quick ask'),
      backgroundColor: '#00000000',
      transparent: process.platform !== 'linux',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })
    window.setAlwaysOnTop(true, 'floating')
    window.on('blur', () => {
      if (!window.webContents.isDevToolsOpened()) window.hide()
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    if (process.env.ELECTRON_RENDERER_URL) {
      void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#quick`)
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'quick' })
    }
    this.window = window
    return window
  }
}
