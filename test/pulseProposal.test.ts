import { describe, expect, it } from 'vitest'
import {
  heading,
  isCleared,
  parseCard,
  parseProposal,
  proposalCanUndo,
  proposalInFlight,
  proposalIsOpen,
  proposalStateText
} from '../src/renderer/src/state/pulse'

const proposal = (state: string, kind = 'add_event') => ({ id: 7, kind, line: 'Add to Personal: Dinner at Nopa', state, note: '' })

describe('Pulse suggestions', () => {
  it('reads a proposal and refuses an unknown state or a missing id', () => {
    expect(parseProposal(proposal('waiting'))).toEqual({ id: 7, kind: 'add_event', line: 'Add to Personal: Dinner at Nopa', state: 'waiting', note: '' })
    expect(parseProposal(proposal('maybe'))).toBeNull()
    expect(parseProposal({ state: 'waiting' })).toBeNull()
    expect(parseProposal('junk')).toBeNull()
  })

  it('stays open while waiting or adding, and clears once it settles', () => {
    const card = (state: string) => parseCard({ id: 1, kind: 'proposal', news: 'Dinner', proposal: proposal(state) })!
    expect(isCleared(card('waiting'))).toBe(false)
    expect(isCleared(card('adding'))).toBe(false)
    expect(isCleared(card('added'))).toBe(true)
    expect(isCleared(card('not_added'))).toBe(true)
    expect(heading(card('waiting'))).toBe('Suggestion')
  })

  it('says where it stands, and offers Undo only once added', () => {
    const p = (state: string, kind?: string) => parseProposal(proposal(state, kind))!
    expect(proposalStateText(p('waiting'))).toBe('')
    expect(proposalStateText(p('added'))).toBe('Added to your calendar')
    expect(proposalStateText(p('added', 'add_reminder'))).toBe('Added to your reminders')
    expect(proposalStateText(p('removed', 'add_reminder'))).toBe('Removed from your reminders')
    expect(proposalCanUndo(p('added'))).toBe(true)
    expect(proposalCanUndo(p('changed'))).toBe(true)
    expect(proposalCanUndo(p('failed'))).toBe(false)
    expect(proposalInFlight(p('removing'))).toBe(true)
    expect(proposalIsOpen(p('expired'))).toBe(false)
  })
})
