import { describe, expect, it } from 'vitest'
import { avatarUrl, botColor, botsFromProfiles, keptColor, lastLineOf } from '../src/renderer/src/state/bots'
import { assignFaces, faceColor, starterFace } from '../src/renderer/src/state/starterFaces'

const profile = (over: Record<string, unknown>) => ({ name: 'p', ...over })

describe('botsFromProfiles', () => {
  it('reads the look Hermes keeps and the Bot Chat', () => {
    const [bot] = botsFromProfiles({
      profiles: [
        profile({
          name: 'furina',
          display_name: 'Furina',
          description: 'Writes',
          model: 'gpt-5',
          has_avatar: true,
          ui_meta: { 'hermes-bots': { title: 'Lady Furina', color: '#ff00aa', pinned: true } },
          canonical_session: { id: 'c1', resolved_id: 'c2', preview: '**Hello** there', last_active: 1_700_000_000 }
        })
      ]
    })
    expect(bot).toMatchObject({
      name: 'furina',
      title: 'Lady Furina',
      description: 'Writes',
      model: 'gpt-5',
      color: '#ff00aa',
      pinned: true,
      hasAvatar: true,
      botChatId: 'c2',
      lastActive: 1_700_000_000_000
    })
    expect(bot!.lastLine).toContain('Hello')
  })

  it('leaves out hidden bots and puts pinned ones first, otherwise in Hermes\' order', () => {
    const bots = botsFromProfiles({
      profiles: [
        profile({ name: 'old', last_session: { last_active: 100 } }),
        profile({ name: 'new', last_session: { last_active: 200 } }),
        profile({ name: 'pin', ui_meta: { 'hermes-bots': { pinned: true } } }),
        profile({ name: 'gone', ui_meta: { 'hermes-bots': { hidden: true } } }),
        { display_name: 'no name' },
        null
      ]
    })
    expect(bots.map(b => b.name)).toEqual(['pin', 'old', 'new'])
    expect(bots.find(b => b.name === 'old')!.botChatId).toBeUndefined()
  })

  it('names the unnamed default profile Hermes and keeps Markdown out of the last line', () => {
    const [bot] = botsFromProfiles({
      profiles: [profile({ name: 'default', last_session: { preview: 'It printed **hello** | a | b |' } })]
    })
    expect(bot!.title).toBe('Hermes')
    expect(bot!.lastLine).toBe('It printed hello a b')
    expect(botsFromProfiles({ profiles: [profile({ name: 'work' })] })[0]!.title).toBe('Work')
  })

  it('names a profile by its title, else its display name, else its id capitalized, as the phone does', () => {
    const titles = botsFromProfiles({
      profiles: [
        profile({ name: 'a', display_name: 'Ayaka', ui_meta: { 'hermes-bots': { title: 'Lady Ayaka' } } }),
        profile({ name: 'b', display_name: 'Barbara' }),
        profile({ name: 'coder', display_name: 'coder' }),
        profile({ name: 'default', is_default: true, display_name: 'Default' }),
        profile({ name: 'main', is_default: true, display_name: 'main' }),
        profile({ name: 'default', ui_meta: { 'hermes-bots': { title: 'Paimon' } } })
      ]
    }).map(b => b.title)
    expect(titles).toEqual(['Lady Ayaka', 'Barbara', 'Coder', 'Hermes', 'Hermes', 'Paimon'])
  })

  it('skips a system or scheduled-job note for the last line, falling back to the newest chat', () => {
    expect(lastLineOf('[System: The active model for this chat has changed to x')).toBeUndefined()
    expect(lastLineOf('[Cron job "Audit" report] all good')).toBeUndefined()
    expect(lastLineOf('Model is qwen3.8-flash-iq3_xs, _really_')).toBe('Model is qwen3.8-flash-iq3_xs, really')
    const [bot] = botsFromProfiles({
      profiles: [profile({ canonical_session: { preview: '[System: changed model' }, last_session: { preview: 'Inbox is clear' } })]
    })
    expect(bot!.lastLine).toBe('Inbox is clear')
  })

  it('answers nothing for an odd body', () => {
    expect(botsFromProfiles(null)).toEqual([])
    expect(botsFromProfiles({ profiles: 'x' })).toEqual([])
  })
})

describe('avatarUrl', () => {
  it('makes an image URL from the asset', () => {
    expect(avatarUrl({ found: true, data: 'data:image/png;base64,AAA' })).toBe('data:image/png;base64,AAA')
    expect(avatarUrl({ found: true, mime: 'image/jpeg', data: 'BBB' })).toBe('data:image/jpeg;base64,BBB')
    expect(avatarUrl({ found: true, mime: 'text/html', data: 'BBB' })).toBe('data:image/png;base64,BBB')
    expect(avatarUrl({ found: false })).toBeNull()
    expect(avatarUrl(null)).toBeNull()
  })
})

describe('colors and starter faces', () => {
  it('takes the color Hermes keeps in any form it writes, and nothing else', () => {
    expect(keptColor('ff0000')).toBe('#ff0000')
    expect(keptColor('#abc')).toBe('#abc')
    expect(keptColor('hsl(262 62% 58%)')).toBe('hsl(262 62% 58%)')
    expect(keptColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)')
    expect(keptColor('Purple')).toBe('purple')
    expect(keptColor('red; background: url(x)')).toBeUndefined()
    expect(keptColor('#12345')).toBeUndefined()
    expect(keptColor(undefined)).toBeUndefined()
  })

  it('falls back to the face color', () => {
    expect(botColor({ face: 2 })).toBe(faceColor(starterFace(2)))
    expect(botColor({ face: 2, color: '#123456' })).toBe('#123456')
  })

  it('hands out faces as the phone does: held ones kept, then the main bot, then by when made', () => {
    const faces = assignFaces([
      { name: 'zed', isDefault: false },
      { name: 'b', isDefault: false, created: 20 },
      { name: 'a', isDefault: false, created: 10 },
      { name: 'picked', isDefault: false, storedFace: 0 },
      { name: 'default', isDefault: true }
    ])
    expect(Object.fromEntries(faces)).toEqual({ picked: 0, default: 1, a: 2, b: 3, zed: 4 })
  })

  it('reads the face from the bot look, hidden bots included in the handing out', () => {
    const bots = botsFromProfiles({
      profiles: [
        { name: 'default', is_default: true },
        { name: 'gone', ui_meta: { 'hermes-bots': { hidden: true, created: 1 } } },
        { name: 'work', ui_meta: { 'hermes-bots': { created: 2 } } },
        { name: 'chosen', ui_meta: { 'hermes-bots': { face: 7 } } }
      ]
    })
    expect(Object.fromEntries(bots.map(b => [b.name, b.face]))).toEqual({ default: 0, work: 2, chosen: 7 })
  })

  it('keeps varying past the twelve', () => {
    expect(starterFace(11).saturation).toBe(0.18)
    expect(starterFace(12)).not.toEqual(starterFace(13))
  })
})
