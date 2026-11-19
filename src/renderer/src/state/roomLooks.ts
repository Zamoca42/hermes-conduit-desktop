/**
 * How everyone in a room over Links looks (the phone's RoomLooks.swift;
 * room_looks.py). No other Hermes can read your bots' pictures or the glow
 * color they're drawn in, so Conduit gives its own Hermes a small picture
 * and the color of each bot, and the picture you chose for rooms
 * (`PUT /rooms/looks`). Each Hermes sends the others in a room its own look,
 * and the room's home passes on everyone else's, so the room draws other
 * people's agents, and the people, as their owner's Conduit does
 * (`GET /rooms/looks?room_id=`).
 */

import { ROOMS_PATH, type Http } from './roomLinks'
import type { RoomMember } from './groups'

export const ROOM_LOOKS_CAPABILITY = 'room-looks'
/** Your picture kept on Hermes for all your devices (`GET /rooms/looks` without a room; a `PUT` keeps what it leaves out). */
export const ROOM_LOOKS_YOU_CAPABILITY = 'room-looks-you'
export const LOOKS_PATH = `${ROOMS_PATH}/looks`
/** room_looks.MAX_PICTURE_BYTES. */
export const MAX_PICTURE_BYTES = 8 * 1024
/** A picture's edge, in pixels: a room draws one at 24 pt. */
export const PICTURE_EDGES = [96, 72, 56]
export const PICTURE_QUALITIES = [0.72, 0.55, 0.4, 0.28]
/** Your picture for rooms, on this computer, by dashboard, for a plugin that doesn't keep it. */
export const PERSON_PICTURE_KEY = 'conduit.roomPersonPicture.v1'
/** How often a room's looks are read again. */
export const LOOKS_READ_MS = 30_000

/** A picture and a color, either of which may be missing. */
export interface RoomLook {
  /** Base64 of a small JPEG or PNG. */
  picture?: string
  /** `#RRGGBB`. */
  color?: string
}

export interface RoomLooks {
  /** Other people's agents, by member id. */
  members: Record<string, RoomLook>
  /** The other people but the host, by their Link's name and by the name their posts carry. */
  people: Record<string, RoomLook>
  /** The host's, in a room someone else hosts. */
  home?: RoomLook
}

export const NO_LOOKS: RoomLooks = { members: {}, people: {} }

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const HEX = /^#[0-9A-Fa-f]{6}$/

/** The bytes a base64 string holds. */
export const base64Bytes = (value: string) => Math.floor((value.length * 3) / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)

/** One as the plugin answers it: null for one with neither. */
export function parseLook(value: unknown): RoomLook | null {
  const row = obj(value)
  if (!row) return null
  const raw = typeof row.picture === 'string' ? row.picture.replace(/\s+/g, '') : ''
  const picture = raw && raw.length % 4 === 0 && BASE64.test(raw) && pictureMime(raw) ? raw : undefined
  const color = typeof row.color === 'string' && HEX.test(row.color.trim()) ? row.color.trim().toUpperCase() : undefined
  if (!picture && !color) return null
  return { ...(picture ? { picture } : {}), ...(color ? { color } : {}) }
}

/** JPEG or PNG, from the first bytes; null for anything else. */
export function pictureMime(base64: string): string | null {
  if (base64.startsWith('/9j/')) return 'image/jpeg'
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png'
  return null
}

/** A look's picture as an image URL. */
export const lookPictureUrl = (look: RoomLook | null | undefined): string | null =>
  look?.picture ? `data:${pictureMime(look.picture)};base64,${look.picture}` : null

export function parseLooks(value: unknown): RoomLooks | null {
  const row = obj(value)
  if (row?.ok !== true) return null
  const members: Record<string, RoomLook> = {}
  for (const [id, raw] of Object.entries(obj(row.members) ?? {})) {
    const look = parseLook(raw)
    if (look) members[id] = look
  }
  const people: Record<string, RoomLook> = {}
  for (const raw of Array.isArray(row.people) ? row.people : []) {
    const person = obj(raw)
    const look = parseLook(person?.look)
    if (!person || !look) continue
    for (const key of ['name', 'poster']) {
      const name = typeof person[key] === 'string' ? (person[key] as string).trim() : ''
      if (name) people[name] = look
    }
  }
  const home = parseLook(row.home)
  return { members, people, ...(home ? { home } : {}) }
}

/** A member's, when it's another person's agent. */
export function memberLook(looks: RoomLooks | undefined, member: Pick<RoomMember, 'memberId' | 'peer'> | undefined): RoomLook | undefined {
  if (!looks || !member?.peer) return undefined
  return looks.members[member.memberId]
}

/** A person's by the name your Link or their posts give them, the host's when it's the host's name. */
export function personLook(looks: RoomLooks | undefined, name: string | undefined, hostName?: string): RoomLook | undefined {
  const shown = name?.trim()
  if (!looks || !shown) return undefined
  if (looks.people[shown]) return looks.people[shown]
  if (hostName && shown === hostName.trim()) return looks.home
  return undefined
}

/** The same looks, compared by what they show. */
export const sameLooks = (a: RoomLooks | undefined, b: RoomLooks | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

const lookBody = (look: RoomLook) => ({ picture: look.picture ?? null, color: look.color ?? null })

/** The body: each bot's look by profile, and yours; with `keepsYou` yours is left out, as your Hermes keeps it. */
export function looksBody(agents: Record<string, RoomLook>, person: RoomLook | null, keepsYou: boolean): Row {
  const body: Row = { agents: Object.fromEntries(Object.entries(agents).map(([profile, look]) => [profile, lookBody(look)])) }
  if (!keepsYou) body.person = person ? lookBody(person) : null
  return body
}

/** The same body always gives the same digest, whatever order its keys came in. */
export function looksDigest(agents: Record<string, RoomLook>, person: RoomLook | null, keepsYou: boolean): string {
  const parts = Object.keys(agents)
    .sort()
    .map(profile => `${profile}|${agents[profile]!.color ?? ''}|${agents[profile]!.picture ?? ''}`)
  parts.push(keepsYou ? 'keeps-you' : `person|${person?.picture ?? ''}`)
  return parts.join('\n')
}

/**
 * The first picture small enough to send, trying each edge and quality in
 * turn: `encode` draws one at an edge and quality and gives its base64 JPEG,
 * or null when it can't.
 */
export function smallestPicture(encode: (edge: number, quality: number) => string | null): string | null {
  for (const edge of PICTURE_EDGES) {
    for (const quality of PICTURE_QUALITIES) {
      const picture = encode(edge, quality)
      if (picture === null) return null
      if (base64Bytes(picture) <= MAX_PICTURE_BYTES) return picture
    }
  }
  return null
}

/** The plugin's looks routes. They take no profile: looks are the installation's. */
export function roomLooksClient(http: Http) {
  const ok = (body: unknown) => {
    if (obj(body)?.ok !== true) throw new Error('not ok')
    return obj(body)!
  }
  return {
    /** How a room's other people and their agents look. */
    read: async (roomId: string): Promise<RoomLooks> => {
      const looks = parseLooks(await http('GET', `${LOOKS_PATH}?room_id=${encodeURIComponent(roomId)}`))
      if (!looks) throw new Error('not ok')
      return looks
    },
    /** Gives your Hermes how your bots, and you, look. */
    share: async (body: Row) => void ok(await http('PUT', LOOKS_PATH, body)),
    /** The picture your Hermes keeps for you, as one of your devices last gave it. */
    you: async (): Promise<string | null> => parseLook(ok(await http('GET', LOOKS_PATH)).person)?.picture ?? null,
    /** Sets the picture your Hermes keeps for you; null takes it away. */
    setYou: async (picture: string | null) => void ok(await http('PUT', LOOKS_PATH, { person: picture ? { picture, color: null } : null }))
  }
}
