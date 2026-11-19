import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { entryNames, problem } from '../scripts/check-pr-feature-map.mjs'

const MAP = '# Feature map\n\n## Calls from Hermes\n\ntext\n\n```\n## Not an entry\n```\n\n## Pulse\n'
const names = entryNames(MAP)
const body = (map: string, after = '## Testing\nRan it.\n') =>
  `## Summary\nA change.\n\n## Feature map\n${map}\n\n${after}`

describe('the Feature map section of a desktop PR', () => {
  it('reads the entry names, fenced blocks left out', () => {
    expect(names).toEqual(['Calls from Hermes', 'Pulse'])
  })

  it('passes an entry named, or no mapped feature with a reason', () => {
    expect(problem(body('- Calls from Hermes: rings on the computer (Desktop app line in hermes-conduit#2805).'), names)).toBeNull()
    expect(problem(body('pulse'), names)).toBeNull()
    expect(problem(body('No mapped feature: the Windows installer only.'), names)).toBeNull()
  })

  it('fails a missing, empty or unnamed section', () => {
    expect(problem('## Summary\n', names)).toContain('no "## Feature map" section')
    expect(problem(body('<!-- the entries -->'), names)).toContain('empty')
    expect(problem(body('No mapped feature.'), names)).toContain('says why')
    expect(problem(body('Settings'), names)).toContain('names no entry')
    // The section ends at the next heading.
    expect(problem(body('', '## Testing\nPulse\n'), names)).toContain('empty')
  })

  it('passes any answer when the map could not be read', () => {
    expect(problem(body('Settings'), null)).toBeNull()
    expect(problem(body(''), null)).toContain('empty')
  })

  it('is asked for by the PR template, which a PR has to fill in', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8')
    expect(problem(template, names)).toContain('empty')
  })
})
