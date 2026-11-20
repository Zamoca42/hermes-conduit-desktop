/**
 * Saving a file that lives on the Hermes host: its name for the save dialog,
 * the dashboard path it's read from, and a data URL's bytes for a Hermes
 * without /api/fs/download.
 */

/** The file's own name, safe as a save dialog's default: the last part of a host path, no folder or odd characters. */
export function hostFileName(path: string): string {
  const last = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const clean = last.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  return clean && clean !== '.' && clean !== '..' ? clean.slice(0, 200) : 'file'
}

/** `/api/fs/download` or `/api/fs/read-data-url` for `path`, in a profile's scope when it isn't the default. */
export function hostFilePath(route: 'download' | 'read-data-url', path: string, profile?: string): string {
  const query = `path=${encodeURIComponent(path)}`
  return profile && profile !== 'default' ? `/api/fs/${route}?${query}&profile=${encodeURIComponent(profile)}` : `/api/fs/${route}?${query}`
}

/** A base64 data URL's bytes, or null when it isn't one. */
export function dataUrlBytes(value: unknown): Buffer | null {
  if (typeof value !== 'string') return null
  const match = /^data:[^,;]*(?:;[^,;]*)*;base64,(.*)$/s.exec(value)
  return match ? Buffer.from(match[1]!, 'base64') : null
}
