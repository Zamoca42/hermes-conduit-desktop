/**
 * The bots in the order the person sets on Bots Home, after the phone's
 * BotOrder: a portrait dragged in place, or moved from its menu. Hermes
 * keeps whether a bot is pinned, not where it sits, so the order is kept
 * here per host by profile name (matched in any case) and goes to the
 * host's synced preferences as `bots.order`, which a phone with Sync across
 * devices on reads and writes too. Until it's set the bots follow Hermes'
 * order; a bot it doesn't name yet goes at the end, and a hidden or deleted
 * one keeps its name for when it's back. Pinned bots show first, each group
 * in the person's order.
 *
 * In a combined group, Bots Home mixes every dashboard's bots in one order
 * the person arranges (the phone's CombinedBotsHomeOrder), by host and bot,
 * kept on this computer only. Until it's arranged, each dashboard's bots
 * follow in Saved Dashboards order, so a switch moves nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bot } from './bots'
import { installationId, PREFS_PATH } from './pinnedOrder'

export const BOTS_SYNC_KEY = 'bots.order'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Names without blanks or repeats (in any case), as the phone keeps them. */
export function cleanOrder(names: unknown): string[] {
  if (!Array.isArray(names)) return []
  const seen = new Set<string>()
  return names.filter((n): n is string => typeof n === 'string' && !!n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
}

/** `bots` in `order`: the ones it names as it names them, then the rest as they came. */
export function arrange<T>(bots: readonly T[], order: readonly string[], name: (bot: T) => string): T[] {
  if (!order.length) return [...bots]
  const place = new Map(order.map((n, i) => [n.toLowerCase(), i]))
  return bots
    .map((bot, i) => ({ bot, rank: place.get(name(bot).toLowerCase()) ?? order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map(r => r.bot)
}

/** The roster as Bots Home shows it: in the person's order, pinned bots first. */
export function orderedBots(bots: readonly Bot[], order: readonly string[]): Bot[] {
  const arranged = arrange(bots, order, b => b.name)
  return [...arranged.filter(b => b.pinned), ...arranged.filter(b => !b.pinned)]
}

/** The order with every shown name in it, the ones it doesn't name yet after it. */
function filled(order: readonly string[], shown: readonly string[]): string[] {
  return [...order, ...shown.filter(s => !order.some(n => same(n, s)))]
}

function movingBefore(order: readonly string[], moved: string, target: string | null, shown: readonly string[]): string[] {
  if (target && same(moved, target)) return [...order]
  const full = filled(order, shown).filter(n => !same(n, moved))
  const at = target ? full.findIndex(n => same(n, target)) : -1
  if (at >= 0) full.splice(at, 0, moved)
  else {
    const last = [...shown].reverse().find(s => !same(s, moved))
    const after = last ? full.findIndex(n => same(n, last)) : -1
    if (after >= 0) full.splice(after + 1, 0, moved)
    else full.push(moved)
  }
  return cleanOrder(full)
}

/**
 * The order after `moved` is dropped on `target` (null: past the last one),
 * whose place it takes as an app does on the Home Screen: carried on, it
 * goes after the one it lands on; carried back, before it. So neighbours
 * swap. Names the order holds that aren't shown keep their places.
 */
export function dropping(order: readonly string[], moved: string, target: string | null, shown: readonly string[]): string[] {
  const from = shown.findIndex(s => same(s, moved))
  const to = target ? shown.findIndex(s => same(s, target)) : -1
  if (!target || from < 0 || to < 0 || from >= to) return movingBefore(order, moved, target, shown)
  const full = filled(order, shown).filter(n => !same(n, moved))
  const at = full.findIndex(n => same(n, target))
  if (at < 0) return movingBefore(order, moved, null, shown)
  full.splice(at + 1, 0, moved)
  return cleanOrder(full)
}

/** The bot `step` places from `name` among `shown` (Move Earlier is -1), or null at either end. */
export function neighbour(shown: readonly string[], name: string, step: -1 | 1): string | null {
  const at = shown.findIndex(s => same(s, name))
  if (at < 0) return null
  return shown[at + step] ?? null
}

/** The host's synced `bots.order`, or null when it keeps none. */
export function hostBotOrder(response: unknown): string[] | null {
  const values = (response as { values?: Record<string, { value?: unknown }> } | null)?.values
  const value = values?.[BOTS_SYNC_KEY]?.value
  return Array.isArray(value) ? cleanOrder(value) : null
}

const storageKey = (host: string) => `conduit.botOrder.${host}`

export function loadBotOrder(host: string): string[] {
  try {
    return cleanOrder(JSON.parse(localStorage.getItem(storageKey(host)) ?? '[]'))
  } catch {
    return []
  }
}

function saveBotOrder(host: string, order: string[]): void {
  try {
    if (order.length) localStorage.setItem(storageKey(host), JSON.stringify(order))
    else localStorage.removeItem(storageKey(host))
  } catch {
    // Kept for this window only.
  }
}

type Http = (method: 'GET' | 'PUT', path: string, body?: unknown) => Promise<unknown>

/**
 * This host's order: read from this computer, then the host's synced copy
 * once per connection, which wins (the phone's merge is replace). A move
 * saves here and sends the order to the host; a host without the route
 * keeps it here. The roster is the gateway's, so the main profile's copy
 * holds it.
 */
export function useBotOrder(host: string, connected: boolean, http: Http) {
  const [order, setOrder] = useState<string[]>(() => loadBotOrder(host))
  const asked = useRef('')
  useEffect(() => {
    setOrder(loadBotOrder(host))
    asked.current = ''
  }, [host])
  useEffect(() => {
    if (!host || !connected || asked.current === host) return
    asked.current = host
    let live = true
    http('GET', PREFS_PATH).then(
      response => {
        const names = hostBotOrder(response)
        if (!live || !names) return
        setOrder(current => {
          if (current.length === names.length && current.every((n, i) => n === names[i])) return current
          saveBotOrder(host, names)
          return names
        })
      },
      () => undefined
    )
    return () => {
      live = false
    }
  }, [host, connected, http])
  /** A portrait dropped on `target` (null: past the last one), among the bots `shown` in their order. */
  const drop = useCallback(
    (moved: string, target: string | null, shown: string[]) => {
      const next = dropping(order, moved, target, shown)
      if (next.length === order.length && next.every((n, i) => n === order[i])) return
      setOrder(next)
      saveBotOrder(host, next)
      void http('PUT', PREFS_PATH, {
        installation_id: installationId(),
        device: 'Conduit for desktop',
        changes: { [BOTS_SYNC_KEY]: next }
      }).catch(() => undefined)
    },
    [order, host, http]
  )
  return { order, drop }
}

// The combined group's mixed order.

/** A mixed grid's key: the host and the bot's name in lowercase. */
export const mixedBotKey = (host: string, name: string) => `${host}\u001f${name.toLowerCase()}`

export interface MixedTile {
  key: string
  /** The host the bot is on. */
  host: string
  bot: Bot
  /** This dashboard's own bot, not another's. */
  own: boolean
}

/**
 * Every dashboard's bots as the mixed grid shows them: the saved order's
 * first, as it names them, then the rest in Saved Dashboards order (the
 * dashboard on screen's in its own order), so a switch moves nothing.
 */
export function mixedTiles(
  ownHost: string,
  own: readonly Bot[],
  others: readonly { host: string; bot: Bot }[],
  savedHosts: readonly string[],
  saved: readonly string[]
): MixedTile[] {
  const hosts = [...savedHosts.filter(h => h === ownHost || others.some(o => o.host === h))]
  if (!hosts.includes(ownHost)) hosts.unshift(ownHost)
  for (const o of others) if (!hosts.includes(o.host)) hosts.push(o.host)
  const tiles: MixedTile[] = []
  for (const host of hosts) {
    if (host === ownHost) tiles.push(...own.map(bot => ({ key: mixedBotKey(host, bot.name), host, bot, own: true })))
    else tiles.push(...others.filter(o => o.host === host).map(o => ({ key: mixedBotKey(host, o.bot.name), host, bot: o.bot, own: false })))
  }
  const place = new Map(saved.map((k, i) => [k, i]))
  const known = tiles.filter(t => place.has(t.key)).sort((a, b) => place.get(a.key)! - place.get(b.key)!)
  return [...known, ...tiles.filter(t => !place.has(t.key))]
}

/**
 * The mixed order after `dragged` is dropped on `target` (null: at the
 * end), taking its place as on the Home Screen. Every shown key gets a
 * place first, and a host no longer shown leaves the order.
 */
export function droppingMixed(saved: readonly string[], dragged: string, target: string | null, shown: readonly string[]): string[] {
  const hosts = new Set(shown.map(k => k.split('\u001f')[0]))
  const kept = saved.filter(k => hosts.has(k.split('\u001f')[0]))
  const order = [...kept, ...shown.filter(k => !kept.includes(k))]
  if (dragged === target) return order
  const from = order.indexOf(dragged)
  const to = target ? order.indexOf(target) : -1
  const carriedOn = from >= 0 && to >= 0 && from < to
  const next = order.filter(k => k !== dragged)
  const at = target ? next.indexOf(target) : -1
  if (at >= 0) next.splice(carriedOn ? at + 1 : at, 0, dragged)
  else next.push(dragged)
  return next
}

const MIXED_KEY = 'conduit.combinedBotsOrder'

export function loadMixedOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MIXED_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && k.includes('\u001f')) : []
  } catch {
    return []
  }
}

export function saveMixedOrder(order: readonly string[]): void {
  try {
    if (order.length) localStorage.setItem(MIXED_KEY, JSON.stringify(order))
    else localStorage.removeItem(MIXED_KEY)
  } catch {
    // Kept for this window only.
  }
}

/**
 * The group's mixed order, kept on this computer. A group that falls to
 * one dashboard forgets it, as the phone's does (`grouped` false).
 */
export function useMixedBotOrder(grouped: boolean | null) {
  const [order, setOrder] = useState<string[]>(loadMixedOrder)
  useEffect(() => {
    // Null while the saved dashboards are still being read.
    if (grouped !== false || !order.length) return
    setOrder([])
    saveMixedOrder([])
  }, [grouped, order.length])
  const drop = useCallback((dragged: string, target: string | null, shown: string[]) => {
    setOrder(current => {
      const next = droppingMixed(current, dragged, target, shown)
      saveMixedOrder(next)
      return next
    })
  }, [])
  return { order, drop }
}
