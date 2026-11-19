import { describe, expect, it } from 'vitest'
import { canJoin, canPick, canRemove, choicesBody, dailyLimitSteps, inviteRows, joiningAgents, parseInvite, parseInvites } from '../src/renderer/src/state/roomInvites'
import { ceilingToSave, changesSavedCeiling, mcpServersToSave, parseSetup } from '../src/renderer/src/state/roomSetup'

const choices = { tools: 'talk', share: 'ask', search_chats: false, takes_part: 'joins', daily_limit: 40, note: '' }
const wire = (more: Record<string, unknown> = {}) => ({
  room_id: 'r1',
  link: 'L1',
  from: 'Ana',
  name: 'Trip',
  status: 'waiting',
  slots: 2,
  expires_at: 1795701392,
  agents: [{ display_name: 'Hermes' }],
  profiles: [{ profile: 'default', choices }, { profile: 'bad', choices: { tools: 'talk' } }],
  ...more
})

describe('invites to rooms people you’ve linked host', () => {
  it('reads an invite and the bots that can join, leaving out one it can’t show', () => {
    const invite = parseInvite(wire())!
    expect(invite.id).toBe('L1/r1')
    expect(invite.profiles).toEqual(['default'])
    expect(invite.choices.default).toEqual({ tools: 'talk', customTools: [], share: 'ask', searchChats: false, takesPart: 'joins', dailyLimit: 40, note: '', runWork: null })
    expect(invite.hostAgents).toEqual(['Hermes'])
    expect(parseInvites({ ok: true, invites: [wire(), { link: 'L', name: 'no room', status: 'waiting' }] })).toHaveLength(1)
  })

  it('lists those waiting and those that ended until removed', () => {
    const list = ['waiting', 'joined', 'started', 'declined', 'left', 'ended', 'brand_new'].map(status => parseInvite(wire({ room_id: status, status }))!)
    expect(inviteRows(list, new Set()).map(i => i.status)).toEqual(['waiting', 'joined', 'started', 'ended'])
    expect(inviteRows(list, new Set(['L1/started'])).map(i => i.status)).toEqual(['waiting', 'joined', 'ended'])
    const removed = parseInvite(wire({ status: 'ended', removed: true }))!
    expect(inviteRows([removed], new Set())).toEqual([])
    expect(canRemove(list[0]!)).toBe(false)
    expect(canRemove(list[2]!)).toBe(true)
  })

  it('brings no more bots than the invite has places, nor five', () => {
    expect(canPick(1, 2)).toBe(true)
    expect(canPick(2, 2)).toBe(false)
    expect(canPick(5, 9)).toBe(false)
    expect(canJoin(0, 2)).toBe(false)
    expect(canJoin(2, 2)).toBe(true)
    expect(dailyLimitSteps(33)).toEqual([5, 10, 20, 33, 40, 80, 150, 300, 500])
  })

  it('sends each bot with its handle and every choice', () => {
    const c = parseInvite(wire())!.choices.default!
    expect(joiningAgents([{ name: 'default', title: 'Hermes' }], { default: c })).toEqual([
      { profile: 'default', handle: 'hermes', display_name: 'Hermes', choices: choicesBody(c) }
    ])
    expect(choicesBody(c)).not.toHaveProperty('run_work')
    expect(choicesBody({ ...c, runWork: true }).run_work).toBe(true)
    expect(joiningAgents([{ name: 'default', title: 'A' }, { name: 'Default', title: 'B' }], { default: c, Default: c })).toBeNull()
    expect(joiningAgents([{ name: 'ops', title: 'Ops' }], {})).toBeNull()
  })
})

describe('setting a profile up for rooms', () => {
  const state = parseSetup({
    ok: true,
    ready: true,
    needs: [],
    api_server: { address: '127.0.0.1:8643', running: true },
    ceiling: ['web', 'vision'],
    choices: [{ id: 'web', label: 'Web' }, { id: 'vision', label: 'Vision' }, { id: 'terminal', label: 'Terminal' }],
    mcp_servers: ['files', 'old'],
    mcp_choices: [{ id: 'files' }, { id: 'calendar' }]
  })

  it('saves the tools only when they changed, in the plugin’s order', () => {
    expect(state.choices.map(c => c.lookup)).toEqual([true, true, false])
    expect(ceilingToSave(state, new Set(['vision', 'web']))).toBeNull()
    expect(ceilingToSave(state, new Set(['terminal', 'web']))).toEqual(['web', 'terminal'])
  })

  it('keeps an MCP server it can’t name as it was saved', () => {
    expect(mcpServersToSave(state, new Set(['files', 'old']))).toBeNull()
    expect(mcpServersToSave(state, new Set(['calendar']))).toEqual(['calendar', 'old'])
    expect(changesSavedCeiling(state, new Set(['web', 'vision']), new Set(['files']))).toBe(false)
    expect(changesSavedCeiling(state, new Set(['web']), new Set(['files']))).toBe(true)
  })
})
