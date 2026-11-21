import { beforeAll, describe, expect, it } from 'vitest'
import { hiddenNow, hidesChat, NO_PROJECT, projectIndex, projectOf, readHiddenProjects, writeHiddenProjects } from '../src/renderer/src/state/hiddenProjects'
import type { Project } from '../src/renderer/src/state/projects'

beforeAll(() => {
  const store = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  })
})

const project = (id: string, previews: string[], isHome = false): Project => ({
  id,
  title: id,
  isHome,
  isAuto: false,
  count: previews.length,
  previews: previews.map(p => ({ id: p, title: p }))
})
const tree = [project('home', ['h1'], true), project('site', ['s1', 's2']), project('docs', ['d1', 's2'])]

describe('Filter › Projects', () => {
  it('places a chat in the first listed project previewing it, and a chat in none in Home', () => {
    const index = projectIndex(tree)
    expect(projectOf(index, { id: 's1' })).toBe('site')
    expect(projectOf(index, { id: 's2' })).toBe('site')
    expect(projectOf(index, { id: 'd1' })).toBe('docs')
    expect(projectOf(index, { id: 'h1' })).toBe(NO_PROJECT)
    expect(projectOf(index, { id: 'x', lineageRoot: 'd1' })).toBe('docs')
  })

  it('hides only the projects listed now, and nothing until they load or with Home alone', () => {
    expect([...hiddenNow(['site', 'gone', NO_PROJECT], tree)].sort()).toEqual([NO_PROJECT, 'site'].sort())
    expect(hiddenNow(['site'], null).size).toBe(0)
    expect(hiddenNow([NO_PROJECT], [project('home', [], true)]).size).toBe(0)
  })

  it('keeps a pinned chat, and a wait while Needs approval lists them', () => {
    const hidden = new Set(['site'])
    expect(hidesChat('site', false, false, hidden)).toBe(true)
    expect(hidesChat('site', true, false, hidden)).toBe(false)
    expect(hidesChat('site', false, true, hidden)).toBe(false)
    expect(hidesChat('docs', false, false, hidden)).toBe(false)
  })

  it('keeps the choice per dashboard and profile', () => {
    writeHiddenProjects('https://a', 'Coder', ['site'])
    expect(readHiddenProjects('https://a', 'coder')).toEqual(['site'])
    expect(readHiddenProjects('https://b', 'coder')).toEqual([])
    expect(readHiddenProjects('https://a', 'writer')).toEqual([])
    writeHiddenProjects('https://a', 'coder', [])
    expect(readHiddenProjects('https://a', 'coder')).toEqual([])
  })
})
