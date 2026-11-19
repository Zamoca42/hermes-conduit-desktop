/**
 * Settings > Multiplayer's Links, after the phone's RoomLinks.swift: the
 * Links between this Hermes and other people's, which let two people bring
 * their agents into rooms together, and the invites that make them. The
 * plugin keeps them for the whole installation and talks to the other side
 * through the rooms mailbox. A Link grants nothing by itself.
 *
 * An invite is a `conduit://link/` link. Only the plugin reads what's in
 * it; it carries the token that links whoever holds it, so it's never logged.
 */
export const ROOM_LINKS_CAPABILITY = 'room-links'
export const ROOMS_PATH = '/api/plugins/conduit_push/rooms'
/** Past the plugin's own 50 s for a call that waits on the mailbox. */
export const MAILBOX_TIMEOUT_MS = 55_000
export const LINK_PREFIX = 'conduit://link/'
/** The longest invite the plugin takes. */
export const MAX_INVITE_LENGTH = 2048
/** The plugin takes 1 to 64 characters for the name. */
export const MAX_NAME_LENGTH = 64
export const NAME_KEY = 'conduit.roomLinks.name'

import { t } from '../../../shared/i18n'

const PAYLOAD = /^[A-Za-z0-9_-]+$/

/** The whole text, trimmed, as an invite, or null. The scheme and host may come in any case. */
export function inviteText(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.slice(0, LINK_PREFIX.length).toLowerCase() !== LINK_PREFIX) return null
  const payload = trimmed.slice(LINK_PREFIX.length)
  const whole = LINK_PREFIX + payload
  // base64url as the plugin writes it: no padding, never one character left over.
  if (!payload || !PAYLOAD.test(payload) || payload.length % 4 === 1 || new TextEncoder().encode(whole).length > MAX_INVITE_LENGTH) return null
  return whole
}

/** The first invite in pasted text, which may hold more than the link. */
export function findInvite(text: string): string | null {
  const start = text.toLowerCase().indexOf(LINK_PREFIX)
  if (start < 0) return null
  const rest = text.slice(start + LINK_PREFIX.length)
  const payload = /^[A-Za-z0-9_-]*/.exec(rest)![0]
  return inviteText(LINK_PREFIX + payload)
}

export interface RoomLink {
  id: string
  name: string
  /** `waiting` (for the other side's Hermes to confirm), `linked` or `unanswered`; a newer status is kept as it is. */
  status: string
  words: string[]
  createdAt: number | null
  plugin: string | null
  /** Whose plugin to update: `theirs` or `yours`; null when they match. */
  behind: string | null
}

export interface RoomLinkInvite {
  id: string
  name: string
  /** Unix seconds. */
  expiresAt: number
}

export interface RoomLinksList {
  links: RoomLink[]
  invites: RoomLinkInvite[]
  /** False while nothing on the host reads the rooms mailbox. */
  mailboxReading: boolean
}

export interface RoomIdentity {
  /** Null before the host's first invite or accept made its keys. */
  words: string[] | null
  /** False on a Hermes without Python's cryptography package. */
  crypto: boolean
}

export interface InviteMade {
  url: string
  invite: RoomLinkInvite
  words: string[]
}

export type PreviewStop = { kind: 'own' } | { kind: 'expired' } | { kind: 'linked'; id: string }

export interface InvitePreview {
  name: string
  words: string[]
  mailbox: string
  expiresAt: number
  expired: boolean
  own: boolean
  linkedAs: string | null
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function bad(): never {
  throw new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))
}

/** Four words, or null. */
export function words(value: unknown): string[] | null {
  return Array.isArray(value) && value.length === 4 && value.every(w => typeof w === 'string') ? (value as string[]) : null
}

/** Unix seconds, as the plugin writes times. */
const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)

export function parseLink(value: unknown): RoomLink | null {
  const o = obj(value)
  const id = str(o?.id)
  const name = str(o?.name)
  const status = str(o?.status)
  const w = words(o?.words)
  if (!o || !id || name === null || status === null || !w) return null
  return { id, name, status, words: w, createdAt: seconds(o.created_at), plugin: str(o.plugin), behind: str(o.behind) }
}

export function parseInvite(value: unknown): RoomLinkInvite | null {
  const o = obj(value)
  const id = str(o?.id)
  const name = str(o?.name)
  const expiresAt = seconds(o?.expires_at)
  if (!id || name === null || expiresAt === null) return null
  return { id, name, expiresAt }
}

/** A Link or invite the page can't show is left out rather than refusing the whole list. */
export function parseList(body: unknown): RoomLinksList {
  const o = obj(body)
  if (o?.ok !== true || !Array.isArray(o.links) || !Array.isArray(o.invites)) bad()
  return {
    links: o.links.map(parseLink).filter((l): l is RoomLink => l !== null),
    invites: o.invites.map(parseInvite).filter((i): i is RoomLinkInvite => i !== null),
    mailboxReading: obj(o.mailbox)?.reading === true
  }
}

export function parseIdentity(body: unknown): RoomIdentity {
  const o = obj(body)
  if (o?.ok !== true || typeof o.crypto !== 'boolean') bad()
  return { words: words(o.words), crypto: o.crypto }
}

export function parseInviteMade(body: unknown): InviteMade {
  const o = obj(body)
  const url = inviteText(str(o?.url) ?? '')
  const invite = parseInvite(o?.invite)
  const w = words(o?.words)
  if (o?.ok !== true || !url || !invite || !w) bad()
  return { url, invite, words: w }
}

export function parsePreview(body: unknown): InvitePreview {
  const o = obj(body)
  const name = str(o?.name)
  const w = words(o?.words)
  const mailbox = str(o?.mailbox)
  const expiresAt = seconds(o?.expires_at)
  if (o?.ok !== true || name === null || !w || mailbox === null || expiresAt === null || typeof o.expired !== 'boolean' || typeof o.own !== 'boolean') bad()
  const linkedAs = str(o.linked_as)
  return { name, words: w, mailbox, expiresAt, expired: o.expired, own: o.own, linkedAs: linkedAs || null }
}

/** Why an invite offers no Link, or null. */
export function previewStop(preview: InvitePreview): PreviewStop | null {
  if (preview.own) return { kind: 'own' }
  if (preview.expired) return { kind: 'expired' }
  return preview.linkedAs ? { kind: 'linked', id: preview.linkedAs } : null
}

export type Http = <T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number) => Promise<T>

/** The plugin's links routes. They take no profile: Links are the installation's. */
export function roomLinksClient(http: Http) {
  return {
    identity: async () => parseIdentity(await http('GET', `${ROOMS_PATH}/identity`)),
    list: async () => parseList(await http('GET', `${ROOMS_PATH}/links`)),
    /** False when the plugin had no such Link (already gone). */
    unlink: async (id: string) => {
      const o = obj(await http('DELETE', `${ROOMS_PATH}/links?link_id=${encodeURIComponent(id)}`, undefined, MAILBOX_TIMEOUT_MS))
      if (o?.ok !== true || typeof o.removed !== 'boolean') bad()
      return o.removed
    },
    /** False when the invite was already used, cancelled or run out. */
    cancel: async (id: string) => {
      const o = obj(await http('DELETE', `${ROOMS_PATH}/links/invites?invite_id=${encodeURIComponent(id)}`, undefined, MAILBOX_TIMEOUT_MS))
      if (o?.ok !== true || typeof o.cancelled !== 'boolean') bad()
      return o.cancelled
    },
    invite: async (name: string) => parseInviteMade(await http('POST', `${ROOMS_PATH}/links/invites`, { name }, MAILBOX_TIMEOUT_MS)),
    preview: async (url: string) => parsePreview(await http('POST', `${ROOMS_PATH}/links/preview`, { url })),
    accept: async (url: string, name: string) => {
      const o = obj(await http('POST', `${ROOMS_PATH}/links`, { url, name }, MAILBOX_TIMEOUT_MS))
      const link = parseLink(o?.link)
      if (o?.ok !== true || !link) bad()
      return link
    }
  }
}

/** What a failed links request says: the plugin's own words, a mailbox's 502-504 included. */
export const linksMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Four fingerprint words, as both sides read them out. */
export const shownWords = (list: readonly string[]) => list.join(' · ')
