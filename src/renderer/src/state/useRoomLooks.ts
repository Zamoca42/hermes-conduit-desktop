import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StarterFaceArt } from '../components/StarterFaceArt'
import { gateway } from '../gateway'
import { keptColor, type Bot } from './bots'
import { hexColor, lookPicture } from './lookPictures'
import { ROOM_LINKS_CAPABILITY } from './roomLinks'
import {
  LOOKS_READ_MS,
  PERSON_PICTURE_KEY,
  ROOM_LOOKS_CAPABILITY,
  ROOM_LOOKS_YOU_CAPABILITY,
  base64Bytes,
  MAX_PICTURE_BYTES,
  looksBody,
  looksDigest,
  roomLooksClient,
  sameLooks,
  type RoomLook,
  type RoomLooks
} from './roomLooks'
import { starterFace } from './starterFaces'
import { AVATAR_CHANGED, readAvatar } from './useBots'

const client = roomLooksClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs))

export type PersonPictureChange = 'saved' | 'unusable' | 'notSaved'

function readStoredYou(host: string): string | null {
  try {
    const value = (JSON.parse(localStorage.getItem(PERSON_PICTURE_KEY) ?? '{}') as Record<string, unknown>)[host]
    return typeof value === 'string' && base64Bytes(value) <= MAX_PICTURE_BYTES ? value : null
  } catch {
    return null
  }
}

function storeYou(host: string, picture: string | null): void {
  try {
    const all = JSON.parse(localStorage.getItem(PERSON_PICTURE_KEY) ?? '{}') as Record<string, unknown>
    if (picture) all[host] = picture
    else delete all[host]
    localStorage.setItem(PERSON_PICTURE_KEY, JSON.stringify(all))
  } catch {
    // Kept for this run only.
  }
}

/** A bot's starter face as an image URL, on the color Hermes keeps for it. */
function starterFaceUrl(bot: Bot): string {
  const svg = renderToStaticMarkup(createElement(StarterFaceArt, { face: starterFace(bot.face), background: keptColor(bot.color) }))
    .replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"')
    .replace(/ width="100%" height="100%"/, '')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Room looks (RoomLooks.swift): reads how the rooms over Links look, each
 * at most every 30 s, gives your Hermes how your bots look whenever that
 * changes, and keeps the picture you show in rooms.
 */
export function useRoomLooks(connected: boolean, host: string, capabilities: readonly string[], bots: Bot[] | null, glowOf: (name: string) => string) {
  const served = capabilities.includes(ROOM_LOOKS_CAPABILITY)
  const keepsYou = capabilities.includes(ROOM_LOOKS_YOU_CAPABILITY)
  const [looks, setLooks] = useState<Record<string, RoomLooks>>({})
  const [you, setYouState] = useState<string | null>(() => readStoredYou(host))
  const [youSaving, setYouSaving] = useState(false)
  const readAt = useRef(new Map<string, number>())
  const reading = useRef(false)
  const queued = useRef<{ ids: string[]; once: Set<string> } | null>(null)
  const epoch = useRef(0)
  const youChanges = useRef(0)

  useEffect(() => {
    epoch.current++
    readAt.current.clear()
    setLooks({})
    setYouState(readStoredYou(host))
  }, [host])

  /**
   * Reads the looks of `roomIds` not read in the last 30 s, one after
   * another; those in `once` (rooms that are over) only when they were never
   * read. One that fails keeps what was read.
   */
  const read = useCallback(
    async (roomIds: readonly string[], once: ReadonlySet<string> = new Set()) => {
      if (!served || !connected) return
      if (reading.current) {
        queued.current = { ids: [...roomIds], once: new Set(once) }
        return
      }
      reading.current = true
      const at = epoch.current
      try {
        let next: { ids: string[]; once: Set<string> } | null = { ids: [...roomIds], once: new Set(once) }
        while (next) {
          const { ids, once: over } = next
          queued.current = null
          for (const roomId of ids) {
            const last = readAt.current.get(roomId)
            if (last !== undefined && (over.has(roomId) || Date.now() - last < LOOKS_READ_MS)) continue
            readAt.current.set(roomId, Date.now())
            const found = await client.read(roomId).catch(() => null)
            if (epoch.current !== at) return
            if (!found) {
              readAt.current.delete(roomId)
              continue
            }
            setLooks(current => (sameLooks(current[roomId], found) ? current : { ...current, [roomId]: found }))
          }
          next = queued.current
        }
      } finally {
        reading.current = false
      }
    },
    [served, connected]
  )

  // The picture your Hermes keeps for you, as another of your devices last gave it.
  useEffect(() => {
    if (!served || !keepsYou || !connected || youSaving) return
    const changes = youChanges.current
    const at = epoch.current
    void client
      .you()
      .then(picture => {
        if (epoch.current !== at || youChanges.current !== changes) return
        setYouState(picture)
        storeYou(host, picture)
      })
      .catch(() => undefined)
  }, [served, keepsYou, connected, youSaving, host])

  /** Sets the picture you show in rooms over Links (a base64 JPEG, or null to take it away). */
  const setYou = useCallback(
    async (picture: string | null): Promise<PersonPictureChange> => {
      if (youSaving) return 'notSaved'
      setYouSaving(true)
      youChanges.current++
      try {
        if (keepsYou) {
          if (!connected) return 'notSaved'
          try {
            await client.setYou(picture)
          } catch {
            return 'notSaved'
          }
        }
        setYouState(picture)
        storeYou(host, picture)
        return 'saved'
      } finally {
        youChanges.current++
        setYouSaving(false)
      }
    },
    [youSaving, keepsYou, connected, host]
  )

  // How your bots and you look, given to your Hermes when that changed since it was last given here.
  const shared = useRef(new Map<string, string>())
  const pictures = useRef(new Map<string, { url: string; picture: string | null }>())
  const sharing = useRef<Promise<void> | null>(null)
  const shareAgain = useRef(false)
  const linksServed = capabilities.includes(ROOM_LINKS_CAPABILITY)
  const latest = useRef({ bots, glowOf, you, keepsYou, host })
  latest.current = { bots, glowOf, you, keepsYou, host }

  const shareOnce = useCallback(async () => {
    const { bots: shown, glowOf: glow, you: person, keepsYou: keeps, host: dashboard } = latest.current
    if (!shown?.length) return
    const agents: Record<string, RoomLook> = {}
    for (const bot of shown.slice(0, 32)) {
      // A bot with no picture sends its starter face, so the others see the face it wears here.
      const url = (bot.hasAvatar ? await readAvatar(bot.name) : null) ?? starterFaceUrl(bot)
      let kept = pictures.current.get(bot.name)
      if (kept?.url !== url) {
        kept = { url, picture: await lookPicture(url) }
        pictures.current.set(bot.name, kept)
      }
      const color = hexColor(glow(bot.name))
      agents[bot.name] = { ...(kept.picture ? { picture: kept.picture } : {}), ...(color ? { color } : {}) }
    }
    const look = !keeps && person ? { picture: person } : null
    const digest = looksDigest(agents, look, keeps)
    if (shared.current.get(dashboard) === digest) return
    await client.share(looksBody(agents, look, keeps))
    if (latest.current.host === dashboard) shared.current.set(dashboard, digest)
  }, [])

  const share = useCallback(async () => {
    if (sharing.current) {
      shareAgain.current = true
      return sharing.current
    }
    sharing.current = (async () => {
      try {
        do {
          shareAgain.current = false
          await shareOnce().catch(() => undefined)
        } while (shareAgain.current)
      } finally {
        sharing.current = null
      }
    })()
    return sharing.current
  }, [shareOnce])

  const glowKey = (bots ?? []).map(bot => `${bot.name}|${bot.hasAvatar}|${bot.face}|${bot.color ?? ''}|${glowOf(bot.name)}`).join('\n')
  useEffect(() => {
    if (!served || !linksServed || !connected || !bots?.length) return
    void share()
  }, [served, linksServed, connected, glowKey, you, keepsYou, host, share, bots?.length])
  // A picture Edit Bot changed is shared again.
  useEffect(() => {
    if (!served || !linksServed || !connected) return
    const changed = () => void share()
    window.addEventListener(AVATAR_CHANGED, changed)
    return () => window.removeEventListener(AVATAR_CHANGED, changed)
  }, [served, linksServed, connected, share])

  return { served, keepsYou, looks, read, you, youSaving, setYou }
}

/** The picture you show in rooms over Links, for Settings > Multiplayer. */
export interface PersonPicture {
  /** Whether your Hermes carries looks between rooms. */
  served: boolean
  /** Base64 JPEG. */
  picture: string | null
  saving: boolean
  set: (picture: string | null) => Promise<PersonPictureChange>
}
