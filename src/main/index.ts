import { BrowserWindow, Menu, app, globalShortcut, ipcMain, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import WebSocket from 'ws'
import { IPC, type GatewayEventMessage, type MenuAction, type OpenChatRequest, type RpcOutcome, type SignInRequest } from '../shared/ipc'
import { probeHost } from './auth'
import { Connection } from './connection'
import { createFileStore } from './store'
import { QUICK_ASK_ACCELERATOR, QuickAsk } from './quickAsk'
import { ConduitTray } from './tray'
import type { WebSocketLike } from '../vendor/hermes-shared/json-rpc-gateway'

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | null = null
/** Set by Quit: until then, closing the window only hides it (Conduit stays in the tray). */
let quitting = false

function showWindow(): void {
  if (!mainWindow) createWindow()
  const window = mainWindow
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function sendCommand(action: MenuAction): void {
  const target = mainWindow ?? BrowserWindow.getAllWindows()[0]
  if (target && !target.isDestroyed()) target.webContents.send(IPC.menu, action)
}

const quickAsk = new QuickAsk()

const tray = new ConduitTray({
  quickAsk: () => quickAsk.toggle(),
  window: () => mainWindow,
  showWindow,
  command: sendCommand,
  quit: () => app.quit()
})

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
  onEvent: (event: GatewayEventMessage) => send(IPC.event, event),
  onRequests: requests => send(IPC.requestsChanged, requests)
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
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
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
  ipcMain.handle(IPC.requests, () => connection.requests())
  ipcMain.on(IPC.setWaiting, (_event, count: number) => tray.setWaiting(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0))
  ipcMain.on(IPC.windowShow, () => showWindow())
  ipcMain.on(IPC.openChat, (_event, chat: OpenChatRequest) => {
    quickAsk.hide()
    showWindow()
    mainWindow?.webContents.send(IPC.openChat, chat)
  })
  ipcMain.on(IPC.hideQuickAsk, () => quickAsk.hide())
  ipcMain.on(IPC.quickAskExpanded, (_event, expanded: boolean) => quickAsk.setExpanded(expanded === true))
  ipcMain.handle(IPC.quickAskShortcut, () => ({ accelerator: QUICK_ASK_ACCELERATOR, registered: quickAsk.registered }))
  ipcMain.handle(IPC.answerRequest, (_event, id: string, result: Record<string, unknown>) => connection.answerRequest(id, result))
  ipcMain.handle(IPC.dismissRequest, (_event, id: string) => connection.dropRequest(id))
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
  app.on('second-instance', () => showWindow())
  app.on('before-quit', () => {
    quitting = true
    quickAsk.destroy()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.setAppUserModelId('dev.conduit.desktop')
  void app.whenReady().then(() => {
    registerIpc()
    createWindow()
    tray.create()
    quickAsk.register()
    void connection.restore()
    // The Dock icon brings the hidden window back.
    app.on('activate', () => showWindow())
  })
  // The window only hides, so this comes with Quit; Conduit otherwise lives on in the tray.
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}

/**
 * The Mac's menu bar: the standard app, Edit, View and Window menus, and
 * File > New Chat on ⌘N. Windows has no menu bar (the title bar is ours),
 * so the window takes Ctrl+N itself there.
 */
function macMenu(): Menu {
  const command = (action: MenuAction) => () => {
    showWindow()
    sendCommand(action)
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
