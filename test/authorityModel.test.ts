import { describe, expect, it } from 'vitest'
import { authorityModelPick, moveChat } from '../src/renderer/src/state/chatActions'

function host(answers: unknown[]) {
  const sent: Record<string, unknown>[] = []
  const rpc = async <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
    expect(method).toBe('session.mutate')
    sent.push(params!)
    const answer = answers.shift()
    if (answer instanceof Error) throw answer
    return answer as T
  }
  let revision = 4
  const http = async <T,>(): Promise<T> => ({ runtime_revision: revision++, runtime_generation: 9 }) as T
  return { rpc, http, sent }
}

describe('a model pick on the session authority', () => {
  it('goes as a fenced model mutation', async () => {
    const h = host([{ model: 'gpt-5.5', revision: 5 }])
    const pick = await authorityModelPick(h.rpc, h.http, 'local-1', 'nahida', 'gpt-5.5', 'openai', false)
    expect(pick).toEqual({ model: 'gpt-5.5', confirmRequired: false, confirmMessage: '', deferred: false })
    expect(h.sent[0]).toMatchObject({ session_id: 'local-1', operation: 'model', payload: { model: 'gpt-5.5', provider: 'openai' }, expected_revision: 4, expected_generation: 9, profile: 'nahida' })
  })

  it('sends back the confirm token for a guarded model, and only on the confirmed pick', async () => {
    const h = host([
      { confirm_required: true, confirm: 'tok-1', confirm_message: 'This model is expensive.', target_model: 'o9-pro' },
      { model: 'o9-pro', deferred: true }
    ])
    const first = await authorityModelPick(h.rpc, h.http, 'local-2', undefined, 'o9', 'openai', false)
    expect(first).toEqual({ model: 'o9-pro', confirmRequired: true, confirmMessage: 'This model is expensive.', deferred: false })
    expect(h.sent[0]!.payload).toEqual({ model: 'o9', provider: 'openai' })
    expect(h.sent[0]!.profile).toBeUndefined()
    const second = await authorityModelPick(h.rpc, h.http, 'local-2', undefined, 'o9', 'openai', true)
    expect(h.sent[1]!.payload).toEqual({ model: 'o9', provider: 'openai', confirm: 'tok-1' })
    expect(second.deferred).toBe(true)
  })

  it('goes again once on a revision conflict, with a fresh snapshot', async () => {
    const h = host([new Error('revision_conflict'), {}])
    await moveChat(h.rpc, h.http, 'local-3', undefined, '/srv/app', true)
    expect(h.sent.map(p => p.expected_revision)).toEqual([4, 5])
    expect(h.sent[1]).toMatchObject({ operation: 'workspace', payload: { cwd: '/srv/app' } })
  })
})
