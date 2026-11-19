/**
 * The page a launch opens on, after the phone's: the first tab its layout
 * shows (Settings > Appearance > Tabs, synced as `app.tabs`), which is Bots
 * until someone reorders the tabs (The chat Conduit opens on, #2378). The
 * desktop has no tab bar of its own, so it reads the phone's layout, kept on
 * this computer per dashboard for the next launch.
 */
export type LaunchPage = 'bots' | 'chats' | 'tasks' | 'pulse' | 'artifacts' | 'settings'

export const TABS_SYNC_KEY = 'app.tabs'
const KEY = 'conduit.launchTab.v1'
const STANDARD: LaunchPage[] = ['bots', 'chats', 'tasks', 'settings']
const OPTIONAL: LaunchPage[] = ['pulse', 'artifacts']
const ALWAYS_SHOWN: LaunchPage[] = ['chats', 'settings']
const KNOWN = new Set<string>([...STANDARD, ...OPTIONAL])

/** The first tab the phone's stored layout shows ("-name" is hidden; Sessions and Settings can't be). */
export function firstTab(stored: unknown): LaunchPage {
  const order: LaunchPage[] = []
  const hidden = new Set<LaunchPage>()
  for (const token of Array.isArray(stored) ? stored : []) {
    if (typeof token !== 'string') continue
    const isHidden = token.startsWith('-')
    const name = isHidden ? token.slice(1) : token
    if (!KNOWN.has(name) || order.includes(name as LaunchPage)) continue
    order.push(name as LaunchPage)
    if (isHidden && !ALWAYS_SHOWN.includes(name as LaunchPage)) hidden.add(name as LaunchPage)
  }
  for (const tab of STANDARD) if (!order.includes(tab)) order.push(tab)
  for (const tab of OPTIONAL) if (!order.includes(tab)) hidden.add(tab)
  return order.find(tab => !hidden.has(tab)) ?? 'bots'
}

/** The synced `app.tabs` in a prefs answer, or undefined when the host keeps none. */
export function syncedTabs(response: unknown): unknown {
  return (response as { values?: Record<string, { value?: unknown }> } | null)?.values?.[TABS_SYNC_KEY]?.value
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** The page this dashboard's launch opens on: the kept layout's first tab, else Bots. */
export function launchPage(host: string, storage: Storage = localStorage): LaunchPage {
  try {
    return firstTab(JSON.parse(storage.getItem(`${KEY}.${host}`) ?? 'null'))
  } catch {
    return 'bots'
  }
}

/** Keeps the layout the host synced, for this dashboard's next launch. */
export function keepTabs(host: string, stored: unknown, storage: Storage = localStorage): void {
  if (!host || !Array.isArray(stored)) return
  try {
    storage.setItem(`${KEY}.${host}`, JSON.stringify(stored.filter(token => typeof token === 'string')))
  } catch {
    // The next connection tries again.
  }
}
