/**
 * The chat list's "In messages", after the phone's SessionContentSearch:
 * the search field filters the listed chats by title and preview at once,
 * and this asks Hermes' own `GET /api/sessions/search` for chats whose
 * messages hold the words, so a chat that only talked about something is
 * found too. Hermes marks the matched words `>>>like this<<<`. No row says
 * which message matched, so a match opens its chat. A Hermes without the
 * route (404, 405, 410) isn't asked again on that host.
 */
import { useEffect, useState } from 'react'
import { searchQuery } from './chatFinder'
import { isLegacyKanbanWorker, type ChatRow } from './chats'

export const MIN_QUERY = 2
/** Matches shown; Hermes is asked for three times as many, since old Kanban workers pass its source filter and are dropped after. */
export const RESULT_LIMIT = 20
const SEARCH_LIMIT = RESULT_LIMIT * 3
const NOT_CHATS = 'kanban,oneshot,tool'

export interface SnippetRun {
  text: string
  match: boolean
}

export interface ContentHit {
  /** The conversation's live tip, which opens it. */
  sessionId: string
  lineageRoot?: string
  title: string
  snippet: SnippetRun[]
  /** Seconds since the epoch. */
  lastActive?: number
  archived: boolean
  /** The profile it was found in. */
  profile: string
}

export interface ContentRow {
  key: string
  /** The chat to open: the listed row when there is one. */
  row: ChatRow
  snippet: SnippetRun[]
}

/** The words Hermes can search, or null while there's too little to ask about. */
export function searchableQuery(raw: string): string | null {
  const trimmed = raw.trim()
  if ([...trimmed].length < MIN_QUERY) return null
  return searchQuery(trimmed) || null
}

export function contentSearchPath(query: string, profile: string): string {
  const path = `/api/sessions/search?q=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}&exclude_sources=${NOT_CHATS}`
  return profile && profile !== 'default' ? `${path}&profile=${encodeURIComponent(profile)}` : path
}

export const isUnsupported = (code?: number) => code === 404 || code === 405 || code === 410

const oneLine = (raw: string) =>
  raw
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(/^\.\.\./, '…')
    .replace(/\.\.\.$/, '…')

function merged(runs: SnippetRun[]): SnippetRun[] {
  const out: SnippetRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const last = out[out.length - 1]
    if (last && last.match === run.match) last.text += run.text
    else out.push({ ...run })
  }
  return out
}

/** `line` with every case-insensitive occurrence of the query's words as a match. */
function highlighting(line: string, query: string): SnippetRun[] {
  const words = query.split(/\s+/).filter(Boolean)
  if (!line) return []
  if (!words.length) return [{ text: line, match: false }]
  const pattern = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu')
  const runs: SnippetRun[] = []
  let cursor = 0
  for (const found of line.matchAll(pattern)) {
    if (!found[0]) continue
    runs.push({ text: line.slice(cursor, found.index), match: false }, { text: found[0], match: true })
    cursor = found.index! + found[0].length
  }
  runs.push({ text: line.slice(cursor), match: false })
  return merged(runs)
}

/**
 * Hermes' snippet on one line, its marks as matches. A `>>>` with no `<<<`
 * before the next `>>>` is the message's own text. A snippet with no marks
 * (a session-id hit, a short CJK query) gets the query's words marked.
 */
export function parseSnippet(raw: string, query: string): SnippetRun[] {
  const line = oneLine(raw)
  const runs: SnippetRun[] = []
  let rest = line
  let inMatch = false
  while (rest) {
    let at = -1
    if (inMatch) at = rest.indexOf('<<<')
    else {
      let from = 0
      for (;;) {
        const open = rest.indexOf('>>>', from)
        if (open < 0) break
        const close = rest.indexOf('<<<', open + 3)
        if (close < 0) break
        const next = rest.indexOf('>>>', open + 3)
        if (next >= 0 && next < close) {
          from = next
          continue
        }
        at = open
        break
      }
    }
    if (at < 0) {
      runs.push({ text: rest, match: inMatch })
      break
    }
    runs.push({ text: rest.slice(0, at), match: inMatch })
    rest = rest.slice(at + 3)
    inMatch = !inMatch
  }
  if (!runs.some(r => r.match && r.text)) return highlighting(line, query)
  return merged(runs.map(r => ({ ...r, text: r.text.replace(/<<</g, '') })))
}

type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const seconds = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** The response's chats in Hermes' order, each once, the first twenty; null when it isn't a search answer. */
export function hitsFrom(response: unknown, query: string, profile: string): ContentHit[] | null {
  const rows = ((response ?? {}) as Raw).results
  if (!Array.isArray(rows)) return null
  const seen = new Set<string>()
  return rows
    .flatMap((raw): ContentHit[] => {
      const row = (raw ?? {}) as Raw
      const id = (str(row.session_id) || str(row.id)).trim()
      if (!id || seen.has(id) || isLegacyKanbanWorker(str(row.source), str(row.preview))) return []
      seen.add(id)
      const root = str(row.lineage_root).trim()
      return [
        {
          sessionId: id,
          lineageRoot: root || undefined,
          title: str(row.title).trim(),
          snippet: parseSnippet(str(row.snippet), query),
          lastActive: seconds(row.last_active) ?? seconds(row.session_started) ?? seconds(row.started_at),
          archived: row.archived === true,
          profile
        }
      ]
    })
    .slice(0, RESULT_LIMIT)
}

const scoped = (profile: string | undefined, id: string) => `${(profile || 'default').toLowerCase()}\u001f${id}`

/**
 * The matches the list doesn't already show: a hit for a chat among
 * `listed` (the title and preview matches on screen) is left out, as is an
 * archived one. `known` is every chat Conduit has listed, for the title and
 * the row it opens; `allowed`, while a filter is on, keeps only its chats.
 */
export function contentRows(hits: ContentHit[], listed: ChatRow[], known: ChatRow[], allowed?: ChatRow[]): ContentRow[] {
  const listedIds = new Set(listed.map(r => scoped(r.profile, r.id)))
  const knownById = new Map(known.map(r => [scoped(r.profile, r.id), r]))
  const allowedIds = allowed ? new Set(allowed.map(r => scoped(r.profile, r.id))) : null
  const shown = new Set<string>()
  return hits.flatMap((hit): ContentRow[] => {
    const ids = [hit.sessionId, ...(hit.lineageRoot ? [hit.lineageRoot] : [])].map(id => scoped(hit.profile, id))
    if (ids.some(id => listedIds.has(id)) || hit.archived) return []
    if (allowedIds && !ids.some(id => allowedIds.has(id))) return []
    const knownRow = ids.map(id => knownById.get(id)).find(Boolean)
    const row: ChatRow = knownRow ?? {
      id: hit.sessionId,
      title: hit.title,
      profile: hit.profile === 'default' ? undefined : hit.profile,
      pinned: false,
      activeAt: hit.lastActive ? hit.lastActive * 1000 : undefined
    }
    const key = scoped(row.profile, row.id)
    if (shown.has(key)) return []
    shown.add(key)
    return [{ key, row, snippet: hit.snippet }]
  })
}

/** Hosts whose Hermes has no search route: not asked again while Conduit runs. */
const unsupportedHosts = new Set<string>()

/**
 * Follows the search field: debounced, the profiles searched one request
 * each (the one shown first), only the latest query's answer kept. Other
 * failures keep the list's own matches and say nothing.
 */
export function useContentSearch(raw: string, profiles: string[], host: string, http: (path: string) => Promise<unknown>) {
  const [state, setState] = useState<{ hits: ContentHit[]; searching: boolean }>({ hits: [], searching: false })
  const query = searchableQuery(raw)
  const profileKey = profiles.join('\n')
  useEffect(() => {
    if (!query || !profileKey || unsupportedHosts.has(host)) {
      setState({ hits: [], searching: false })
      return
    }
    let live = true
    setState({ hits: [], searching: true })
    const timer = setTimeout(async () => {
      const results = await Promise.all(
        profileKey.split('\n').map(profile =>
          http(contentSearchPath(query, profile)).then(
            response => hitsFrom(response, query, profile) ?? [],
            (e: { code?: number }) => {
              if (isUnsupported(e?.code)) unsupportedHosts.add(host)
              return [] as ContentHit[]
            }
          )
        )
      )
      if (live) setState({ hits: results.flat(), searching: false })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, profileKey, host, http])
  return state
}
