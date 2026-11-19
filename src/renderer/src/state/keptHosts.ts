/**
 * Combined dashboards in the window (the phone's SavedDashboardsView's
 * Combine Dashboards, CombinedDashboardBadge and AppState+NeedsYou's other
 * dashboards): how each host kept beside the open one is doing, its badge
 * (the first letter of its name on its color), and Needs you's waits read
 * through its connection, which open by switching to it.
 */
import { useEffect, useRef, useState } from 'react'
import type { HostSummary, KeptHost, KeptHostState } from '../../../shared/ipc'
import { t } from '../../../shared/i18n'
import { WAITING_POLL_MS, waitingFromResponse, waitingPath, type WaitingRow } from './needsYou'

export const keptStateLabel = (state: KeptHostState): string =>
  state === 'live'
    ? t('Connected in the background')
    : state === 'connecting'
      ? t('Connecting…')
      : state === 'down'
        ? t("Can't connect. Trying again.")
        : t('Sign In required')

/** One per place in the group, dark enough for white text (CombinedDashboardBadge.palette). */
export const BADGE_PALETTE = ['#3373d9', '#bf4d8c', '#268c66', '#cc6b1a', '#7359cc', '#8c7333']
const PALETTE_HUES = [0.603, 0.907, 0.438, 0.076, 0.704, 0.119]

/** Past the palette, the middle of the widest gap left between the hues taken, darker for yellows and greens. */
export function badgeColor(index: number): string {
  if (index < BADGE_PALETTE.length) return BADGE_PALETTE[Math.max(index, 0)]!
  const taken = [...PALETTE_HUES]
  let hue = 0
  for (let i = BADGE_PALETTE.length; i <= index; i++) {
    const sorted = [...taken].sort((a, b) => a - b)
    let best = { gap: 0, middle: 0 }
    sorted.forEach((start, at) => {
      const end = at + 1 < sorted.length ? sorted[at + 1]! : sorted[0]! + 1
      if (end - start > best.gap) best = { gap: end - start, middle: (start + (end - start) / 2) % 1 }
    })
    hue = best.middle
    taken.push(hue)
  }
  const light = hue > 0.1 && hue < 0.45
  // HSB(hue, 0.70, b) as HSL.
  const b = light ? 0.48 : 0.62
  const l = b * (1 - 0.7 / 2)
  const s = l === 0 || l === 1 ? 0 : (b - l) / Math.min(l, 1 - l)
  return `hsl(${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`
}

export interface HostBadge {
  letter: string
  color: string
  name: string
}

/** A combined host's badge: its place among the group in the saved order. Only the group has badges. */
export function hostBadge(hosts: readonly HostSummary[], url: string, name: (url: string) => string): HostBadge | null {
  const group = hosts.filter(h => h.combined)
  const index = group.findIndex(h => h.url === url)
  if (group.length < 2 || index < 0) return null
  const label = name(url).trim()
  return { letter: (Array.from(label)[0] ?? '?').toUpperCase(), color: badgeColor(index), name: label }
}

/** The hosts kept beside the open one, as the main process says. */
export function useKeptHosts(): KeptHost[] {
  const [hosts, setHosts] = useState<KeptHost[]>([])
  useEffect(() => {
    const off = window.conduit.onKeptHosts(setHosts)
    void window.conduit.keptHosts().then(setHosts)
    return off
  }, [])
  return hosts
}

/** A wait from another combined host. */
export type KeptWaitingRow = WaitingRow & { host: string }

/** Hermes always has `default`; an empty list is a degraded reply (null). */
export function profileNames(body: unknown): string[] | null {
  const list = body && typeof body === 'object' ? (body as { profiles?: unknown }).profiles : undefined
  if (!Array.isArray(list)) return null
  const names = list
    .map(value => (typeof value === 'string' ? value : value && typeof value === 'object' ? (value as { name?: unknown }).name : null))
    .filter((name): name is string => typeof name === 'string' && !!name)
  if (!names.length) return null
  return names.includes('default') ? names : ['default', ...names]
}

/** A kept host's profiles are read again after this, so one made or deleted there shows. */
export const KEPT_PROFILES_MAX_AGE_MS = 5 * 60_000

/**
 * Every live kept host's waits, for each of its profiles, on Needs you's
 * 20 s poll while the window is on screen. A profile whose read fails keeps
 * what it showed; a host let go shows nothing more.
 */
export function useKeptWaiting(kept: readonly KeptHost[]): KeptWaitingRow[] {
  const [rows, setRows] = useState<KeptWaitingRow[]>([])
  const profiles = useRef(new Map<string, { names: string[]; at: number }>())
  const byHost = useRef(new Map<string, Map<string, KeptWaitingRow[]>>())
  const live = kept
    .filter(h => h.state === 'live')
    .map(h => h.url)
    .join('\n')

  useEffect(() => {
    const urls = live ? live.split('\n') : []
    for (const url of [...byHost.current.keys()]) if (!urls.includes(url)) byHost.current.delete(url)
    for (const url of [...profiles.current.keys()]) if (!urls.includes(url)) profiles.current.delete(url)
    const show = () => setRows([...byHost.current.values()].flatMap(m => [...m.values()].flat()).sort((a, b) => b.at - a.at))
    show()
    if (!urls.length) return
    let stopped = false
    const readHost = async (url: string) => {
      const last = profiles.current.get(url)
      let names = last?.names
      if (!last || Date.now() - last.at > KEPT_PROFILES_MAX_AGE_MS) {
        const outcome = await window.conduit.keptHttp(url, '/api/profiles')
        const read = outcome.ok ? profileNames(outcome.result) : null
        if (read) profiles.current.set(url, { names: read, at: Date.now() })
        names = read ?? names
      }
      if (stopped || !names) return
      const host = byHost.current.get(url) ?? new Map<string, KeptWaitingRow[]>()
      await Promise.all(
        names.map(async name => {
          const outcome = await window.conduit.keptHttp(url, waitingPath(name === 'default' ? undefined : name))
          if (!outcome.ok) return
          host.set(
            name,
            waitingFromResponse(outcome.result, name === 'default' ? undefined : name).map(row => ({ ...row, host: url }))
          )
        })
      )
      for (const name of [...host.keys()]) if (!names.includes(name)) host.delete(name)
      if (!stopped && urls.includes(url)) byHost.current.set(url, host)
    }
    const read = async () => {
      if (document.hidden) return
      await Promise.all(urls.map(readHost))
      if (!stopped) show()
    }
    void read()
    const timer = setInterval(() => void read(), WAITING_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) void read()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [live])

  return rows
}

/** Another host's waits not also listed here: one Hermes saved at two addresses shows a wait once, as this host's. */
export const otherHostsWaiting = (kept: readonly KeptWaitingRow[], here: readonly WaitingRow[]): KeptWaitingRow[] => {
  const ids = new Set(here.map(r => r.id))
  const seen = new Set<string>()
  return kept.filter(r => !ids.has(r.id) && !seen.has(r.id) && !!seen.add(r.id))
}

/** A wait opened from another host: the switch remounts the window, and the new host's window takes it. */
let pending: { host: string; row: WaitingRow } | null = null

export function openAfterSwitch(row: KeptWaitingRow): void {
  const { host, ...rest } = row
  pending = { host, row: rest }
}

export function takeOpenAfterSwitch(host: string): WaitingRow | null {
  if (!pending || pending.host !== host) return null
  const row = pending.row
  pending = null
  return row
}
