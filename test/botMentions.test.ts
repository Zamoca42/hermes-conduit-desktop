import { describe, expect, it } from 'vitest'
import {
  annotated,
  insertingMention,
  mentionCandidates,
  mentionHandle,
  mentionNameForms,
  mentionQueryAt,
  mentionTag,
  resolveMentions,
  withMentionNote,
  withoutMentionNote
} from '../src/renderer/src/state/botMentions'
import type { Bot } from '../src/renderer/src/state/bots'

const bot = (name: string, title = name): Bot => ({
  name,
  title,
  pinned: false,
  hidden: false,
  isDefault: name === 'default',
  hasAvatar: false,
  face: 0,
  meta: {}
})
const names = (bots: Bot[]) => bots.map(b => b.name)

describe('bot mentions', () => {
  const roster = [bot('default', 'Hermes'), bot('researcher', 'Research Buddy'), bot('scout', 'Scout')]

  it('resolves handles and friendly forms, in tag order, once each', () => {
    expect(names(resolveMentions('ask @researcher and @scout', roster, 'default'))).toEqual(['researcher', 'scout'])
    expect(names(resolveMentions('@research-buddy or @researchbuddy', roster, 'default'))).toEqual(['researcher'])
    expect(names(resolveMentions('@scout @scout', roster))).toEqual(['scout'])
    expect(names(resolveMentions('@hermes', roster, 'scout'))).toEqual(['default'])
  })

  it('fails closed: unknown, e-mail, code, qualified, ambiguous and the listener stay plain', () => {
    expect(resolveMentions('@nobody', roster)).toEqual([])
    expect(resolveMentions('mail me@scout.dev', roster)).toEqual([])
    expect(resolveMentions('```\n@scout\n``` and `@scout`', roster)).toEqual([])
    expect(resolveMentions('@scout@laptop', roster)).toEqual([])
    expect(resolveMentions('@buddy', [bot('a', 'Buddy'), bot('b', 'Buddy')])).toEqual([])
    expect(resolveMentions('@scout', roster, 'Scout')).toEqual([])
  })

  it('adds the phone’s note, and takes it off again', () => {
    const sent = annotated('have a look @researcher', [roster[1]!])
    expect(sent.startsWith('have a look @researcher')).toBe(true)
    expect(sent).toContain('[@mentions resolved from the Bot Mode roster — the user is referring to: ')
    expect(sent).toContain('@researcher = agent profile "researcher" ("Research Buddy")')
    expect(sent.endsWith('If this session has no message_agent tool, agent messaging is unavailable here — say so.]')).toBe(true)
    expect(annotated('x', [roster[0]!])).toContain('@hermes = agent profile "default" ("Hermes")')
    expect(withoutMentionNote(sent)).toBe('have a look @researcher')
    expect(withoutMentionNote('plain')).toBe('plain')
  })

  it('leaves text untouched without a tag, a roster or for a slash command, and skips quoted lines', () => {
    expect(withMentionNote('hello', roster)).toBe('hello')
    expect(withMentionNote('@scout hi', [])).toBe('@scout hi')
    expect(withMentionNote('/new @scout', roster)).toBe('/new @scout')
    expect(withMentionNote('> @scout said\n\nthoughts?', roster, 'default')).toBe('> @scout said\n\nthoughts?')
    expect(withMentionNote('@scout look', roster, 'default')).toContain('agent profile "scout"')
  })

  it('tags and the @ list follow the phone', () => {
    expect(mentionTag(roster[1]!)).toBe('research-buddy')
    expect(mentionTag(roster[2]!)).toBe('scout')
    expect(mentionHandle(roster[0]!)).toBe('hermes')
    expect(mentionNameForms('Research -- Buddy (v2)')).toEqual(['research----buddy-v2', 'research--buddyv2'])
    expect(mentionNameForms('Everyone')).toEqual([])
    expect(names(mentionCandidates(roster, '', 'default'))).toEqual(['researcher', 'scout'])
    expect(names(mentionCandidates(roster, 'bud', 'default'))).toEqual(['researcher'])
    expect(mentionQueryAt('ask @sc', 7)).toEqual({ start: 4, query: 'sc' })
    expect(mentionQueryAt('me@sc', 5)).toBeNull()
    expect(insertingMention('', roster[2]!)).toBe('@scout ')
    expect(insertingMention('ask ', roster[2]!)).toBe('ask @scout ')
    expect(insertingMention('ask @sc', roster[2]!)).toBe('ask @scout ')
  })
})
