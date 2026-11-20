/**
 * The page a launch opens on, after the phone's: the first tab its layout
 * shows (Settings > Appearance > Tabs, synced as `app.tabs`), which is Bots
 * until someone reorders the tabs (The chat Conduit opens on, #2378). The
 * desktop has no tab bar of its own: Settings > Appearance > Open on moves a
 * page to the front of that same layout, so it works with no phone at all, and
 * a phone signed in to the dashboard opens on it too. Kept on this computer
 * per dashboard for the next launch.
 */
export type LaunchPage = 'bots' | 'chats' | 'tasks' | 'pulse' | 'artifacts' | 'settings'

export const TABS_SYNC_KEY = 'app.tabs'
const KEY = 'conduit.launchTab.v1'
const STANDARD: LaunchPage[] = ['bots', 'chats', 'tasks', 'settings']
const OPTIONAL: LaunchPage[] = ['pulse', 'artifacts']
const ALWAYS_SHOWN: LaunchPage[] = ['chats', 'settings']
const KNOWN = new Set<string>([...STANDARD, ...OPTIONAL])
/** The most tabs the phone's bar shows. */
const MOST_SHOWN = 5
/** The pages Open on offers, in the phone's order. */
export const LAUNCH_CHOICES: LaunchPage[] = ['bots', 'chats', 'tasks', 'pulse', 'artifacts']

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

/**
 * The layout with `page` first and shown, every other tab (and any name a newer
 * Conduit wrote) where it was. Past the five tabs the phone's bar holds, the
 * last shown ones are hidden, as the phone does, never Sessions or Settings.
 */
export function withFirstTab(stored: unknown, page: LaunchPage): string[] {
  const tokens = (Array.isArray(stored) ? stored : []).filter((token): token is string => typeof token === 'string')
  const nameOf = (token: string) => (token.startsWith('-') ? token.slice(1) : token)
  const rest = tokens.filter(token => nameOf(token) !== page)
  const named = new Set(rest.map(nameOf))
  // A list that leaves tabs out has them where the phone reads them: the standard ones shown after, the optional ones hidden before Settings.
  for (const tab of STANDARD) if (tab !== page && !named.has(tab)) rest.push(tab)
  for (const tab of OPTIONAL) {
    if (tab === page || named.has(tab)) continue
    const settings = rest.indexOf('settings')
    rest.splice(settings === rest.length - 1 ? settings : rest.length, 0, `-${tab}`)
  }
  const out = [page, ...rest]
  const seen = new Set<string>()
  let shown = 0
  for (const token of out) {
    const name = nameOf(token)
    if (!KNOWN.has(name) || seen.has(name)) continue
    seen.add(name)
    if (!token.startsWith('-') || ALWAYS_SHOWN.includes(name as LaunchPage)) shown++
  }
  for (let i = out.length - 1; i > 0 && shown > MOST_SHOWN; i--) {
    const token = out[i]!
    if (token.startsWith('-') || !KNOWN.has(token) || ALWAYS_SHOWN.includes(token as LaunchPage)) continue
    out[i] = `-${token}`
    shown--
  }
  return out
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** The layout kept for this dashboard, or undefined when none was synced or picked. */
export function keptTabs(host: string, storage: Storage = localStorage): unknown {
  try {
    return JSON.parse(storage.getItem(`${KEY}.${host}`) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}

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
