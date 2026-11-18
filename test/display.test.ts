import { describe, expect, it } from 'vitest'
import { chatDisplay, thinkingMode, withThinking } from '../src/renderer/src/state/display'
import { fieldValue, chatSections, withValue } from '../src/renderer/src/state/profileConfig'

describe('chat display', () => {
  it('reads Thinking as the phone does: unset shows, off with Conduit’s key tells On request from Off', () => {
    expect(thinkingMode({})).toBe('show')
    expect(thinkingMode({ display: { show_reasoning: false } })).toBe('on_request')
    expect(thinkingMode({ display: { show_reasoning: false, conduit_thinking_on_request: false } })).toBe('off')
    expect(chatDisplay({ display: { tool_progress: 'off' } }).toolCards).toBe(false)
    expect(chatDisplay({ display: { tool_progress: 'all' } }).toolCards).toBe(true)
  })
  it('writes Thinking into the display block, Show leaving Conduit’s key', () => {
    expect(withThinking({ display: { x: 1 } }, 'off').display).toEqual({ x: 1, show_reasoning: false, conduit_thinking_on_request: false })
    expect(withThinking({ display: { conduit_thinking_on_request: false } }, 'show').display).toEqual({
      show_reasoning: true,
      conduit_thinking_on_request: false
    })
  })
  it('the Chat rows read and save them', () => {
    const fields = chatSections({})[0].fields
    const thinking = fields.find(f => f.key === 'conduit.reasoning_display')!
    const tools = fields.find(f => f.key === 'display.tool_progress')!
    expect(fieldValue({ display: { show_reasoning: false } }, thinking)).toBe('on_request')
    expect(fieldValue({ display: { tool_progress: 'off' } }, tools)).toBe(false)
    expect(withValue({}, 'conduit.reasoning_display', 'on_request')).toEqual({ display: { show_reasoning: false, conduit_thinking_on_request: true } })
  })
})

describe('tool card details', () => {
  it('opens finished cards when Keep tool cards expanded is on', () => {
    expect(chatDisplay({}).expandTools).toBe(false)
    expect(chatDisplay({ display: { expand_tools: true } }).expandTools).toBe(true)
  })
  it('shows JSON indented and cuts long text', async () => {
    const { toolDetail } = await import('../src/renderer/src/state/transcript')
    expect(toolDetail({ path: 'a.txt' })).toBe('{\n  "path": "a.txt"\n}')
    expect(toolDetail('{"ok":true}')).toBe('{\n  "ok": true\n}')
    expect(toolDetail('plain output ')).toBe('plain output')
    expect(toolDetail({})).toBeUndefined()
    expect(toolDetail(null)).toBeUndefined()
    expect(toolDetail('x'.repeat(10), 4)).toBe('xxxx…')
  })
})

describe('tool details from the REST transcript', () => {
  it('fills a history row’s input and output by call id', async () => {
    const { attachBoards, missingDetails, toolAnswers, toolArgs } = await import('../src/renderer/src/state/transcript')
    const page = {
      messages: [
        { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"ls"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'a.txt' }
      ]
    }
    const state = { items: [{ kind: 'tool' as const, key: 'k', toolId: 'c1', name: 'terminal', status: 'done' as const }], running: false }
    expect(missingDetails(state)).toBe(true)
    const next = attachBoards(state, toolAnswers(page), toolArgs(page))
    expect(next.items[0]).toMatchObject({ args: '{\n  "command": "ls"\n}', result: 'a.txt' })
    expect(missingDetails(next)).toBe(false)
    expect(attachBoards(next, toolAnswers(page), toolArgs(page))).toBe(next)
  })
})
