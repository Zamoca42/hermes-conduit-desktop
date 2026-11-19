import { describe, expect, it } from 'vitest'
import { deflateRawSync, gunzipSync } from 'node:zlib'
import { tarGz, zipEntries } from '../src/main/wakeArchive'

/** A zip of `files`: the first stored, the rest deflated, with a folder entry. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const all: [string, string | null][] = [['model/', null], ...Object.entries(files)]
  all.forEach(([name, text], index) => {
    const plain = Buffer.from(text ?? '')
    const method = index === 1 || text === null ? 0 : 8
    const data = method === 8 ? deflateRawSync(plain) : plain
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(plain.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(plain.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + data.length
  })
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(all.length, 8)
  end.writeUInt16LE(all.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

describe('wake model archives', () => {
  it('reads a zip’s files, stored or deflated, leaving folders out', () => {
    const entries = zipEntries(zip({ 'model/am/final.mdl': 'acoustic', 'model/conf/model.conf': 'x'.repeat(5000) }))
    expect(entries.map(e => [e.name, e.data.length])).toEqual([
      ['model/am/final.mdl', 8],
      ['model/conf/model.conf', 5000]
    ])
  })

  it('refuses a zip that would write outside its folder', () => {
    expect(() => zipEntries(zip({ '../evil': 'x' }))).toThrow(/unsafe/)
    expect(() => zipEntries(Buffer.from('not a zip at all, sorry'))).toThrow()
  })

  it('writes a tar with each folder before its files, each file whole, long names split into the prefix', () => {
    const long = `vosk-model-small-xx-0.22/${'deep/'.repeat(20)}file.txt`
    const tar = gunzipSync(tarGz([{ name: 'm/a.txt', data: Buffer.from('hello') }, { name: long, data: Buffer.from('x') }]))
    expect(tar.length % 512).toBe(0)
    const blocks = (at: number) => tar.subarray(at * 512, at * 512 + 512)
    expect(blocks(0).toString('utf8', 0, 2)).toBe('m/')
    expect(blocks(0).toString('utf8', 156, 157)).toBe('5')
    expect(blocks(1).toString('utf8', 0, 7)).toBe('m/a.txt')
    expect(blocks(1).toString('utf8', 156, 157)).toBe('0')
    expect(parseInt(blocks(1).toString('utf8', 124, 135), 8)).toBe(5)
    expect(blocks(2).toString('utf8', 0, 5)).toBe('hello')
    // Checksum: the header's bytes with the field read as spaces.
    const block = Buffer.from(blocks(1))
    const stored = parseInt(block.toString('utf8', 148, 154), 8)
    block.write('        ', 148)
    expect(block.reduce((s, b) => s + b, 0)).toBe(stored)
    // 21 folders for the long name, then its file, its name cut at the last slash.
    const file = blocks(3 + 21)
    expect(file.toString('utf8', 0, 8)).toBe('file.txt')
    expect(file.toString('utf8', 345, 345 + 24)).toBe('vosk-model-small-xx-0.22')
  })
})
