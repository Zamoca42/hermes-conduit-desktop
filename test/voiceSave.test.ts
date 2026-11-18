import { describe, expect, it } from 'vitest'
import { newCallId, saveBody } from '../src/renderer/src/state/voiceSave'

describe('saving a live call', () => {
  it("numbers the finished turns from 0 and keeps them with the call's chat", () => {
    const body = saveBody(
      'desktop-1',
      'grok-live',
      [
        { role: 'user', text: ' Check the repo ', at: 1700000000.4 },
        { role: 'assistant', text: '   ', at: 1700000001 },
        { role: 'assistant', text: 'On it.', at: 1700000002 }
      ],
      'sess_1'
    )
    expect(body).toEqual({
      call_id: 'desktop-1',
      engine: 'grok-live',
      chat_id: 'sess_1',
      turns: [
        { index: 0, role: 'user', text: 'Check the repo', at: 1700000000 },
        { index: 1, role: 'assistant', text: 'On it.', at: 1700000002 }
      ]
    })
  })

  it('saves nothing for a call with no words, and a call with no chat as its own', () => {
    expect(saveBody('c', 'gpt-live', [{ role: 'user', text: ' ', at: 1 }])).toBeNull()
    expect(saveBody('c', 'gpt-live', [{ role: 'user', text: 'hi', at: 1 }])).not.toHaveProperty('chat_id')
    expect(newCallId()).toMatch(/^desktop-[0-9a-f-]{36}$/)
  })
})
