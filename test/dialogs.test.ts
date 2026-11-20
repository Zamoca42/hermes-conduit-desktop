import { describe, expect, it } from 'vitest'
import { ask, askText, dialogText, dismissAllDialogs, tell } from '../src/renderer/src/state/dialogs'
import { updateBanner } from '../src/renderer/src/state/hostActions'

describe("Conduit's own dialogs", () => {
  it('takes the heading from the first paragraph and the body from the rest', () => {
    expect(dialogText('Delete task?\n\nThis removes it.\n\nFor good.')).toEqual({ title: 'Delete task?', body: ['This removes it.', 'For good.'] })
    expect(dialogText('Remove Atlas?')).toEqual({ title: 'Remove Atlas?', body: [] })
    expect(dialogText('Delete project?\n\nDocs\nIts folders stay.')).toEqual({ title: 'Delete project?', body: ['Docs\nIts folders stay.'] })
  })

  it('answers Cancel, nothing and no text for the dialogs dismissed', async () => {
    const answers = Promise.all([ask('Stop?'), tell('Done.'), askText('Name', 'notes.md')])
    dismissAllDialogs()
    expect(await answers).toEqual([false, undefined, null])
  })
})

describe('the connection banner during an update', () => {
  it('follows the update, says when Hermes did not come back, and stays out of the way otherwise', () => {
    expect(updateBanner({ kind: 'updating', step: 'updating' })).toBe('updating')
    expect(updateBanner({ kind: 'updating', step: 'starting' })).toBe('updating')
    expect(updateBanner({ kind: 'updating', step: 'restarting' })).toBe('restarting')
    expect(updateBanner({ kind: 'notBackYet' })).toBe('notBack')
    expect(updateBanner({ kind: 'failed', detail: 'x' })).toBe('failed')
    expect(updateBanner({ kind: 'idle' })).toBeNull()
    expect(updateBanner({ kind: 'updated' })).toBeNull()
  })
})
