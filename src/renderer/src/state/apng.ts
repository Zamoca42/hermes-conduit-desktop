/**
 * A looping animated PNG from RGBA frames, as the phone's AnimatedAvatar
 * writes one: Hermes' asset store takes a PNG by its bytes, and an animated
 * PNG is one, so a moving picture is stored and synced like any picture and
 * every viewer that can't play it shows its first frame.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const ascii = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0))
const u32 = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
const u16 = (value: number) => Uint8Array.of(value >>> 8, value & 0xff)

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([ascii(type), data])
  return concat([u32(data.length), typed, u32(crc32(typed))])
}

/** zlib-wrapped deflate, as IDAT and fdAT carry it. */
export type Deflate = (bytes: Uint8Array) => Promise<Uint8Array>

export const streamDeflate: Deflate = async bytes => {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Each row behind its filter byte; Sub (1) where the row is, as photos usually are, smoother than None. */
function scanlines(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4
  const out = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const at = y * (stride + 1)
    out[at] = 1
    for (let x = 0; x < stride; x++) out[at + 1 + x] = (rgba[row + x]! - (x >= 4 ? rgba[row + x - 4]! : 0)) & 0xff
  }
  return out
}

/** The frames, all `width` by `height`, each shown `delayMs`, looping for ever. */
export async function encodeApng(frames: readonly (Uint8ClampedArray | Uint8Array)[], width: number, height: number, delayMs: number, deflate: Deflate = streamDeflate): Promise<Uint8Array> {
  if (!frames.length) throw new Error('No frames')
  const parts: Uint8Array[] = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)]
  parts.push(chunk('IHDR', concat([u32(width), u32(height), Uint8Array.of(8, 6, 0, 0, 0)])))
  parts.push(chunk('acTL', concat([u32(frames.length), u32(0)])))
  let sequence = 0
  const delay = Math.max(1, Math.round(delayMs))
  for (let i = 0; i < frames.length; i++) {
    parts.push(
      chunk(
        'fcTL',
        concat([u32(sequence++), u32(width), u32(height), u32(0), u32(0), u16(delay), u16(1000), Uint8Array.of(0, 0)])
      )
    )
    const data = await deflate(scanlines(frames[i]!, width, height))
    parts.push(i === 0 ? chunk('IDAT', data) : chunk('fdAT', concat([u32(sequence++), data])))
  }
  parts.push(chunk('IEND', new Uint8Array(0)))
  return concat(parts)
}

/** Whether these PNG bytes animate (an `acTL` before the first `IDAT`). */
export function isAnimatedPng(bytes: Uint8Array): boolean {
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    at += 12 + length
  }
  return false
}
