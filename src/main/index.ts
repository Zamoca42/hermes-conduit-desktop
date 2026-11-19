import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'node:path'
import WebSocket from 'ws'
import {
  IPC,
  type GatewayEventMessage,
  type LanguageChoice,
  type MenuAction,
  type OpenChatRequest,
  type RpcOutcome,
  type SignInRequest,
  type ThemeChoice
} from '../shared/ipc'
import { probeHost } from './auth'
import { isPageUrl, pageUrl, registerPageScheme, servePages } from './pages'
import { pluginRelease } from './pluginRelease'
import { cleanHeaders } from './proxyHeaders'
import { Connection, DISPLAY_SOCKET_PATH } from './connection'
import { Pairing } from './pairing'
import { createFileStore } from './store'
import { QUICK_ASK_ACCELERATOR, QuickAsk } from './quickAsk'
import { ConduitTray } from './tray'
import { chooseLanguage, chooseLock, chooseTheme, languageChoice, lockOnLaunch, resolvedLanguage, themeChoice } from './settings'
import { lockKind, promptUnlock } from './appLock'
import { declineDeviceReports, deviceReports, sendDeviceReports, watchDeviceReports, watchWindowFreezes } from './deviceReports'
import type { WebSocketLike } from '../vendor/hermes-shared/json-rpc-gateway'
import { jsonRpcErrorReason } from '../vendor/hermes-shared/json-rpc-channel'
import { LIVE_TOKEN_PATHS, mintedSocket, type LiveSocketEvent } from '../shared/ipc'
import { setLanguage, t } from '../shared/i18n'
import { STALLED_CLOSE_CODE, STALLED_REASON, liveSendDecision } from './liveBacklog'

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

const pairing = new Pairing({
  fetch: globalThis.fetch.bind(globalThis),
  mailbox: process.env.CONDUIT_PAIR_MAILBOX || undefined,
  onEvent: event => send(IPC.pairEvent, event),
  signIn: request => connection.signIn(request),
  switchHost: url => connection.switchHost(url)
})

let unlocking: Promise<boolean> | null = null

/** Touch ID or Windows Hello, then the saved hosts open; one prompt at a time. */
function unlock(): Promise<boolean> {
  if (!connection.isLocked) return Promise.resolve(true)
  unlocking ??= promptUnlock(t('open your Hermes sign-ins'))
    .then(async given => {
      if (given) await connection.unlocked()
      return given
    })
    .finally(() => (unlocking = null))
  return unlocking
}

/** At launch: the host open last time, after the lock when it's on and the computer still offers it. */
async function openSavedHosts(): Promise<void> {
  if (lockOnLaunch() && connection.hosts().length && (await lockKind())) {
    connection.lock()
    void unlock()
    return
  }
  await connection.restore()
}

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
  watchWindowFreezes(window)
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
    // Web pages, and a Pulse card's mail, phone and message links; Maps and Calendar links on a Mac.
    if (/^(https?:\/\/|mailto:|tel:|sms:)/i.test(url) || (isMac && /^(maps:|calshow:|x-apple-reminderkit:)/i.test(url))) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A page Hermes drew stays in its frame: a link it follows opens in the browser.
  window.webContents.on('will-frame-navigate', event => {
    if (event.isMainFrame || isPageUrl(event.url)) return
    event.preventDefault()
    if (/^https?:\/\//.test(event.url)) void shell.openExternal(event.url)
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
  // Elsewhere Electron's default menu would take Ctrl+0 and Ctrl+Plus for zoom: the window reads them for the chat's text size.
  Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null)
  ipcMain.handle(IPC.requests, () => connection.requests())
  ipcMain.on(IPC.setWaiting, (_event, count: number) => tray.setWaiting(Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0))
  ipcMain.on(IPC.windowShow, () => showWindow())
  ipcMain.on(IPC.language, event => {
    const choice = languageChoice()
    event.returnValue = { choice, resolved: resolvedLanguage(choice) }
  })
  ipcMain.on(IPC.setLanguage, (_event, choice: LanguageChoice) => {
    chooseLanguage(choice)
    if (isMac) Menu.setApplicationMenu(macMenu())
    tray.refresh()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.reload()
    }
  })
  ipcMain.on(IPC.theme, event => {
    event.returnValue = themeChoice()
  })
  ipcMain.on(IPC.setTheme, (_event, choice: ThemeChoice) => {
    chooseTheme(choice)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0b0d12' : '#f5f5f7')
    }
  })
  ipcMain.handle(IPC.appLock, async () => ({ kind: await lockKind(), on: lockOnLaunch() }))
  const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  ipcMain.handle(IPC.deviceReports, () => deviceReports())
  ipcMain.handle(IPC.sendDeviceReports, (_event, value: unknown) => sendDeviceReports(ids(value)))
  ipcMain.handle(IPC.declineDeviceReports, (_event, value: unknown) => declineDeviceReports(ids(value)))
  ipcMain.handle(IPC.setAppLock, async (_event, on: unknown) => {
    if (typeof on !== 'boolean' || !(await lockKind())) return false
    if (!(await promptUnlock(on ? t('turn on the lock for your Hermes sign-ins') : t('turn off the lock for your Hermes sign-ins')))) return false
    return chooseLock(on)
  })
  ipcMain.handle(IPC.unlock, () => unlock())
  ipcMain.on(IPC.openChat, (_event, chat: OpenChatRequest) => {
    quickAsk.hide()
    showWindow()
    mainWindow?.webContents.send(IPC.openChat, chat)
  })
  ipcMain.on(IPC.hideQuickAsk, () => quickAsk.hide())
  ipcMain.on(IPC.copyText, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.on(IPC.quickAskExpanded, (_event, expanded: unknown) => quickAsk.setExpanded(typeof expanded === 'number' ? expanded : expanded === true))
  ipcMain.handle(IPC.quickAskShortcut, () => ({ accelerator: QUICK_ASK_ACCELERATOR, registered: quickAsk.registered }))
  ipcMain.handle(IPC.answerRequest, (_event, id: string, result: Record<string, unknown>) => connection.answerRequest(id, result))
  ipcMain.handle(IPC.dismissRequest, (_event, id: string) => connection.dropRequest(id))
  ipcMain.handle(IPC.probe, (_event, url: string, headers?: Record<string, string>) => {
    const cleaned = cleanHeaders(headers)
    if (!cleaned.ok) return { ok: false, error: cleaned.error }
    return probeHost(url, globalThis.fetch.bind(globalThis), cleaned.headers)
  })
  ipcMain.handle(IPC.signIn, (_event, request: SignInRequest) => connection.signIn(request))
  ipcMain.handle(IPC.signOut, () => connection.signOut())
  ipcMain.handle(IPC.pairStart, () => pairing.start())
  ipcMain.handle(IPC.pairConfirm, () => pairing.confirm())
  ipcMain.handle(IPC.pairCancel, () => pairing.cancel())
  ipcMain.handle(IPC.switchHost, (_e, url: unknown) => typeof url === 'string' && connection.switchHost(url))
  ipcMain.handle(IPC.removeHost, (_e, url: unknown) => {
    if (typeof url === 'string') connection.removeHost(url)
  })
  ipcMain.handle(IPC.status, () => connection.current())
  ipcMain.handle(IPC.reconnect, () => connection.reconnectNow())
  ipcMain.handle(IPC.rpc, async (_event, method: string, params?: Record<string, unknown>): Promise<RpcOutcome> => {
    try {
      return { ok: true, result: await connection.rpc(method, params ?? {}) }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const reason = jsonRpcErrorReason(error)
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: typeof code === 'number' ? code : undefined,
        reason: typeof reason === 'string' ? reason : undefined
      }
    }
  })
  ipcMain.handle(IPC.http, async (_event, method: string, path: string, body?: unknown, timeoutMs?: unknown): Promise<RpcOutcome> => {
    try {
      // A longer wait only for what asks for it (a recording's transcription), never past ten minutes.
      const timeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) ? Math.min(600_000, Math.max(1_000, timeoutMs)) : undefined
      return { ok: true, result: await connection.http(method, path, body, timeout) }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: typeof code === 'number' ? code : undefined }
    }
  })
  ipcMain.handle(IPC.pluginRelease, () => pluginRelease())
  // Live calls' sockets: opened here, where the sign-in and a proxy's headers are (Grok Live's relay),
  // or with a single-use token the host minted that never reaches the window (Gemini Live).
  const liveSockets = new Map<string, WebSocketLike>()
  /** Each live socket's way to end itself when it stops taking frames. */
  const liveStalls = new Map<string, () => void>()
  // The ws library hands over a Buffer, an ArrayBuffer or a list of Buffers.
  const binaryFrame = (data: unknown): Uint8Array =>
    Array.isArray(data)
      ? new Uint8Array(Buffer.concat(data as Buffer[]))
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array((data as Buffer).buffer, (data as Buffer).byteOffset, (data as Buffer).byteLength)
  let liveCount = 0
  const keepLive = (sender: Electron.WebContents, socket: WebSocketLike, binary = false): string => {
    const id = `live-${++liveCount}`
    liveSockets.set(id, socket)
    const report = (payload: LiveSocketEvent) => {
      if (!sender.isDestroyed()) sender.send(IPC.liveEvent, payload)
    }
    socket.onopen = () => report({ id, type: 'open' })
    socket.onmessage = message =>
      report(
        binary && typeof message.data !== 'string'
          ? { id, type: 'binary', data: binaryFrame(message.data) }
          : { id, type: 'message', data: typeof message.data === 'string' ? message.data : String(message.data) }
      )
    socket.onerror = error => report({ id, type: 'error', message: (error as { message?: string }).message ?? 'Socket error' })
    socket.onclose = close => {
      liveSockets.delete(id)
      liveStalls.delete(id)
      report({ id, type: 'close', code: close.code, reason: close.reason })
    }
    // A socket that stopped taking frames: the call hears it closed now, not when a closing handshake gives up.
    liveStalls.set(id, () => {
      socket.onclose = null
      liveSockets.delete(id)
      liveStalls.delete(id)
      socket.close(STALLED_CLOSE_CODE, STALLED_REASON)
      report({ id, type: 'close', code: STALLED_CLOSE_CODE, reason: STALLED_REASON })
    })
    // A window that goes away takes its call with it.
    sender.once('destroyed', () => liveSockets.get(id)?.close())
    return id
  }
  ipcMain.handle(IPC.liveOpen, async (event, path: unknown, query: unknown) => {
    if (typeof path !== 'string') return { ok: false, error: 'No socket path.' }
    const params: Record<string, string> = {}
    if (query && typeof query === 'object') for (const [name, value] of Object.entries(query)) if (typeof value === 'string') params[name] = value
    try {
      return { ok: true, id: keepLive(event.sender, await connection.openSocket(path, params)) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.pageUrl, (_event, html: unknown) => pageUrl(html))
  ipcMain.handle(IPC.screenshot, () => captureScreen())
  ipcMain.handle(IPC.liveOpenMinted, async (event, path: unknown) => {
    if (typeof path !== 'string' || !LIVE_TOKEN_PATHS.some(allowed => path === allowed || path.startsWith(`${allowed}?`)))
      return { ok: false, error: 'Not a live token route.' }
    try {
      const minted = mintedSocket(await connection.http('POST', path, {}, 20_000))
      if (!minted.ok) return minted
      const socket = new WebSocket(minted.url, { maxPayload: 16 * 1024 * 1024, headers: minted.headers }) as unknown as WebSocketLike
      return { ok: true, id: keepLive(event.sender, socket), model: minted.model, voice: minted.voice }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      return { ok: false, error: error instanceof Error ? error.message : String(error), code: typeof code === 'number' ? code : undefined }
    }
  })
  ipcMain.on(IPC.liveSend, (_event, id: unknown, data: unknown) => {
    const socket = typeof id === 'string' ? liveSockets.get(id) : undefined
    if (!socket || socket.readyState !== 1) return
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) return
    // A socket that stopped taking frames: late audio is dropped, and anything else closes it (liveBacklog.ts).
    const decision = liveSendDecision(socket.bufferedAmount, data)
    if (decision === 'drop') return
    if (decision === 'stalled') return liveStalls.get(id as string)?.()
    if (typeof data === 'string') socket.send(data)
    else socket.send(Uint8Array.from(data))
  })
  // A bot's screen: its RFB stream, binary both ways.
  ipcMain.handle(IPC.screenOpen, async (event, path: unknown, ticket: unknown) => {
    if (path !== DISPLAY_SOCKET_PATH || typeof ticket !== 'string' || !ticket) return { ok: false, error: 'Not a screen stream.' }
    try {
      const socket = await connection.openSocket(path, { display_ticket: ticket })
      socket.binaryType = 'arraybuffer'
      return { ok: true, id: keepLive(event.sender, socket, true) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.on(IPC.liveClose, (_event, id: unknown, code: unknown) => {
    const socket = typeof id === 'string' ? liveSockets.get(id) : undefined
    if (!socket) return
    liveSockets.delete(id as string)
    try {
      socket.close(typeof code === 'number' ? code : 1000)
    } catch {
      socket.close()
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
  registerPageScheme()
  void app.whenReady().then(() => {
    servePages()
    setLanguage(resolvedLanguage())
    chooseTheme(themeChoice(), false)
    registerIpc()
    watchDeviceReports(() => send(IPC.deviceReportsChanged, null))
    createWindow()
    tray.create()
    quickAsk.register()
    void openSavedHosts()
    // The Dock icon brings the hidden window back.
    app.on('activate', () => showWindow())
  })
  // The window only hides, so this comes with Quit; Conduit otherwise lives on in the tray.
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })
}

/**
 * The Mac's menu bar, after the phone's: Settings on ⌘,, File > New Chat
 * and Search, View with the chat's text size and ⌘1 to ⌘5, Chat > Stop, and
 * Help > Keyboard Shortcuts on ⌘/. Windows has no menu bar (the title bar
 * is ours), so the window takes Ctrl and the same keys itself there.
 */
function macMenu(): Menu {
  const command = (action: MenuAction) => () => {
    showWindow()
    sendCommand(action)
  }
  const go = [t('Bots'), t('Chats'), t('Tasks'), t('Pulse'), t('Needs you')].map((label, i) => ({
    label,
    accelerator: `Cmd+${i + 1}`,
    click: command(`go-${i + 1}` as MenuAction)
  }))
  const template: MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: t('Settings'), accelerator: 'Cmd+,', click: command('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: t('File'),
      submenu: [
        { label: t('New Chat'), accelerator: 'Cmd+N', click: command('new-chat') },
        { label: t('Search'), accelerator: 'Cmd+F', click: command('search') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: t('View'),
      submenu: [
        { label: t('Make Text Bigger'), accelerator: 'Cmd+Plus', click: command('text-bigger') },
        { label: t('Make Text Smaller'), accelerator: 'Cmd+-', click: command('text-smaller') },
        { label: t('Make Text Normal Size'), accelerator: 'Cmd+0', click: command('text-normal') },
        { type: 'separator' },
        ...go,
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: t('Chat'), submenu: [{ label: t('Stop'), accelerator: 'Cmd+.', click: command('stop') }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: t('Keyboard Shortcuts'), accelerator: 'Cmd+/', click: command('shortcuts') }] }
  ]
  return Menu.buildFromTemplate(template)
}

/**
 * The screen Conduit's window is on, for a call's screenshot (the phone's
 * Ask Hermes About Screen): the window steps aside for the capture, then
 * comes back. Null when the system gives no picture (on a Mac, until Screen
 * Recording is allowed for Conduit).
 */
async function captureScreen(): Promise<string | null> {
  const win = mainWindow
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()
  const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
  const shown = !!win && win.isVisible() && !win.isMinimized()
  try {
    if (shown) {
      win!.hide()
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const source = sources.find(s => s.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    return source.thumbnail.toDataURL()
  } catch {
    return null
  } finally {
    if (shown) win!.show()
  }
}
