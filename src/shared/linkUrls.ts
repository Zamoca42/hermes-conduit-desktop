/**
 * A Link invite opened from another app (`conduit://link/…`), as the phone
 * takes one from Messages, a chat or the Camera: the OS hands it to Conduit
 * on the command line (Windows, and a second launch anywhere) or as an
 * open-url event (the Mac).
 */

export const LINK_SCHEME = 'conduit'

/** The first Link invite among a launch's arguments, if any. */
export function linkUrlFromArgs(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const url = linkUrl(arg)
    if (url) return url
  }
  return null
}

/** The text when it's a Link invite, trimmed; null otherwise. */
export function linkUrl(text: string): string | null {
  const trimmed = text.trim()
  return /^conduit:\/\/link\/\S+$/i.test(trimmed) ? trimmed : null
}
