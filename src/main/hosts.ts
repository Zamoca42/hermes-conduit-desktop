/** The signed-in hosts, kept in memory and handed whole to `persist` on every change. */
import type { ConnectionStore, SavedConnection } from './connection'

export function createHostList(persist: (hosts: SavedConnection[], active: string | null) => void, initial: { hosts: SavedConnection[]; active: string | null }) {
  let hosts = initial.hosts
  let active = initial.active && hosts.some(h => h.url === initial.active) ? initial.active : (hosts[0]?.url ?? null)
  const write = () => persist(hosts, active)
  const store: ConnectionStore = {
    load: () => hosts.find(h => h.url === active) ?? null,
    save(connection) {
      const at = hosts.findIndex(h => h.url === connection.url)
      // A sign-in again keeps the host in the combined group.
      const kept = at >= 0 && connection.combined === undefined && hosts[at]!.combined ? { ...connection, combined: true } : connection
      hosts = at >= 0 ? hosts.map((h, i) => (i === at ? kept : h)) : [...hosts, kept]
      active = connection.url
      write()
    },
    clear() {
      hosts = hosts.filter(h => h.url !== active)
      active = hosts[0]?.url ?? null
      write()
    },
    list: () => hosts.map(h => ({ url: h.url, method: h.method, username: h.username, ...(h.combined ? { combined: true } : {}) })),
    get: url => hosts.find(h => h.url === url) ?? null,
    update(connection) {
      const at = hosts.findIndex(h => h.url === connection.url)
      if (at < 0) return
      hosts = hosts.map((h, i) => (i === at ? { ...connection, combined: connection.combined ?? h.combined } : h))
      write()
    },
    setCombined(url, on) {
      if (!hosts.some(h => h.url === url)) return
      hosts = hosts.map(h => (h.url === url ? { ...h, combined: on || undefined } : h))
      write()
    },
    activate(url) {
      if (!hosts.some(h => h.url === url)) return false
      active = url
      write()
      return true
    },
    replace(from, connection) {
      const at = hosts.findIndex(h => h.url === from)
      if (at < 0) return store.save(connection)
      const moved = { ...connection, combined: connection.combined ?? hosts[at]!.combined }
      // Never two entries for one address: another one saved there was refused before this.
      hosts = hosts.filter((h, i) => i === at || h.url !== connection.url).map(h => (h.url === from ? moved : h))
      active = connection.url
      write()
    },
    remove(url) {
      hosts = hosts.filter(h => h.url !== url)
      if (active === url) active = hosts[0]?.url ?? null
      write()
    }
  }
  return store
}

