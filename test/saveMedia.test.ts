import { describe, expect, it } from 'vitest'
import { dataUrlBytes as hostBytes, hostFileName, hostFilePath } from '../src/main/hostFiles'
import { dataUrlBytes, pictureFileName } from '../src/renderer/src/state/saveMedia'

describe('saving pictures, files and audio to this computer', () => {
  it('names the file from the host path, safely', () => {
    expect(hostFileName('/home/h/out/voice note.ogg')).toBe('voice note.ogg')
    expect(hostFileName('C:\\Users\\h\\a:b?.txt')).toBe('a_b_.txt')
    expect(hostFileName('/tmp/')).toBe('tmp')
    expect(hostFileName('..')).toBe('file')
  })

  it("reads from the dashboard, in a secondary bot's profile", () => {
    expect(hostFilePath('download', '/a b.png')).toBe('/api/fs/download?path=%2Fa%20b.png')
    expect(hostFilePath('read-data-url', '/x', 'nahida')).toBe('/api/fs/read-data-url?path=%2Fx&profile=nahida')
    expect(hostFilePath('download', '/x', 'default')).toBe('/api/fs/download?path=%2Fx')
  })

  it("decodes a data URL's bytes", () => {
    expect(hostBytes('data:audio/ogg;base64,aGk=')?.toString()).toBe('hi')
    expect(hostBytes('data:text/plain,hi')).toBeNull()
    expect(hostBytes(3)).toBeNull()
    expect(new TextDecoder().decode(dataUrlBytes('data:image/png;base64,aGk=')!)).toBe('hi')
    expect(dataUrlBytes('https://x/y.png')).toBeNull()
  })

  it("gives a picture the extension its data names", () => {
    expect(pictureFileName('cat.png', 'data:image/jpeg;base64,')).toBe('cat.png')
    expect(pictureFileName('cat', 'data:image/jpeg;base64,')).toBe('cat.jpg')
    expect(pictureFileName('', 'data:image/svg+xml;base64,')).toBe('Picture.svg')
    expect(pictureFileName('cat', 'blob:x')).toBe('cat')
  })
})
