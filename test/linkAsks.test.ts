import { describe, expect, it } from 'vitest'
import { LINK_RULES_PATH, freeOnTitle, linkAsksClient, parseRulesList, questionsTitle, rulesCaption } from '../src/renderer/src/state/linkAsks'

describe('what linked people can ask', () => {
  it('reads each Link’s rules, leaving out rows it can’t read', () => {
    const list = parseRulesList({
      ok: true,
      links: [
        { id: 'L1', name: ' Ana ', status: 'linked', rules: { free_on: 'ask', questions: 'off', profile: 'default' } },
        { id: 'L2', name: 'Bo', status: 'linked', rules: { free_on: 'ask', questions: 'ask' } },
        { id: '', name: 'Cy', status: 'linked', rules: { free_on: 'ask', questions: 'ask', profile: 'p' } },
        'garbled'
      ]
    })
    expect(list).toEqual([{ id: 'L1', name: 'Ana', status: 'linked', rules: { freeOn: 'ask', questions: 'off', profile: 'default' } }])
    expect(parseRulesList({ ok: false, links: [] })).toBeNull()
  })

  it('changes one rule and takes the Link’s rules back', async () => {
    const calls: unknown[] = []
    const client = linkAsksClient((async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      return { ok: true, id: 'L1', rules: { free_on: 'times', questions: 'ask', profile: 'work' } }
    }) as never)
    expect(await client.set('L1', { free_on: 'times' })).toEqual({ freeOn: 'times', questions: 'ask', profile: 'work' })
    expect(calls).toEqual([['PUT', LINK_RULES_PATH, { free_on: 'times', link_id: 'L1' }]])
    const wrong = linkAsksClient((async () => ({ ok: true, id: 'other', rules: { free_on: 'ask', questions: 'ask', profile: 'p' } })) as never)
    await expect(wrong.set('L1', { questions: 'off' })).rejects.toThrow()
  })

  it('names the choices and says how each is answered', () => {
    expect(freeOnTitle('yes_no')).toBe("Say if you're free")
    expect(freeOnTitle('later')).toBe('later')
    expect(questionsTitle('off')).toBe("Don't answer")
    expect(rulesCaption({ freeOn: 'off', questions: 'off', profile: 'p' }, 'Ana', 'Work')).toBe(
      "Your Hermes doesn't say whether you're free. Your Hermes turns Ana's questions away."
    )
    expect(rulesCaption({ freeOn: 'ask', questions: 'ask', profile: 'p' }, 'Ana', 'Work')).toContain('shares with Work')
  })
})
