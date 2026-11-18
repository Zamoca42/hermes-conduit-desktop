import { describe, expect, it } from 'vitest'
import {
  catalogImage,
  filterCatalog,
  parseCatalog,
  parseInstall,
  parseInstalled,
  parseUpdate,
  pluginPath,
  sourceEntry
} from '../src/renderer/src/state/plugins'

describe('plugins', () => {
  it('lists installed plugins as Hermes Desktop does: bundled ones and provider plumbing left out', () => {
    const list = parseInstalled({
      plugins: [
        { name: 'zeta', source: 'git', runtime_status: 'enabled', can_update_git: true, path: '/h/plugins/zeta-repo' },
        { name: 'browser-x', source: 'bundled', runtime_status: 'enabled' },
        { name: 'disk-cleanup', source: 'bundled', runtime_status: 'disabled' },
        { name: 'platforms/slack', source: 'user' },
        { name: 'Alpha', source: 'user', can_remove: true, auth_required: true, auth_command: 'hermes alpha login' }
      ]
    })
    expect(list.map(p => p.name)).toEqual(['Alpha', 'disk-cleanup', 'zeta'])
    expect(list[0]).toMatchObject({ canRemove: true, canUpdate: true, authCommand: 'hermes alpha login', status: 'inactive' })
    expect(list[2]).toMatchObject({ folder: 'zeta-repo', canUpdate: true, canRemove: false })
    expect(() => parseInstalled({})).toThrow()
  })

  it('reads the catalog: tiers, GitHub pictures only, what it adds', () => {
    const [entry] = parseCatalog({
      entries: [
        {
          name: 'cool',
          title: '',
          tier: 'bundled',
          image: 'https://raw.githubusercontent.com/a/b/c.png',
          screenshots: ['https://evil.example/x.png', 'https://github.com/a/b.png'],
          repo: 'https://github.com/a/b',
          docs_url: 'javascript:alert(1)',
          capabilities: { provides_tools: ['t1'], requires_env: ['KEY'] }
        }
      ]
    })
    expect(entry).toMatchObject({ title: 'cool', tier: 'official', tools: ['t1'], requiresEnv: ['KEY'], repo: 'https://github.com/a/b', docs: undefined })
    expect(entry.screenshots).toEqual(['https://github.com/a/b.png'])
    expect(catalogImage('http://github.com/x.png')).toBeUndefined()
  })

  it('offers the ones not installed, official first, then A-Z, matching the search', () => {
    const catalog = parseCatalog({
      entries: [
        { name: 'b', tier: 'community' },
        { name: 'a', tier: 'community', description: 'mail' },
        { name: 'z', tier: 'official' },
        { name: 'v', tier: 'verified', installed: true }
      ]
    })
    expect(filterCatalog(catalog, '').map(e => e.name)).toEqual(['z', 'a', 'b'])
    expect(filterCatalog(catalog, 'MAIL').map(e => e.name)).toEqual(['a'])
    const installed = parseInstalled({ plugins: [{ name: 'other', source: 'git', path: '/p/v' }] })[0]
    expect(sourceEntry(installed, catalog)?.name).toBe('v')
  })

  it('encodes each part of a plugin route and reads install and update answers', () => {
    expect(pluginPath('a b/c')).toBe('/api/dashboard/agent-plugins/a%20b/c')
    const entry = parseCatalog({ entries: [{ name: 'x', title: 'X' }] })[0]
    expect(parseInstall({ missing_env: ['A', { name: 'B' }], restart_required: true }, entry)).toEqual({ name: 'X', missingEnv: ['A', 'B'], restart: true })
    expect(parseUpdate({ consent_required: true, delta_lines: ['+ tool'] })).toEqual({ kind: 'consent', lines: ['+ tool'] })
    expect(parseUpdate({ unchanged: true })).toEqual({ kind: 'upToDate' })
    expect(parseUpdate({})).toEqual({ kind: 'updated', restart: true })
  })
})
