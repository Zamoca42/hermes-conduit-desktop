/**
 * Pictures that live on the Hermes host (a chat's sent pictures, a reply's
 * `MEDIA:` pictures), read as data URLs through the dashboard's
 * `/api/fs/read-data-url`, as the phone's gatewayMediaRead does. A file
 * Hermes says it can't give (gone, refused, not a picture, over 16 MB) isn't
 * asked for again while the window is open; a read that fails (no
 * connection) may load the next time it's shown.
 */
import { gateway } from '../gateway'
const MAX_DATA_URL = Math.ceil((16 * 1024 * 1024) / 3) * 4 + 64
const kept = new Map<string, string | null>()
const reading = new Map<string, Promise<string | null>>()

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

/** A refusal Hermes means (the file isn't there or isn't allowed), not a failure to ask. */
function refused(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'number') return code >= 400 && code < 500
  return /\b(400|403|404|410|413|415)\b/.test(String((error as Error)?.message ?? error))
}

export function keptPicture(path: string, profile?: string): string | null | undefined {
  return kept.get(`${profile ?? ''}|${path}`)
}

export function readGatewayPicture(path: string, profile?: string): Promise<string | null> {
  const key = `${profile ?? ''}|${path}`
  if (kept.has(key)) return Promise.resolve(kept.get(key) ?? null)
  let read = reading.get(key)
  if (!read) {
    read = gateway
      .http('GET', readDataUrlPath(path, profile))
      .then(
        result => {
          const url = pictureDataUrl(result)
          kept.set(key, url)
          return url
        },
        error => {
          if (refused(error)) kept.set(key, null)
          return null
        }
      )
      .finally(() => reading.delete(key))
    reading.set(key, read)
  }
  return read
}
