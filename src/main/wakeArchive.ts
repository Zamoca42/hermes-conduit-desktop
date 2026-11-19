/**
 * Vosk ships its models as .zip; the listener (vosk-browser) loads a model
 * as a gzipped tar of its folder. A downloaded model is turned from one to
 * the other once, here, and kept that way.
 */
import { gzipSync, inflateRawSync } from 'node:zlib'

export interface ArchiveEntry {
  name: string
  data: Buffer
}

/** The files in a zip (folders left out), read from its central directory. */
export function zipEntries(zip: Buffer): ArchiveEntry[] {
  // The end of central directory record: 22 bytes, plus a comment of up to 64 KB.
  let end = -1
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at
      break
    }
  }
  if (end < 0) throw new Error('not a zip')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const entries: ArchiveEntry[] = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('damaged zip')
    const method = zip.readUInt16LE(at + 10)
    const compressed = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    if (name.split('/').some(part => part === '..') || name.startsWith('/')) throw new Error('unsafe path in zip')
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('damaged zip')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(start, start + compressed)
    if (method === 0) entries.push({ name, data: Buffer.from(raw) })
    else if (method === 8) entries.push({ name, data: inflateRawSync(raw) })
    else throw new Error(`unsupported zip method ${method}`)
  }
  return entries
}

function header(name: string, size: number, folder = false): Buffer {
  const block = Buffer.alloc(512)
  let path = name
  let prefix = ''
  if (Buffer.byteLength(path) > 100) {
    const cut = name.lastIndexOf('/', name.length - 2)
    prefix = name.slice(0, cut)
    path = name.slice(cut + 1)
    if (Buffer.byteLength(path) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`name too long for tar: ${name}`)
  }
  block.write(path, 0, 'utf8')
  block.write(folder ? '0000755\0' : '0000644\0', 100)
  block.write('0000000\0', 108)
  block.write('0000000\0', 116)
  block.write(size.toString(8).padStart(11, '0') + '\0', 124)
  block.write('00000000000\0', 136)
  block.write('        ', 148)
  block.write(folder ? '5' : '0', 156)
  block.write('ustar\0', 257)
  block.write('00', 263)
  block.write(prefix, 345, 'utf8')
  let sum = 0
  for (const byte of block) sum += byte
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return block
}

/** A gzipped ustar archive of `entries`, each folder written before what's in it (the listener's untar makes no folders of its own). */
export function tarGz(entries: ArchiveEntry[]): Buffer {
  const parts: Buffer[] = []
  const folders = new Set<string>()
  for (const entry of entries) {
    const segments = entry.name.split('/').slice(0, -1)
    for (let depth = 1; depth <= segments.length; depth++) {
      const folder = segments.slice(0, depth).join('/') + '/'
      if (folders.has(folder)) continue
      folders.add(folder)
      parts.push(header(folder, 0, true))
    }
    parts.push(header(entry.name, entry.data.length), entry.data)
    const pad = (512 - (entry.data.length % 512)) % 512
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(parts))
}
