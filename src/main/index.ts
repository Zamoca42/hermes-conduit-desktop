import { BrowserWindow, Menu, app, ipcMain, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import WebSocket from 'ws'
import { IPC, type GatewayEventMessage, type MenuAction, type RpcOutcome, type SignInRequest } from '../shared/ipc'
import { probeHost } from './auth'
import { Connection } from './connection'
import { createFileStore } from './store'
import type { WebSocketLike } from '../vendor/hermes-shared/json-rpc-gateway'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null

function send(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

const connection = new Connection({
  fetch: globalThis.fetch.bind(globalThis),
  store: createFileStore(),
  // Browsers' WebSocket can't set headers; `ws` can, and has the same shape.
  createSocket: (url, headers) => new WebSocket(url, { headers }) as unknown as WebSocketLike,
  onStatus: status => send(IPC.statusChanged, status),
  onEvent: (event: GatewayEventMessage) => send(IPC.event, event)
})

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Conduit',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f5f7',
    // Our own title bar: traffic lights stay on the Mac, Windows gets drawn caption buttons.
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow = window
  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  // Links open in the browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  if (process.platform === 'darwin') Menu.setApplicationMenu(macMenu())
  ipcMain.handle(IPC.probe, (_event, url: string) => probeHost(url, globalThis.fetch.bind(globalThis)))
  ipcMain.handle(IPC.signIn, (_event, request: SignInRequest) => connection.signIn(request))
  ipcMain.handle(IPC.signOut, () => connection.signOut())
  ipcMain.handle(IPC.status, () => connection.current())
  ipcMain.handle(IPC.reconnect, () => connection.reconnectNow())
  ipcMain.handle(IPC.rpc, async (_event, method: string, params?: Record<string, unknown>): Promise<RpcOutcome> => {
    try {
      return { ok: true, result: await connection.rpc(method, params ?? {}) }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: typeof code === 'number' ? code : undefined }
    }
  })
  ipcMain.handle(IPC.http, async (_event, method: string, path: string, body?: unknown): Promise<RpcOutcome> => {
    try {
      return { ok: true, result: await connection.http(method, path, body) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.on(IPC.windowMinimize, event => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.on(IPC.windowToggleMaximize, event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IPC.windowClose, event => BrowserWindow.fromWebContents(event.sender)?.close())
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.setAppUserModelId('dev.conduit.desktop')
  void app.whenReady().then(() => {
    registerIpc()
    createWindow()
    void connection.restore()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}

/**
 * The Mac's menu bar: the standard app, Edit, View and Window menus, and
 * File > New Chat on ⌘N. Windows has no menu bar (the title bar is ours),
 * so the window takes Ctrl+N itself there.
 */
function macMenu(): Menu {
  const command = (action: MenuAction) => () => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (target && !target.isDestroyed()) target.webContents.send(IPC.menu, action)
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { label: 'File', submenu: [{ label: 'New Chat', accelerator: 'Cmd+N', click: command('new-chat') }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  return Menu.buildFromTemplate(template)
}
