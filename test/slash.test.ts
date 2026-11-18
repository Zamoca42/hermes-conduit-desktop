import { describe, expect, it } from 'vitest'
import { question } from '../src/renderer/src/state/stepSummaries'
import {
  helpText,
  looksLikeSlashCommand,
  normalizeCatalog,
  parseSlashCommand,
  parseSlashResult,
  sideAgentNote,
  suggestCommands,
  wantsDispatch
} from '../src/renderer/src/state/slash'
import { addOutput, applyEvent, emptyTranscript } from '../src/renderer/src/state/transcript'

describe('a typed slash command', () => {
  it('is a / and a bare name at the start, as Hermes reads it', () => {
    expect(looksLikeSlashCommand('/undo')).toBe(true)
    expect(looksLikeSlashCommand('/goal ship it\nand test')).toBe(true)
    expect(looksLikeSlashCommand('/usr/local is full')).toBe(false)
    expect(looksLikeSlashCommand('run /clean')).toBe(false)
    expect(parseSlashCommand('/Goal  ship it\n  and test ')).toEqual({ name: 'goal', arg: 'ship it\n  and test' })
    expect(parseSlashCommand('/')).toEqual({ name: '', arg: '' })
  })
})

describe('the suggestions', () => {
  const catalog = normalizeCatalog({
    categories: [{ name: 'Session', pairs: [['/new', 'Start a new session (usage: /new [name])'], ['/reset', 'alias'], ['/history', 'Show history']] }],
    pairs: [['/work', 'A skill']],
    canon: { '/reset': '/new' }
  })

  it('are Hermes’ catalog with aliases folded in, without what an app chat can’t run', () => {
    const neu = catalog.find(c => c.name === 'new')!
    expect(neu).toEqual({ name: 'new', aliases: ['reset'], description: 'Start a new session' })
    expect(catalog.some(c => c.name === 'reset' || c.name === 'history')).toBe(false)
    expect(catalog.some(c => c.name === 'work')).toBe(true)
    // Conduit's own fill in what an older Hermes doesn't list.
    expect(catalog.some(c => c.name === 'btw' && c.description)).toBe(true)
  })

  it('put names that start with what’s typed first, then aliases, then the rest', () => {
    const names = suggestCommands(catalog, '/re').map(c => c.name)
    expect(names[0]).toBe('retry')
    expect(names).toContain('new')
    expect(suggestCommands(catalog, '/').length).toBe(8)
    expect(suggestCommands(catalog, '/zzz')).toEqual([])
  })

  it('make /help a list', () => {
    expect(helpText([{ name: 'new', aliases: ['reset'], description: 'Start' }])).toContain('- `/new` (/reset) — Start')
  })
})

describe('what Hermes answers', () => {
  it('is output, words to send, words for the composer, or another command', () => {
    expect(parseSlashResult({ output: 'Hermes v0.23', warning: 'careful' })).toEqual({ type: 'output', output: 'Hermes v0.23\n\ncareful' })
    expect(parseSlashResult({ output: '(no output)' })).toEqual({ type: 'output', output: '' })
    expect(parseSlashResult({ type: 'send', message: 'second question' })).toEqual({ type: 'send', message: 'second question' })
    expect(parseSlashResult({ type: 'skill', name: 'work', message: 'BODY', display: '/work fix' })).toEqual({ type: 'send', message: 'BODY', display: '/work fix' })
    expect(parseSlashResult({ type: 'prefill', message: 'first', notice: 'Undid 1 turn' })).toEqual({ type: 'prefill', message: 'first', notice: 'Undid 1 turn' })
    expect(parseSlashResult({ type: 'alias', target: '/new' })).toEqual({ type: 'alias', target: '/new' })
    expect(parseSlashResult(null)).toBeNull()
  })

  it('sends a turned-down command to command.dispatch', () => {
    expect(wantsDispatch(Object.assign(new Error('skill command'), { code: 4018 }))).toBe(true)
    expect(wantsDispatch(new Error('skill command: use command.dispatch for /work'))).toBe(true)
    expect(wantsDispatch(new Error('no user messages to undo'))).toBe(false)
  })
})

describe('a side agent’s answer', () => {
  it('lands in the chat as a note beside the turn', () => {
    expect(sideAgentNote('btw', 't1', 'Yes.', 'is it done?')).toBe('[btw "is it done?"]\nYes.')
    expect(sideAgentNote('background', 't2', 'Done.')).toBe('[bg t2]\nDone.')
    const state = applyEvent(emptyTranscript, { type: 'btw.complete', payload: { task_id: 't1', text: 'Yes.', question: 'q' } })
    expect(state.items.at(-1)).toMatchObject({ kind: 'output', text: '[btw "q"]\nYes.', format: 'markdown' })
    const summary = applyEvent(emptyTranscript, { type: 'btw.complete', payload: { task_id: 't3', text: 'I first…', question: question('English', 18) } })
    expect(summary.items).toHaveLength(0)
    expect(addOutput(emptyTranscript, { command: '/version', text: 'v1', format: 'plain' }).items[0]).toMatchObject({ kind: 'output', command: '/version' })
  })
})
