import type { ConduitApi } from '../shared/ipc'

declare global {
  interface Window {
    conduit: ConduitApi
  }
}

export {}
