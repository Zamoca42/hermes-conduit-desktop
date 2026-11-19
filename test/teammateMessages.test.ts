import { describe, expect, it } from 'vitest'
import { delivery, inbound, teammateName, teammateReplies } from '../src/renderer/src/state/teammateMessages'
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

describe('teammate replies', () => {
  const user = (key: string, text: string) => ({ kind: 'user', key, text })
  const reply = (key: string, text = 'ok', streaming = false) => ({ kind: 'assistant', key, text, streaming })
  const sent = (key: string, target: string) => ({ kind: 'tool', key, name: 'message_agent', args: JSON.stringify({ target, message: 'hi' }) })

  it('folds the bot’s replies to a delivery it didn’t ask for, until the user writes', () => {
    const items = [user('u1', 'Hi'), reply('a1'), user('u2', 'Message from 🤖 Atlas (@atlas): the build is red'), reply('a2'), reply('a3'), user('u3', 'thanks'), reply('a4')]
    expect([...teammateReplies(items)]).toEqual([
      ['a2', 'Atlas'],
      ['a3', 'Atlas']
    ])
  })

  it('leaves the report open when the bot messaged that teammate first, and a reply still streaming', () => {
    const asked = [user('u1', 'Ask Atlas'), sent('t1', 'atlas'), reply('a1'), user('u2', 'Message from 🤖 Atlas (@atlas): done'), reply('a2')]
    expect(teammateReplies(asked).size).toBe(0)
    // Messaging someone else doesn't count.
    const other = [user('u1', 'Ask Iris'), sent('t1', 'iris'), user('u2', 'Message from 🤖 Atlas (@atlas): hello'), reply('a2'), reply('a3', '…', true)]
    expect([...teammateReplies(other)]).toEqual([['a2', 'Atlas']])
    // A forwarded message from a person stays the user's.
    expect(teammateReplies([user('u1', 'Message from Mom: dinner?'), reply('a1')]).size).toBe(0)
  })
})
