/**
 * Pictures that live on the Hermes host (a chat's sent pictures, a reply's
 * `MEDIA:` pictures), read as data URLs through the dashboard's
 * `/api/fs/read-data-url`, as the phone's gatewayMediaRead does. A file
 * Hermes says it can't give (gone, refused, not a picture, over 16 MB) isn't
 * asked for again while this dashboard is open; a read that fails (no
 * connection, a busy or rate-limited gateway, a sign-in to redo) may load the
 * next time it's shown. Pictures are kept per dashboard, and a dashboard
 * switch drops them, as the phone's TranscriptImageCache does (desktop#222).
 * The pictures kept are bounded (`KEPT_PICTURES_MAX` of them, `KEPT_PICTURES_MAX_CHARS`
 * of data URL in all), the least recently shown going first; a picture that
 * went is read again when it's next shown. Refusals are kept apart, so a
 * picture going never asks again for one Hermes refused (desktop#294).
 */
import { gateway } from '../gateway'
import { forgetRoomPictures } from './roomPictures'
const MAX_DATA_URL = Math.ceil((16 * 1024 * 1024) / 3) * 4 + 64
/** At most this many pictures are kept, and at most this much data URL in all (about 96 MB of pictures). */
export const KEPT_PICTURES_MAX = 64
export const KEPT_PICTURES_MAX_CHARS = 128 * 1024 * 1024
/** Kept pictures, least recently shown first. */
const kept = new Map<string, string>()
let keptChars = 0
/** Pictures Hermes refused, which aren't asked for again. */
const refusals = new Set<string>()
const reading = new Map<string, Promise<string | null>>()
let keptHost = ''

/** The dashboard this window shows: another one's pictures (a room's too), or their absence, never draw here. */
export function setPictureHost(host: string): void {
  if (host === keptHost) return
  keptHost = host
  kept.clear()
  keptChars = 0
  refusals.clear()
  reading.clear()
  forgetRoomPictures()
}

/** The dashboard pictures are kept for, so a picture shown across a switch asks the new one. */
export const pictureHost = () => keptHost

const pictureKey = (path: string, profile?: string) => `${keptHost}\0${profile ?? ''}\0${path}`

export function readDataUrlPath(path: string, profile?: string): string {
  const query = `path=${encodeURIComponent(path)}`
  return profile && profile !== 'default' ? `/api/fs/read-data-url?${query}&profile=${encodeURIComponent(profile)}` : `/api/fs/read-data-url?${query}`
}

/** The answer's picture, or null when it isn't one. */
export function pictureDataUrl(result: unknown): string | null {
  const url = (result as { dataUrl?: unknown } | null)?.dataUrl
  if (typeof url !== 'string' || url.length > MAX_DATA_URL) return null
  return /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|heic|heif);base64,/i.test(url) ? url : null
}

/**
 * A refusal Hermes means (the file isn't there or isn't allowed), not a
 * failure to ask. 408 and 429 are a gateway in trouble and 401 a sign-in that
 * may come back, so a later look asks again, as on the phone (desktop#223).
 */
export function refused(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'number') return code >= 400 && code < 500 && code !== 401 && code !== 408 && code !== 429
  return /\b(400|403|404|410|413|415)\b/.test(String((error as Error)?.message ?? error))
}

/** Keeps `url` as the most recently shown, letting the least recently shown go past the bounds. */
function keep(key: string, url: string): void {
  const before = kept.get(key)
  if (before !== undefined) {
    kept.delete(key)
    keptChars -= before.length
  }
  kept.set(key, url)
  keptChars += url.length
  for (const [oldest, picture] of kept) {
    if (kept.size <= KEPT_PICTURES_MAX && keptChars <= KEPT_PICTURES_MAX_CHARS) break
    if (oldest === key) break
    kept.delete(oldest)
    keptChars -= picture.length
  }
}

/** The kept picture (null: Hermes refused it; undefined: not read yet, or let go). Showing one keeps it longest. */
export function keptPicture(path: string, profile?: string): string | null | undefined {
  const key = pictureKey(path, profile)
  if (refusals.has(key)) return null
  const url = kept.get(key)
  if (url !== undefined) keep(key, url)
  return url
}

export function readGatewayPicture(path: string, profile?: string): Promise<string | null> {
  const key = pictureKey(path, profile)
  if (refusals.has(key)) return Promise.resolve(null)
  const known = kept.get(key)
  if (known !== undefined) {
    keep(key, known)
    return Promise.resolve(known)
  }
  let read = reading.get(key)
  if (!read) {
    read = gateway
      .http('GET', readDataUrlPath(path, profile))
      .then(
        result => {
          const url = pictureDataUrl(result)
          // An answer that lands after a dashboard switch belongs to the old one.
          if (reading.get(key) === read) {
            if (url) keep(key, url)
            else refusals.add(key)
          }
          return url
        },
        error => {
          if (reading.get(key) === read && refused(error)) refusals.add(key)
          return null
        }
      )
      .finally(() => {
        if (reading.get(key) === read) reading.delete(key)
      })
    reading.set(key, read)
  }
  return read
}
