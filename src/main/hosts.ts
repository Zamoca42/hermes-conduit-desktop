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
      hosts = at >= 0 ? hosts.map((h, i) => (i === at ? connection : h)) : [...hosts, connection]
      active = connection.url
      write()
    },
    clear() {
      hosts = hosts.filter(h => h.url !== active)
      active = hosts[0]?.url ?? null
      write()
    },
    list: () => hosts.map(h => ({ url: h.url, method: h.method, username: h.username })),
    activate(url) {
      if (!hosts.some(h => h.url === url)) return false
      active = url
      write()
      return true
    },
    remove(url) {
      hosts = hosts.filter(h => h.url !== url)
      if (active === url) active = hosts[0]?.url ?? null
      write()
    }
  }
  return store
}

