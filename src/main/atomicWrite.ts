/**
 * Saves a small file so a crash or power loss mid-save can't leave it torn:
 * the text goes to a temp file beside it, is flushed to disk, then renamed
 * over the old file, which stays as it was until then (as `streamToFile`
 * does for downloads, desktop#206, desktop#216; the saved hosts, desktop#297).
 */
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

export function writeFileAtomic(path: string, text: string, mode = 0o666): void {
  const temp = `${path}.${randomBytes(3).toString('hex')}.tmp`
  let fd: number | null = null
  try {
    fd = openSync(temp, 'w', mode)
    writeSync(fd, text)
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(temp, path)
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // Already closed.
      }
    }
    rmSync(temp, { force: true })
    throw error
  }
}
