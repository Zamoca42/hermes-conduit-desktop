import { deflateSync, inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, encodeApng, isAnimatedPng } from '../src/renderer/src/state/apng'
import { isMovingDataUrl, thinned } from '../src/renderer/src/state/movingPicture'

const deflate = async (bytes: Uint8Array) => new Uint8Array(deflateSync(bytes))

/** The PNG's chunks: type, data, and whether the CRC holds. */
function chunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = []
  let at = 8
  while (at < bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    out.push({ type, data, crcOk: view.getUint32(at + 8 + length) === crc32(bytes.subarray(at + 4, at + 8 + length)) })
    at += 12 + length
  }
  return out
}

/** Undoes the Sub filter on one frame's scanlines. */
function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(1)
    for (let x = 0; x < stride; x++) out[y * stride + x] = (raw[y * (stride + 1) + 1 + x]! + (x >= 4 ? out[y * stride + x - 4]! : 0)) & 0xff
  }
  return out
}

describe('moving pictures', () => {
  it('checks its chunks with PNG’s CRC', () => {
    expect(crc32(Uint8Array.from('IEND', c => c.charCodeAt(0)))).toBe(0xae426082)
  })

  it('writes a looping animated PNG whose frames read back', async () => {
    const red = new Uint8Array(2 * 2 * 4).map((_, i) => [250, 10, 20, 255][i % 4]!)
    const blue = new Uint8Array(2 * 2 * 4).map((_, i) => [5, 40, 200, 128][i % 4]!)
    const png = await encodeApng([red, blue], 2, 2, 100, deflate)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const list = chunks(png)
    expect(list.map(c => c.type)).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND'])
    expect(list.every(c => c.crcOk)).toBe(true)
    const actl = new DataView(list[1]!.data.buffer, list[1]!.data.byteOffset)
    expect([actl.getUint32(0), actl.getUint32(4)]).toEqual([2, 0])
    // fcTL, fcTL, fdAT carry sequence numbers 0, 1, 2; each frame shows 100/1000 s.
    const fctl = (i: number) => new DataView(list[i]!.data.buffer, list[i]!.data.byteOffset)
    expect([fctl(2).getUint32(0), fctl(4).getUint32(0), new DataView(list[5]!.data.buffer, list[5]!.data.byteOffset).getUint32(0)]).toEqual([0, 1, 2])
    expect([fctl(2).getUint16(20), fctl(2).getUint16(22)]).toEqual([100, 1000])
    expect([...unfilter(new Uint8Array(inflateSync(list[3]!.data)), 2, 2)]).toEqual([...red])
    expect([...unfilter(new Uint8Array(inflateSync(list[5]!.data.subarray(4))), 2, 2)]).toEqual([...blue])
    expect(isAnimatedPng(png)).toBe(true)
    const url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    expect(isMovingDataUrl(url)).toBe(true)
  })

  it('tells a still PNG from a moving one', async () => {
    const still = await encodeApng([new Uint8Array(16)], 2, 2, 100, deflate)
    // Strip acTL and fcTL to make a plain PNG.
    const list = chunks(still)
    expect(isAnimatedPng(still)).toBe(true)
    const plain = Buffer.concat([Buffer.from(still.subarray(0, 8)), ...rebuild(list.filter(c => c.type !== 'acTL' && c.type !== 'fcTL'))])
    expect(isAnimatedPng(new Uint8Array(plain))).toBe(false)
    expect(isMovingDataUrl(`data:image/png;base64,${plain.toString('base64')}`)).toBe(false)
    expect(isMovingDataUrl('data:image/gif;base64,R0lGODlh')).toBe(true)
    expect(isMovingDataUrl('data:image/jpeg;base64,/9j/')).toBe(false)
  })

  it('thins frames evenly over the loop, keeping its length', () => {
    const frames = Array.from({ length: 60 }, (_, i) => ({ i, ms: 50 }))
    const { frames: picked, delay } = thinned(frames, 36)
    expect(picked).toHaveLength(36)
    expect(delay * 36).toBeCloseTo(3000)
    expect(picked[0]!.i).toBe(0)
    expect(picked[35]!.i).toBe(58)
    expect(thinned(frames.slice(0, 10), 36)).toEqual({ frames: frames.slice(0, 10), delay: 50 })
  })
})

function rebuild(list: { type: string; data: Uint8Array }[]): Buffer[] {
  return list.map(({ type, data }) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(new Uint8Array(typed)))
    return Buffer.concat([head, typed, crc])
  })
}
