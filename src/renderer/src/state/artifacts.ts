/**
 * Artifacts, after the phone's Artifacts screens (Artifacts.swift,
 * ArtifactPins.swift): what a profile's chats produced, listed by the host's
 * Conduit plugin from its session store. Files Hermes sent or wrote, pages it
 * drew, files the user attached and links in replies. Saved ones (pins) are
 * the profile's, shared with every device, and keep a copy of their file.
 */
import { t } from '@shared/i18n'

export const ARTIFACTS_PATH = '/api/plugins/conduit_push/artifacts'
export const PINS_PATH = '/api/plugins/conduit_push/artifacts/pins'
export const PAGE_SIZE = 60
export const MAX_NOTE = 200

export type ArtifactKind = 'image' | 'video' | 'audio' | 'page' | 'document' | 'file' | 'link'
export type ArtifactSource = 'delivered' | 'preview' | 'written' | 'attached' | 'link'
export type ArtifactFilter = 'all' | 'images' | 'pages' | 'files' | 'links'
export const FILTERS: ArtifactFilter[] = ['all', 'images', 'pages', 'files', 'links']

const KINDS: ArtifactKind[] = ['image', 'video', 'audio', 'page', 'document', 'file', 'link']
const SOURCES: ArtifactSource[] = ['delivered', 'preview', 'written', 'attached', 'link']

export interface ArtifactItem {
  /** Its path, else its address: one artifact however often it's mentioned. */
  id: string
  kind: ArtifactKind
  source: ArtifactSource
  name: string
  path?: string
  url?: string
  host?: string
  exists: boolean
  size?: number
  sessionId: string
  sessionTitle: string
  messageId: number
  /** Milliseconds. */
  at: number
  /** A saved one's: when it was saved, its note, and the copy the host keeps of its file. */
  savedAt?: number
  note?: string
  keptPath?: string
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function webAddress(raw: unknown): string | undefined {
  const text = str(raw)
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const lastPart = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** One row of the host's list; null when it's missing what it needs (a file its path, a link its address). */
export function parseItem(raw: unknown): ArtifactItem | null {
  const r = (raw ?? {}) as Row
  const kind = KINDS.find(k => k === r.kind)
  const source = SOURCES.find(s => s === r.source)
  const sessionId = str(r.session_id)
  const messageId = num(r.message_id)
  const timestamp = num(r.timestamp)
  if (!kind || !source || !sessionId || messageId === undefined || !Number.isInteger(messageId) || timestamp === undefined) return null
  const path = str(r.path)
  const url = webAddress(r.url)
  if (source === 'link' ? !url : !path) return null
  const named = typeof r.name === 'string' ? r.name.trim() : ''
  const item: ArtifactItem = {
    id: path ?? url ?? `${messageId}|${named}`,
    kind,
    source,
    name: named || (path ? lastPart(path) : url ? new URL(url).host : ''),
    path,
    url,
    host: str(r.host),
    // A link has no file to miss.
    exists: source === 'link' || r.exists !== false,
    size: num(r.size),
    sessionId,
    sessionTitle: typeof r.session_title === 'string' ? r.session_title : '',
    messageId,
    at: timestamp * 1000
  }
  const savedAt = num(r.pinned_at)
  if (savedAt !== undefined) item.savedAt = savedAt * 1000
  const note = str(r.note)
  if (note) item.note = note
  const kept = str(r.kept_path)
  if (kept) item.keptPath = kept
  return item
}

/** `older` after `items`, each artifact once: its newest mention, which the earlier page holds, stays. */
export function merged(items: ArtifactItem[], older: ArtifactItem[]): ArtifactItem[] {
  const seen = new Set(items.map(i => i.id))
  return [...items, ...older.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)))]
}

export interface ArtifactPage {
  items: ArtifactItem[]
  nextBefore: number | null
}

export function parsePage(response: unknown, showMissing = true): ArtifactPage {
  const r = (response ?? {}) as Row
  if (r.ok !== true || !Array.isArray(r.items)) throw new Error(t('Hermes sent artifacts Conduit can’t read.'))
  const items = r.items.map(parseItem).filter((i): i is ArtifactItem => !!i && (showMissing || i.exists))
  return { items: merged([], items), nextBefore: typeof r.next_before === 'number' ? r.next_before : null }
}

const withProfile = (path: string, profile?: string | null) =>
  profile && profile !== 'default' ? `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}` : path

/** The list's request: a chat's ids (none for every chat), the chip, the search, and the page before `before`. */
export function listPath(options: {
  profile?: string | null
  sessionIds?: string[]
  filter?: ArtifactFilter
  query?: string
  showMissing?: boolean
  before?: number | null
}): string {
  const params = [`limit=${PAGE_SIZE}`]
  for (const id of options.sessionIds ?? []) if (id) params.push(`session_id=${encodeURIComponent(id)}`)
  if (options.filter && options.filter !== 'all') params.push(`kind=${options.filter}`)
  const words = (options.query ?? '').trim()
  if (words) params.push(`q=${encodeURIComponent(words)}`)
  if (options.showMissing === false) params.push('missing=hide')
  if (options.before !== undefined && options.before !== null) params.push(`before=${options.before}`)
  return withProfile(`${ARTIFACTS_PATH}?${params.join('&')}`, options.profile)
}

export const pinsPath = (profile?: string | null) => withProfile(PINS_PATH, profile)
export const unpinPath = (item: ArtifactItem, profile?: string | null) =>
  withProfile(`${PINS_PATH}?id=${encodeURIComponent(item.path ?? item.url ?? '')}`, profile)

/** The saved ones, saved last first. */
export function parsePins(response: unknown): ArtifactItem[] {
  const r = (response ?? {}) as Row
  if (r.ok !== true || !Array.isArray(r.pins)) throw new Error(t('Hermes sent artifacts Conduit can’t read.'))
  return merged(
    [],
    r.pins.map(parseItem).filter((i): i is ArtifactItem => !!i)
  ).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
}

/** A note as the host keeps it: one line, at most 200 characters. */
export function cleanNote(note: string): string | undefined {
  const words = note.split(/\s+/).filter(Boolean).join(' ')
  const limited = Array.from(words).slice(0, MAX_NOTE).join('')
  return limited || undefined
}

/** What saving sends: the row as the list gave it, and the note. */
export function pinBody(item: ArtifactItem, note?: string): Row {
  const row: Row = {
    kind: item.kind,
    source: item.source,
    name: item.name,
    session_id: item.sessionId,
    session_title: item.sessionTitle,
    message_id: item.messageId,
    timestamp: item.at / 1000
  }
  if (item.path) row.path = item.path
  if (item.url) row.url = item.url
  const cleaned = note === undefined ? undefined : cleanNote(note)
  return cleaned ? { item: row, note: cleaned } : { item: row }
}

export function includes(filter: ArtifactFilter, kind: ArtifactKind): boolean {
  switch (filter) {
    case 'images':
      return kind === 'image' || kind === 'video'
    case 'pages':
      return kind === 'page'
    case 'files':
      return kind === 'audio' || kind === 'document' || kind === 'file'
    case 'links':
      return kind === 'link'
    default:
      return true
  }
}

/** Saved ones matching the search: name, chat, note, path, address or site. */
export function matches(item: ArtifactItem, query: string): boolean {
  const words = query.trim().toLowerCase()
  if (!words) return true
  return [item.name, item.sessionTitle, item.note, item.path, item.url, item.host].some(v => v?.toLowerCase().includes(words))
}

export function filterTitle(filter: ArtifactFilter): string {
  switch (filter) {
    case 'images':
      return t('Images')
    case 'pages':
      return t('Pages')
    case 'files':
      return t('Files')
    case 'links':
      return t('Links')
    default:
      return t('All')
  }
}

export function kindTitle(kind: ArtifactKind): string {
  switch (kind) {
    case 'image':
      return t('Image')
    case 'video':
      return t('Video')
    case 'audio':
      return t('Audio')
    case 'page':
      return t('Page')
    case 'document':
      return t('Document')
    case 'link':
      return t('Link')
    default:
      return t('File')
  }
}

/** Items by the day they came from, newest first. */
export function days(items: ArtifactItem[], at: (item: ArtifactItem) => number = item => item.at): { day: number; items: ArtifactItem[] }[] {
  const groups: { day: number; items: ArtifactItem[] }[] = []
  for (const item of items) {
    const d = new Date(at(item))
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}

/** The path a file opens from: its own, else the copy a saved one kept once it was gone. */
export const openablePath = (item: ArtifactItem) => (item.exists ? item.path : (item.keptPath ?? undefined))
