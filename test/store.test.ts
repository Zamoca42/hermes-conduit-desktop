import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dir: '', ready: false }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    // As on Windows: nothing decrypts until the app is ready.
    isEncryptionAvailable: () => state.ready,
    encryptString: (text: string) => Buffer.from(`enc:${text}`),
    decryptString: (data: Buffer) => {
      const text = data.toString()
      if (!state.ready || !text.startsWith('enc:')) throw new Error('not available')
      return text.slice(4)
    }
  }
}))

const { createFileStore } = await import('../src/main/store')
const secrets = (value: object) => Buffer.from(`enc:${JSON.stringify(value)}`).toString('base64')

describe('the saved hosts file', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'conduit-store-'))
    state.ready = false
  })

  it('made before the app is ready, still opens the sign-in an earlier build saved', () => {
    writeFileSync(join(state.dir, 'connection.json'), JSON.stringify({ version: 1, url: 'http://h:9119', method: 'password', username: 'admin', secrets: secrets({ password: 'pw' }) }))
    const store = createFileStore()
    state.ready = true
    expect(store.load()).toMatchObject({ url: 'http://h:9119', method: 'password', username: 'admin', password: 'pw' })
    expect(store.list!()).toEqual([{ url: 'http://h:9119', method: 'password', username: 'admin' }])
  })

  it('writes a list of hosts and reads it back', () => {
    state.ready = true
    const store = createFileStore()
    store.save({ url: 'http://one', method: 'token', token: 'a' })
    store.save({ url: 'http://two', method: 'open' })
    store.activate!('http://one')
    const file = JSON.parse(readFileSync(join(state.dir, 'connection.json'), 'utf8'))
    expect(file).toMatchObject({ version: 2, active: 'http://one', hosts: [{ url: 'http://one', method: 'token' }, { url: 'http://two', method: 'open' }] })
    expect(JSON.stringify(file)).not.toContain('"a"')
    const again = createFileStore()
    expect(again.load()).toMatchObject({ url: 'http://one', token: 'a' })
    expect(again.list!().map(h => h.url)).toEqual(['http://one', 'http://two'])
  })
})
