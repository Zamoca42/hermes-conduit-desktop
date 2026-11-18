import { describe, expect, it } from 'vitest'
import {
  filterSkills,
  flipped,
  parseServers,
  parseSkills,
  parseTest,
  parseToolsets,
  prettyCategory,
  scoped,
  skillGroups
} from '../src/renderer/src/state/capabilities'

describe('capabilities', () => {
  it('scopes a route to a profile other than the default', () => {
    expect(scoped('/api/skills', 'default')).toBe('/api/skills')
    expect(scoped('/api/skills/content?name=a', 'nahida')).toBe('/api/skills/content?name=a&profile=nahida')
  })

  it('reads skills, once each, and groups them by category', () => {
    const skills = parseSkills([
      { name: 'b', category: 'mlops/training', enabled: false, provenance: 'hub', usage: 3 },
      { name: 'a', category: 'mlops/training', description: 'Train' },
      { name: 'a', category: 'other' },
      { name: 'c', category: 'ai-tools' },
      { description: 'nameless' }
    ])
    expect(skills.map(s => s.name)).toEqual(['b', 'a', 'c'])
    expect(skills[0]).toMatchObject({ enabled: false, provenance: 'hub', usage: 3 })
    expect(skillGroups(skills).map(g => [g.title, g.skills.map(s => s.name)])).toEqual([
      ['AI Tools', ['c']],
      ['MLOps / Training', ['a', 'b']]
    ])
    expect(filterSkills(skills, 'train').map(s => s.name)).toEqual(['b', 'a'])
    expect(prettyCategory('')).toBe('Other')
  })

  it('reads toolsets and servers', () => {
    expect(parseToolsets([{ name: 'web', label: 'Web', enabled: true, configured: false, tools: ['web_search', 1] }])).toEqual([
      { name: 'web', label: 'Web', description: '', enabled: true, configured: false, tools: ['web_search'] }
    ])
    const servers = parseServers({
      servers: [
        { name: 'fs', command: 'npx', args: ['-y', 'server', 3], enabled: true, source: 'config' },
        { name: 'docs', url: 'https://x/mcp', enabled: false, source: 'plugin', plugin: 'docs_plugin' }
      ]
    })
    expect(servers.map(s => [s.name, s.runs, s.enabled, s.plugin])).toEqual([
      ['fs', 'npx -y server 3', true, ''],
      ['docs', 'https://x/mcp', false, 'docs_plugin']
    ])
  })

  it('reads a test and flips a switch', () => {
    expect(parseTest({ ok: true, tools: [{ name: 'read', description: 'Reads' }] })).toEqual({ kind: 'ok', tools: [{ name: 'read', description: 'Reads' }] })
    expect(parseTest({ ok: false, error: 'refused' })).toEqual({ kind: 'failed', error: 'refused' })
    expect(flipped([{ name: 'a', enabled: true }], 'a', false)).toEqual([{ name: 'a', enabled: false }])
  })
})
