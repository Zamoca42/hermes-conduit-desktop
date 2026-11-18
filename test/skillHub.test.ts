import { describe, expect, it } from 'vitest'
import { parseInstalled, parseResults, parseScan, parseSources, repoURL, waitForAction } from '../src/renderer/src/state/skillHub'

describe('skill hub', () => {
  it('reads the sources, featured skills and what is installed', () => {
    const hub = parseSources({
      sources: [
        { id: 'hermes-index', label: 'Hermes Index', searchable: true },
        { id: 'github', label: 'GitHub', searchable: false }
      ],
      featured: [{ identifier: 'a/b/c', name: 'c', trust_level: 'trusted' }, { identifier: 'a/b/c' }, { name: 'no id' }],
      installed: { 'a/b/c': { name: 'cee' }, 'x/y': {} },
      index_available: true
    })
    expect(hub.sources).toEqual([{ id: 'hermes-index', label: 'Hermes Index' }])
    expect(hub.featured.map(s => [s.identifier, s.trust])).toEqual([['a/b/c', 'trusted']])
    expect(hub.installed).toEqual({ 'a/b/c': 'cee', 'x/y': 'y' })
    expect(parseInstalled([])).toEqual({})
  })

  it('reads results and a scan, worst finding first', () => {
    expect(parseResults({ results: [{ identifier: 'r/1' }], timed_out: ['clawhub'] })).toMatchObject({ results: [{ name: '1' }], timedOut: ['clawhub'] })
    const scan = parseScan({
      policy: 'ask',
      policy_reason: 'Community source',
      findings: [
        { severity: 'low', description: 'l' },
        { severity: 'CRITICAL', description: 'c', file: 'run.sh', line: 3 }
      ]
    })
    expect(scan.policy).toBe('ask')
    expect(scan.findings.map(f => f.description)).toEqual(['c', 'l'])
    expect(parseScan({ policy: 'weird' }).policy).toBe('block')
  })

  it('opens a source only as a web address', () => {
    expect(repoURL('owner/name')).toBe('https://github.com/owner/name')
    expect(repoURL('https://x.dev/r')).toBe('https://x.dev/r')
    expect(repoURL('not a repo')).toBeNull()
  })

  it('follows an action to its end', async () => {
    let polls = 0
    const ok = await waitForAction(async () => (++polls < 3 ? { running: true, lines: [] } : { running: false, exit_code: 0, lines: [] }), 'x', {
      sleep: async () => {}
    })
    expect(ok).toEqual({ ok: true })
    const failed = await waitForAction(async () => ({ running: false, exit_code: 1, lines: ['Blocked by scan', '=== done ==='] }), 'x', {
      sleep: async () => {}
    })
    expect(failed).toEqual({ ok: false, reason: 'Blocked by scan' })
  })
})

describe('official catalog', () => {
  it('groups the catalog by category, A-Z by its shown name', async () => {
    const { officialGroups, parseOfficial } = await import('../src/renderer/src/state/skillHub')
    const skills = parseOfficial({
      skills: [
        { identifier: 'official/research/b', name: 'b', category: 'research', installed: true },
        { identifier: 'official/ai/a', name: 'a', category: 'ai' },
        { identifier: 'official/research/a', name: 'a2', category: 'research' }
      ]
    })
    expect(officialGroups(skills).map(g => [g.title, g.skills.map(s => s.name)])).toEqual([
      ['AI', ['a']],
      ['Research', ['a2', 'b']]
    ])
    expect(skills.find(s => s.name === 'b')?.installed).toBe(true)
  })
})
