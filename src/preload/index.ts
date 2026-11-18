import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ConduitApi, type ConnectionStatus, type GatewayEventMessage, type MenuAction, type OpenChatRequest, type PendingRequest, type Platform, type RpcOutcome } from '../shared/ipc'

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

class RpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message)
    this.name = 'RpcError'
  }
}

const api: ConduitApi = {
  platform: process.platform as Platform,
  probe: url => ipcRenderer.invoke(IPC.probe, url),
  signIn: request => ipcRenderer.invoke(IPC.signIn, request),
  signOut: () => ipcRenderer.invoke(IPC.signOut),
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
