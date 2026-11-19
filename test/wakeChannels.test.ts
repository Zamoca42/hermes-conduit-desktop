import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IPC } from '../src/shared/ipc'

describe('the wake listener preload', () => {
  it('writes out the same channels IPC names', () => {
    const source = readFileSync(new URL('../src/preload/wake.ts', import.meta.url), 'utf8')
    for (const key of ['wakeModelBytes', 'wakePhrases', 'wakeReport'] as const) expect(source).toContain(`${key}: '${IPC[key]}'`)
    expect(source).not.toMatch(/from '\.\.\/shared/)
  })
})
