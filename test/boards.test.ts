import { describe, expect, it } from 'vitest'
import { boardFrom, share } from '../src/renderer/src/state/boards'

const stats = { type: 'stats', title: 'Today', stats: [{ label: 'Steps', value: '8,412' }] }
const map = { type: 'map', title: 'Route', places: [] }

describe('boards', () => {
  it('draws a board of kinds it knows, with its tabs and follow-ups', () => {
    const board = boardFrom('conduit_show', JSON.stringify({ ok: true, cards: [stats, { type: 'callout', callout: { text: 'Hi' } }], layout: 'tabs', next: ['More', 'Less'], markdown: '**Today**' }), undefined)
    expect(board).toMatchObject({ tabs: true, next: ['More', 'Less'], markdown: '**Today**' })
    expect(board!.cards.map(c => c.type)).toEqual(['stats', 'callout'])
  })

  it('shows the Markdown whole when any card is one it can’t draw', () => {
    const board = boardFrom('conduit_show', { ok: true, cards: [stats, map], markdown: '## Route\n::conduit-board{id="cb-1"}\n' }, undefined)
    expect(board).toMatchObject({ cards: [], markdown: '## Route' })
  })

  it('is no board for another tool, a Markdown-only show or Markdown meant for the reply', () => {
    expect(boardFrom('terminal', { cards: [stats] }, undefined)).toBeNull()
    expect(boardFrom('conduit_show', { ok: true, note: 'shown' }, undefined)).toBeNull()
    expect(boardFrom('conduit_show', { ok: false, error: 'not_conduit', markdown: '# x' }, { cards: [stats] })).toBeNull()
    expect(boardFrom('conduit_show', 'not json', undefined)).toBeNull()
  })

  it('takes the call’s cards when an answer that succeeded doesn’t carry them', () => {
    expect(boardFrom('conduit_show', { ok: true }, { cards: [stats] })!.cards).toHaveLength(1)
  })

  it('fills a progress bar from a value and its goal, or a share', () => {
    expect(share(5, 10)).toBe(0.5)
    expect(share(0.25, undefined)).toBe(0.25)
    expect(share(40, undefined)).toBe(0.4)
    expect(share(30, 10)).toBe(1)
  })
})
