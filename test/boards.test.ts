import { describe, expect, it } from 'vitest'
import { boardFrom, dialable, mailtoLink, people, share, smsLink, textRecipient } from '../src/renderer/src/state/boards'

const stats = { type: 'stats', title: 'Today', stats: [{ label: 'Steps', value: '8,412' }] }
const map = { type: 'map', title: 'Route', places: [] }

describe('boards', () => {
  it('draws a board of kinds it knows, with its tabs and follow-ups', () => {
    const board = boardFrom(
      'conduit_show',
      JSON.stringify({ ok: true, cards: [stats, { type: 'callout', callout: { text: 'Hi' } }], layout: 'tabs', next: ['More', 'Less'], markdown: '**Today**' }),
      undefined
    )
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

  it('draws a contact card, with the text Hermes wrote for the user to send', () => {
    const card = {
      type: 'contact',
      people: [
        { name: 'Mia Chen', detail: 'Wife', phone: '(+44) 7700 900123', message: 'Your flight landed!', photo: { url: 'https://x.test/m.jpg' } },
        { name: 'Sam', email: 'sam@example.com', message: 'Hi', url: 'javascript:alert(1)' },
        { name: '  ', phone: '123' }
      ]
    }
    expect(boardFrom('conduit_show', { ok: true, cards: [card], markdown: 'fallback' }, undefined)?.cards).toHaveLength(1)
    const [mia, sam] = people(card)
    expect(people(card)).toHaveLength(2)
    expect(mia).toMatchObject({ name: 'Mia Chen', detail: 'Wife', photo: 'https://x.test/m.jpg' })
    expect(sam!.url).toBeUndefined()
    expect(dialable(mia!.phone)).toBe('+447700900123')
    expect(dialable('555-0100')).toBe('5550100')
    expect(textRecipient(mia!)).toBe('+447700900123')
    expect(textRecipient(sam!)).toBe('sam@example.com')
    expect(smsLink('+447700900123')).toBe('sms:+447700900123')
    expect(smsLink('a@b.c&body=hi')).toBe('sms:a@b.c%26body%3Dhi')
    expect(mailtoLink('a@b.c?cc=x')).toBe('mailto:a@b.c%3Fcc%3Dx')
  })
})
