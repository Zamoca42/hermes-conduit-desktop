/**
 * Edit Connection moving a host to a new address: what this computer keeps
 * for a host (pins, chat order, marks, quick picks…) is keyed by its address,
 * so it moves with it. The keys go first, before the sign-in at the new
 * address opens its window; a sign-in that fails takes the copies back, and
 * one that works drops the old keys and renames the address inside the values
 * that hold several hosts (the launch's last host, ledgers by host).
 */

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

const keys = (storage: Storage): string[] => {
  const all: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null) all.push(key)
  }
  return all
}

/** A key that belongs to `host`: it ends with the address, or the address starts a draft-style `host\0…` part. */
const hostKeyed = (key: string, host: string) => key.endsWith(`.${host}`) || key === host || key.includes(`${host}\u0000`)

const movedKey = (key: string, from: string, to: string) =>
  key.endsWith(`.${from}`) ? key.slice(0, key.length - from.length) + to : key === from ? to : key.split(`${from}\u0000`).join(`${to}\u0000`)

/** Copies `from`'s own keys to `to`'s, leaving any `to` already has. Returns the keys written, for `undoHostCopy`. */
export function copyHostData(from: string, to: string, storage: Storage = localStorage): string[] {
  if (from === to) return []
  const written: string[] = []
  try {
    for (const key of keys(storage)) {
      if (!hostKeyed(key, from)) continue
      const target = movedKey(key, from, to)
      if (target === key || storage.getItem(target) !== null) continue
      const value = storage.getItem(key)
      if (value === null) continue
      storage.setItem(target, value)
      written.push(target)
    }
  } catch {
    // Storage full or blocked: the host starts fresh at its new address.
  }
  return written
}

/** The sign-in at the new address failed: the copies go. */
export function undoHostCopy(written: string[], storage: Storage = localStorage): void {
  for (const key of written) {
    try {
      storage.removeItem(key)
    } catch {
      // Nothing more to do.
    }
  }
}

/** The host now lives at `to`: its old keys go, and values naming it by address name the new one. */
export function finishHostMove(from: string, to: string, storage: Storage = localStorage): void {
  if (from === to) return
  const quoted = JSON.stringify(from).slice(0, -1)
  const quotedTo = JSON.stringify(to).slice(0, -1)
  try {
    for (const key of keys(storage)) {
      if (hostKeyed(key, from)) {
        storage.removeItem(key)
        continue
      }
      const value = storage.getItem(key)
      if (value === null) continue
      if (value === from) {
        storage.setItem(key, to)
        continue
      }
      // Only whole addresses inside JSON strings: `"https://a"` or `"https://a\u0000…`, never `"https://a:8443"`.
      if (!value.includes(quoted)) continue
      const next = value.split(`${quoted}"`).join(`${quotedTo}"`).split(`${quoted}\\u0000`).join(`${quotedTo}\\u0000`)
      if (next !== value) storage.setItem(key, next)
    }
  } catch {
    // Storage blocked: what's left keeps the old address and is never read again.
  }
}
