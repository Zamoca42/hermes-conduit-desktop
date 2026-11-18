import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type ConduitApi,
  type ConnectionStatus,
  type GatewayEventMessage,
  type LiveSocketEvent,
  type MenuAction,
  type OpenChatRequest,
  type PairEvent,
  type PendingRequest,
  type Platform,
  type RpcOutcome
} from '../shared/ipc'

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

const api: ConduitApi = {
  platform: process.platform as Platform,
  language: ipcRenderer.sendSync(IPC.language) as ConduitApi['language'],
  setLanguage: choice => ipcRenderer.send(IPC.setLanguage, choice),
  theme: ipcRenderer.sendSync(IPC.theme) as ConduitApi['theme'],
  setTheme: choice => ipcRenderer.send(IPC.setTheme, choice),
  probe: (url, headers) => ipcRenderer.invoke(IPC.probe, url, headers),
  signIn: request => ipcRenderer.invoke(IPC.signIn, request),
  signOut: () => ipcRenderer.invoke(IPC.signOut),
  switchHost: (url: string) => ipcRenderer.invoke(IPC.switchHost, url),
  removeHost: (url: string) => ipcRenderer.invoke(IPC.removeHost, url),
  status: () => ipcRenderer.invoke(IPC.status),
  reconnect: () => ipcRenderer.invoke(IPC.reconnect),
  async rpc<T>(method: string, params?: Record<string, unknown>) {
    const outcome = (await ipcRenderer.invoke(IPC.rpc, method, params)) as RpcOutcome<T>
    if (!outcome.ok) throw new RpcError(outcome.error, outcome.code)
    return outcome.result
  },
  async http<T>(method: string, path: string, body?: unknown) {
    const outcome = (await ipcRenderer.invoke(IPC.http, method, path, body)) as RpcOutcome<T>
    if (!outcome.ok) throw new RpcError(outcome.error, outcome.code)
    return outcome.result
  },
  rpcOutcome: (method, params) => ipcRenderer.invoke(IPC.rpc, method, params),
  httpOutcome: (method, path, body, timeoutMs) => ipcRenderer.invoke(IPC.http, method, path, body, timeoutMs),
  pluginRelease: () => ipcRenderer.invoke(IPC.pluginRelease),
  liveOpen: (path, query) => ipcRenderer.invoke(IPC.liveOpen, path, query),
  liveOpenMinted: path => ipcRenderer.invoke(IPC.liveOpenMinted, path),
  pageUrl: html => ipcRenderer.invoke(IPC.pageUrl, html),
  liveSend: (id, text) => ipcRenderer.send(IPC.liveSend, id, text),
  liveClose: (id, code) => ipcRenderer.send(IPC.liveClose, id, code),
  onLive: listener => listen<LiveSocketEvent>(IPC.liveEvent, listener),
  pairStart: () => ipcRenderer.invoke(IPC.pairStart),
  pairConfirm: () => ipcRenderer.invoke(IPC.pairConfirm),
  pairCancel: () => ipcRenderer.invoke(IPC.pairCancel),
  onPair: listener => listen<PairEvent>(IPC.pairEvent, listener),
  onStatus: listener => listen<ConnectionStatus>(IPC.statusChanged, listener),
  onEvent: listener => listen<GatewayEventMessage>(IPC.event, listener),
  requests: () => ipcRenderer.invoke(IPC.requests),
  onRequests: listener => listen<PendingRequest[]>(IPC.requestsChanged, listener),
  answerRequest: (id, result) => ipcRenderer.invoke(IPC.answerRequest, id, result),
  dismissRequest: id => ipcRenderer.invoke(IPC.dismissRequest, id),
  setWaiting: count => ipcRenderer.send(IPC.setWaiting, count),
  openChat: chat => ipcRenderer.send(IPC.openChat, chat),
  onOpenChat: listener => listen<OpenChatRequest>(IPC.openChat, listener),
  hideQuickAsk: () => ipcRenderer.send(IPC.hideQuickAsk),
  copyText: text => ipcRenderer.send(IPC.copyText, text),
  setQuickAskExpanded: expanded => ipcRenderer.send(IPC.quickAskExpanded, expanded),
  onQuickAskShown: listener => listen<void>(IPC.quickAskShown, () => listener()),
  quickAskShortcut: () => ipcRenderer.invoke(IPC.quickAskShortcut),
  onMenu: listener => listen<MenuAction>(IPC.menu, listener),
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    show: () => ipcRenderer.send(IPC.windowShow)
  }
}

contextBridge.exposeInMainWorld('conduit', api)
