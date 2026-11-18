/**
 * Keeps the signed-in dashboard between launches, in the app's data folder.
 * The password, token and cookies are encrypted with the system keychain
 * (Keychain on the Mac, DPAPI on Windows) through Electron's safeStorage.
 * Where that isn't available they're kept for this launch only.
 */
import { app, safeStorage } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionStore, SavedConnection } from './connection'

interface StoredFile {
  version: 1
  url: string
  method: SavedConnection['method']
  username?: string
  /** base64 of safeStorage-encrypted JSON `{ password?, token?, cookies? }`. */
  secrets?: string
}

export function createFileStore(): ConnectionStore {
  const path = join(app.getPath('userData'), 'connection.json')
  let memory: SavedConnection | null = null

  return {
    load() {
      if (memory) return memory
      let stored: StoredFile
      try {
        stored = JSON.parse(readFileSync(path, 'utf8')) as StoredFile
      } catch {
        return null
      }
      if (stored.version !== 1 || typeof stored.url !== 'string') return null
      const saved: SavedConnection = { url: stored.url, method: stored.method, username: stored.username }
      if (stored.secrets && safeStorage.isEncryptionAvailable()) {
        try {
          const secrets = JSON.parse(safeStorage.decryptString(Buffer.from(stored.secrets, 'base64'))) as Partial<SavedConnection>
          saved.password = secrets.password
          saved.token = secrets.token
          saved.cookies = secrets.cookies
        } catch {
          // Encrypted by another user or machine: sign in again.
          return null
        }
      } else if (stored.method !== 'open') {
        return null
      }
      memory = saved
      return saved
    },
    save(connection) {
      memory = connection
      const stored: StoredFile = { version: 1, url: connection.url, method: connection.method, username: connection.username }
      if (connection.method !== 'open') {
        if (!safeStorage.isEncryptionAvailable()) return
        const secrets = { password: connection.password, token: connection.token, cookies: connection.cookies }
        stored.secrets = safeStorage.encryptString(JSON.stringify(secrets)).toString('base64')
      }
      writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 })
    },
    clear() {
      memory = null
      rmSync(path, { force: true })
    }
  }
}
