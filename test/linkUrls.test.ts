import { describe, expect, it } from 'vitest'
import { linkUrl, linkUrlFromArgs } from '../src/shared/linkUrls'

describe('Link invites from other apps', () => {
  it('finds the invite among a launch’s arguments', () => {
    expect(linkUrlFromArgs(['/Applications/Conduit', '--flag', 'conduit://link/abc123'])).toBe('conduit://link/abc123')
    expect(linkUrlFromArgs(['C:\\Conduit.exe', ' CONDUIT://link/x '])).toBe('CONDUIT://link/x')
    expect(linkUrlFromArgs(['conduit://other/abc', 'https://example.com'])).toBeNull()
    expect(linkUrl('conduit://link/')).toBeNull()
  })
})
