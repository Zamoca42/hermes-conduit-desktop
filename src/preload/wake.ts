/**
 * The wake listener window's preload: only its model, its phrases and what
 * it reports. That page allows eval for the speech engine's worker, so it
 * gets nothing else of Conduit's.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// IPC's wake channels, written out: a sandboxed preload can't load a chunk it would share with the main one (test/wakeChannels.test.ts).
const IPC = { wakeModelBytes: 'conduit:wake-model-bytes', wakePhrases: 'conduit:wake-phrases', wakeReport: 'conduit:wake-report' }

export type WakeReport = { kind: 'heard'; index: number } | { kind: 'listening' } | { kind: 'failed'; error: string }

contextBridge.exposeInMainWorld('wakeHost', {
  model: (): Promise<ArrayBuffer> => ipcRenderer.invoke(IPC.wakeModelBytes),
  onPhrases: (listener: (phrases: string[]) => void) => {
    const handler = (_event: IpcRendererEvent, phrases: string[]) => listener(phrases)
    ipcRenderer.on(IPC.wakePhrases, handler)
    return () => ipcRenderer.removeListener(IPC.wakePhrases, handler)
  },
  report: (report: WakeReport) => ipcRenderer.send(IPC.wakeReport, report)
})
