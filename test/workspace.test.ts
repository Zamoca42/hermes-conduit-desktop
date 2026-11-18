import { describe, expect, it } from 'vitest'
import { baseName, listPath, parentPath, parseListing, parseSearch, pathForDraft, relativePath, validName } from '../src/renderer/src/state/workspace'

describe('the Folder', () => {
  it('reads the plugin’s and Hermes’ listings, and Hermes’ error codes', () => {
    const listed = parseListing({ entries: [{ name: 'src', path: '/w/src', isDirectory: true }, { path: '/w/a.ts', size: 12, mtime: 1795000000.5 }, { name: 'no path' }], truncated: true })
    expect(listed.entries).toEqual([
      { name: 'src', path: '/w/src', isDirectory: true, size: undefined, mtime: undefined },
      { name: 'a.ts', path: '/w/a.ts', isDirectory: false, size: 12, mtime: 1795000000500 }
    ])
    expect(listed.truncated).toBe(true)
    expect(() => parseListing({ entries: [], error: 'ENOENT' })).toThrow("That folder isn't on the server.")
  })

  it('makes each matching line of a search a hit', () => {
    const found = parseSearch({ names: [{ path: '/w/readme.md', name: 'readme.md' }], matches: [{ path: '/w/a.ts', lines: [{ line: 3, text: 'const a' }, { line: 9, text: 'a()' }] }] })
    expect(found.names.map(e => e.name)).toEqual(['readme.md'])
    expect(found.matches).toEqual([
      { path: '/w/a.ts', line: 3, text: 'const a' },
      { path: '/w/a.ts', line: 9, text: 'a()' }
    ])
  })

  it('splits paths, POSIX and Windows', () => {
    expect(baseName('/w/src/')).toBe('src')
    expect(baseName('C:\\w\\a.ts')).toBe('a.ts')
    expect(parentPath('/w/src/a.ts')).toBe('/w/src')
    expect(parentPath('/a')).toBe('/')
    expect(relativePath('/w', '/w/src/a.ts')).toBe('src/a.ts')
    expect(relativePath('/w', '/wx/a.ts')).toBe('/wx/a.ts')
  })

  it('names the profile and the root in its routes', () => {
    expect(listPath('/w', '/w/src', 'work')).toBe('/api/plugins/conduit_push/workspace/list?root=%2Fw&path=%2Fw%2Fsrc&profile=work')
    expect(listPath('/w', '/w', 'default')).toBe('/api/plugins/conduit_push/workspace/list?root=%2Fw&path=%2Fw')
  })

  it('takes a plain name for a new file, and quotes a path with a space', () => {
    expect([validName('a.ts'), validName(' '), validName('..'), validName('a/b')]).toEqual([true, false, false, false])
    expect(pathForDraft('/w/a b.ts')).toBe('`/w/a b.ts`')
    expect(pathForDraft('/w/a.ts')).toBe('/w/a.ts')
  })
})

describe('file paths in replies', () => {
  it('links what names a file, and leaves other code alone', async () => {
    const { looksLikePath, absolutePath } = await import('../src/renderer/src/state/workspace')
    for (const path of ['/etc/hosts', '~/notes.md', 'C:\\w\\a.ts', 'README.md', 'src/app.ts', 'docs/', 'a/b/c', './build.sh']) expect([path, looksLikePath(path)]).toEqual([path, true])
    for (const code of ['owner/repo', 'npm install', 'github.com/a/b', 'https://x.dev/a.md', '1.2.3', 'v2.0', 'x', 'node:18/slim', 'a  b', 'ubuntu/22.04']) expect([code, looksLikePath(code)]).toEqual([code, false])
    expect(absolutePath('src/app.ts', '/w/')).toBe('/w/src/app.ts')
    expect(absolutePath('./a.ts', 'C:\\w')).toBe('C:\\w\\a.ts')
    expect(absolutePath('/etc/hosts', '/w')).toBe('/etc/hosts')
  })
})
