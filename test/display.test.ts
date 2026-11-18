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
