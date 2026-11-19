import { describe, expect, it } from 'vitest'
import { delivery, inbound, teammateName } from '../src/renderer/src/state/teammateMessages'
import { previewText } from '../src/renderer/src/state/text'

describe('teammate messages', () => {
  it('reads a signed delivery, and leaves an unsigned one the user’s', () => {
    expect(inbound('Message from 🤖 Atlas (@atlas): found it\n\nmore')).toEqual({ sender: 'Atlas', handle: 'atlas', body: 'found it\n\nmore' })
    expect(inbound("[Message from agent 'scout'] on my way")).toEqual({ sender: 'scout', handle: 'scout', body: 'on my way' })
    expect(inbound('Message from Atlas (v2) (@atlas): hi')?.sender).toBe('Atlas (v2)')
    expect(inbound('Message from Mom: call me')).toBeNull()
    expect(inbound('hello')).toBeNull()
    expect(inbound(`Message from 🤖 Atlas (@atlas): ${'x'.repeat(2000)}`)?.body).toHaveLength(2000)
  })

  it('reads a message_agent call and a terminal run as a delivery', () => {
    expect(delivery('message_agent', JSON.stringify({ target: '@Atlas', message: ' check the logs ' }))).toEqual({ target: 'atlas', message: 'check the logs' })
    expect(delivery('message_agent', '{}')).toBeNull()
    const command = `hermes -p scout chat --in ~ -c "Bot Chat" --create-if-missing -Q -q "Message from 🤖 Atlas (@atlas): look at \\"this\\""`
    expect(delivery('terminal', JSON.stringify({ command }))).toEqual({ target: 'scout', message: 'look at "this"' })
    expect(delivery('terminal', JSON.stringify({ command: 'ls -la' }))).toBeNull()
    expect(delivery('read_file', '{}')).toBeNull()
  })

  it('names a teammate from the roster, and previews a delivery as its words', () => {
    const roster = [
      { name: 'default', title: 'Hermes' },
      { name: 'atlas', title: 'Atlas Prime' }
    ]
    expect(teammateName('atlas', roster)).toBe('Atlas Prime')
    expect(teammateName('hermes', roster)).toBe('Hermes')
    expect(teammateName('ghost', roster, 'Ghost')).toBe('Ghost')
    expect(previewText('Message from 🤖 Atlas (@atlas): found it')).toBe('Atlas: found it')
  })
})
