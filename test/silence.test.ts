import { describe, expect, it } from 'vitest'
import { couldBecomeMarker, isSilenceMarker, silenceShown, streamShown } from '../src/renderer/src/state/silence'
import { applyEvent, emptyTranscript, fromHistory, type TranscriptState } from '../src/renderer/src/state/transcript'
import { lastLineOf } from '../src/renderer/src/state/bots'
import { rowsFromResponse } from '../src/renderer/src/state/chats'

const play = (events: { type: string; payload?: unknown }[]) => events.reduce<TranscriptState>(applyEvent, emptyTranscript)
const replies = (state: TranscriptState) => state.items.flatMap(i => (i.kind === 'assistant' ? [i.text] : []))

describe("Hermes' silence marker", () => {
  it('knows the markers in any case, with stray punctuation, never a malformed bracket', () => {
    for (const marker of ['[SILENT]', ' silent ', '*[SILENT]*', 'NO_REPLY', 'no reply.', '[静默]']) expect(isSilenceMarker(marker)).toBe(true)
    for (const text of ['[SILENT', 'Silent night', 'No reply needed here', '']) expect(isSilenceMarker(text)).toBe(false)
  })

  it('shows nothing for a bare marker and leaves off one that closes a real reply', () => {
    expect(silenceShown('[SILENT]')).toBe('')
    expect(silenceShown('Done for today.\n\n[SILENT]\n')).toBe('Done for today.')
    expect(silenceShown('Silent night')).toBe('Silent night')
  })

  it('holds a stream back while it could still become one', () => {
    expect(couldBecomeMarker('[SIL')).toBe(true)
    expect(couldBecomeMarker('*')).toBe(true)
    expect(streamShown('[SIL')).toBe('')
    expect(streamShown('Sure, here it is')).toBe('Sure, here it is')
    expect(streamShown('All set.\n[SIL')).toBe('All set.')
  })

  it('never leaves a reply that was only a marker in the chat, streamed or stored', () => {
    const live = play([
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: '[SIL' } },
      { type: 'message.delta', payload: { text: 'ENT]' } },
      { type: 'message.complete', payload: { text: '[SILENT]' } }
    ])
    expect(replies(live)).toEqual([])
    const closing = play([
      { type: 'message.start' },
      { type: 'message.delta', payload: { text: 'Checked it.\n' } },
      { type: 'message.delta', payload: { text: '[SILENT]' } },
      { type: 'message.complete', payload: {} }
    ])
    expect(replies(closing)).toEqual(['Checked it.'])
    expect(replies({ ...emptyTranscript, items: fromHistory([{ role: 'assistant', text: '[SILENT]', row_id: 1 }]) })).toEqual([])
  })

  it("isn't a bot's last line on Bots", () => {
    expect(lastLineOf('[SILENT]')).toBeUndefined()
    expect(lastLineOf('Morning!')).toBe('Morning!')
    expect(lastLineOf('Done for today.\n[SILENT]')).toBe('Done for today.')
  })

  it('is cut from a chat preview, alone or closing one', () => {
    const preview = (text: string) => rowsFromResponse({ sessions: [{ id: 's1', title: 'Inbox', preview: text }] })[0]?.preview
    expect(preview('NO_REPLY')).toBeFalsy()
    expect(preview('Checked it.\n[SILENT]')).toBe('Checked it.')
  })
})
