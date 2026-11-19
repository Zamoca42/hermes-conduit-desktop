import { describe, expect, it } from 'vitest'
import { isPinned, pinnedRows, recentRows, recordSwitch, togglePin, RECENT_LIMIT, type ModelQuickPicks } from '../src/renderer/src/state/modelQuickPicks'
import type { ModelProviderRow } from '../src/renderer/src/state/models'

const none: ModelQuickPicks = { pinned: [], recent: [] }
const providers: ModelProviderRow[] = [
  { slug: 'openrouter', name: 'OpenRouter', models: ['a', 'b', 'c', 'd', 'e'], unavailable_models: ['e'] },
  { slug: 'nous', name: 'Nous', models: ['a', 'h'] }
]
const at = (provider: string, model: string) => ({ provider, model })

describe('model quick picks', () => {
  it('pins in pin order and unpins, a model under each provider apart', () => {
    let picks = togglePin(none, at('nous', 'h'))
    picks = togglePin(picks, at('openrouter', 'a'))
    expect(pinnedRows(picks, providers)).toEqual([at('nous', 'h'), at('openrouter', 'a')])
    expect(isPinned(picks, at('nous', 'a'))).toBe(false)
    picks = togglePin(picks, at('nous', 'h'))
    expect(pinnedRows(picks, providers)).toEqual([at('openrouter', 'a')])
  })

  it('puts the model switched to first, then the one left', () => {
    let picks = recordSwitch(none, at('openrouter', 'b'), at('openrouter', 'a'))
    expect(picks.recent).toEqual([at('openrouter', 'b'), at('openrouter', 'a')])
    picks = recordSwitch(picks, at('openrouter', 'a'), at('openrouter', 'b'))
    expect(picks.recent).toEqual([at('openrouter', 'a'), at('openrouter', 'b')])
  })

  it('keeps 8 recent models and shows 3 that are neither pinned nor in use', () => {
    let picks = none
    for (let i = 0; i < 12; i++) picks = recordSwitch(picks, at('p', `m${i}`))
    expect(picks.recent.length).toBe(RECENT_LIMIT)
    picks = { pinned: [at('openrouter', 'c')], recent: [at('openrouter', 'a'), at('openrouter', 'b'), at('openrouter', 'c'), at('nous', 'h'), at('nous', 'a')] }
    expect(recentRows(picks, providers, at('openrouter', 'a'))).toEqual([at('openrouter', 'b'), at('nous', 'h'), at('nous', 'a')])
  })

  it("keeps a pick its provider no longer lists or can't run, without showing it", () => {
    const picks = { pinned: [at('openrouter', 'e'), at('gone', 'x'), at('openrouter', 'd')], recent: [] }
    expect(pinnedRows(picks, providers)).toEqual([at('openrouter', 'd')])
    expect(picks.pinned.length).toBe(3)
  })
})
