import { describe, expect, it } from 'vitest'
import {
  canDelete,
  composeSoul,
  createParams,
  duplicateMeta,
  duplicateName,
  isValidSlug,
  modelPinned,
  needsModel,
  nextFreeFace,
  slugFrom,
  titleFor
} from '../src/renderer/src/state/botActions'
import type { Bot } from '../src/renderer/src/state/bots'

const bot = (over: Partial<Bot>): Bot => ({ name: 'a', title: 'A', meta: {}, pinned: false, hidden: false, ...over }) as Bot

describe('slugFrom', () => {
  it('folds accents and spaces like the phone', () => {
    expect(slugFrom('  Café Bot ')).toBe('cafe-bot')
    expect(slugFrom('Research_Helper')).toBe('research_helper')
  })
  it('spells other letters as u<hex> tokens', () => {
    expect(slugFrom('猫')).toBe('u732b')
    expect(slugFrom('a猫b')).toBe('a-u732b-b')
  })
  it('cuts at 64 without splitting a token', () => {
    const slug = slugFrom('x'.repeat(60) + ' 猫猫')
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(isValidSlug(slug)).toBe(true)
    expect(slug).toBe('x'.repeat(60))
  })
  it('rejects names with no letter or number', () => {
    expect(isValidSlug(slugFrom('!!!'))).toBe(false)
  })
})

describe('titleFor', () => {
  it('keeps a typed name unless it reads like the id', () => {
    expect(titleFor('Café Bot')).toBe('Café Bot')
    expect(titleFor('helper')).toBe('')
  })
})

describe('composeSoul', () => {
  const roster = [bot({ name: 'nova', description: 'writes' }), bot({ name: 'ghost', hidden: true })]
  it('builds an identity and the messaging section', () => {
    const soul = composeSoul({ name: 'cafe-bot', title: 'Café Bot', description: 'Coffee', customSoul: '', serverInjectsProtocol: false, roster })
    expect(soul).toContain('# Café Bot')
    expect(soul).toContain('**Mission:** Coffee')
    expect(soul).toContain('## Messaging other agents')
    expect(soul).toContain('- `nova` — writes')
    expect(soul).not.toContain('ghost')
  })
  it('leaves the section to a Hermes that adds it', () => {
    const soul = composeSoul({ name: 'x', title: '', description: '', customSoul: 'Be kind.', serverInjectsProtocol: true, roster })
    expect(soul).toBe('Be kind.')
  })
})

describe('createParams', () => {
  const draft = { name: 'x', description: '', soul: '', provider: 'openrouter', model: '', cloneFrom: 'default', shareAuth: true, noSkills: false }
  it('pins a model only with provider and model both', () => {
    expect(createParams('x', '', 's', draft).model).toBeUndefined()
    const both = createParams('x', '', 's', { ...draft, model: 'm' })
    expect([both.provider, both.model, both.clone_from]).toEqual(['openrouter', 'm', 'default'])
  })
  it('a fresh profile clones nothing', () => {
    expect(createParams('x', '', 's', { ...draft, cloneFrom: '' }).clone_from).toBeUndefined()
  })
  it('reads the outcome', () => {
    expect(modelPinned({ model: 'm' }, { model_set: false })).toBe(false)
    expect(modelPinned({ model: 'm' }, {})).toBe(true)
    expect(needsModel({ ok: false })).toBe(true)
    expect(needsModel(null)).toBe(false)
  })
})

describe('duplicate', () => {
  it('takes the first free -N', () => {
    expect(duplicateName('nova', ['nova', 'Nova-2'])).toBe('nova-3')
    expect(duplicateName('y'.repeat(64), [])?.length).toBe(64)
  })
  it('drops chat, created, hidden and pinned, and titles the copy', () => {
    const meta = duplicateMeta(bot({ meta: { title: 'Nova', chat: 'c', created: 1, pinned: true, hidden: true, face: 3, imageKind: 'photo' } }), false)
    expect(meta).toEqual({ title: 'Nova (copy)', face: 3 })
  })
})

it('hands out the first free face and keeps the main profile', () => {
  expect(nextFreeFace([{ face: 0 }, { face: 1 }, { face: 3 }] as Bot[])).toBe(2)
  expect(canDelete(bot({ name: 'default' }))).toBe(false)
  expect(canDelete(bot({ name: 'nova' }))).toBe(true)
})
