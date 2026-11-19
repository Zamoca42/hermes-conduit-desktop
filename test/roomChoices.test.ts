import { describe, expect, it } from 'vitest'
import { CHOICES_PATH, REMOVE_PATH, canTakeOut, clippedNote, parseAgentChoices, roomChoicesClient, takeOutMessage } from '../src/renderer/src/state/roomChoices'

const plain = { tools: 'look', share: 'helps', search_chats: false, note: '' }

describe('Group Info’s people in a room with other people’s agents', () => {
  it('reads an agent’s choices, defaults included, for its own room only', () => {
    expect(parseAgentChoices({ ok: true, room_id: 'r', saved: false, choices: plain }, 'r')).toMatchObject({ tools: 'look', saved: false, runWork: null })
    expect(parseAgentChoices({ ok: true, choices: { ...plain, run_work: true } }, 'r')).toMatchObject({ saved: true, runWork: true })
    expect(parseAgentChoices({ ok: true, room_id: 'other', choices: plain }, 'r')).toBeNull()
    expect(parseAgentChoices({ ok: true, room_id: 'r', choices: { tools: 'look' } }, 'r')).toBeNull()
  })

  it('reads and changes them on the agent’s own profile, and takes another person’s agent out', async () => {
    const calls: unknown[] = []
    const client = roomChoicesClient((async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      return path === REMOVE_PATH ? { ok: true } : { ok: true, room_id: 'r 1', choices: plain }
    }) as never)
    await client.read('r 1', 'work')
    await client.set('r 1', 'default', { share: 'ask' })
    expect(await client.remove('r 1', 'm1')).toBe('done')
    expect(calls).toEqual([
      ['GET', `${CHOICES_PATH}?room_id=r%201&profile=work`, undefined],
      ['PUT', CHOICES_PATH, { room_id: 'r 1', choices: { share: 'ask' } }],
      ['POST', REMOVE_PATH, { room_id: 'r 1', member: 'm1' }]
    ])
    const slow = roomChoicesClient((async () => {
      throw Object.assign(new Error('timed out'), { code: 504 })
    }) as never)
    expect(await slow.remove('r', 'm')).toBe('sending')
  })

  it('takes out another person’s agent from your room, or yours from theirs while it goes on', () => {
    expect(canTakeOut({ memberId: 'm', peer: true }, null)).toBe(true)
    expect(canTakeOut({ memberId: 'm', profile: 'default' }, null)).toBe(false)
    expect(canTakeOut({ memberId: 'm', peer: true, out: 'left' }, null)).toBe(false)
    expect(canTakeOut({ memberId: 'm', profile: 'default' }, { over: false })).toBe(true)
    expect(canTakeOut({ memberId: 'm', profile: 'default' }, { over: true })).toBe(false)
    expect(takeOutMessage('Scout', { memberId: 'm', owner: 'Bo' }, null)).toBe("Scout stops taking part, and Bo's Hermes is told.")
    expect(takeOutMessage('Scout', { memberId: 'm' }, 'Ana')).toBe('Scout stops taking part, and Ana is told.')
  })

  it('keeps a note to 1,000 characters, never half of one', () => {
    expect(clippedNote('a'.repeat(1001))).toHaveLength(1000)
    expect(Array.from(clippedNote('😀'.repeat(1001)))).toHaveLength(1000)
  })
})
