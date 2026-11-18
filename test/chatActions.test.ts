import { describe, expect, it } from 'vitest'
import { identityFields, mutateSession, sessionPath, warrantsRetry, withQuery } from '../src/renderer/src/state/chatActions'
import { httpErrorText } from '../src/main/connection'

describe('a chat row’s Pin, Rename and Delete', () => {
  it('go to the chat under its profile', () => {
    expect(sessionPath('a b', 'work', '/mutation-snapshot')).toBe('/api/sessions/a%20b/mutation-snapshot?profile=work')
    expect(sessionPath('s1', 'default')).toBe('/api/sessions/s1')
  })

  it('carry the revision the snapshot named', () => {
    expect(identityFields({ runtime_revision: 4, runtime_generation: 2 }, 'r')).toEqual({ request_id: 'r', expected_revision: 4, expected_generation: 2 })
    expect(identityFields({ runtime_revision: -1 }, 'r')).toBeNull()
    expect(identityFields(null, 'r')).toBeNull()
    expect(withQuery('/api/sessions/s1?profile=w', { request_id: 'r-1', expected_revision: 4 })).toBe('/api/sessions/s1?profile=w&expected_revision=4&request_id=r-1')
  })

  it('try once more when the chat moved on in between', async () => {
    const calls: [string, string, unknown][] = []
    let refusals = 1
    const http = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push([method, path, body])
      if (method === 'GET') return { runtime_revision: calls.length } as T
      if (refusals-- > 0) throw Object.assign(new Error('revision_conflict: the session changed'), { code: 409 })
      return {} as T
    }
    await mutateSession(http, 's1', 'work', { pinned: true })
    expect(calls.map(c => c[0])).toEqual(['GET', 'PATCH', 'GET', 'PATCH'])
    expect(calls[3]![2]).toMatchObject({ pinned: true, profile: 'work', expected_revision: 3 })

    calls.length = 0
    await mutateSession(http, 's1', undefined, null)
    expect(calls[1]![0]).toBe('DELETE')
    expect(calls[1]![1]).toMatch(/^\/api\/sessions\/s1\?expected_revision=1&request_id=/)
  })

  it('write without a revision on a host that has no snapshot', async () => {
    const calls: string[] = []
    const http = async <T,>(method: string, path: string): Promise<T> => {
      calls.push(`${method} ${path}`)
      if (method === 'GET') throw Object.assign(new Error('Not Found'), { code: 404 })
      return {} as T
    }
    await mutateSession(http, 's1', undefined, { title: 'New' })
    expect(calls).toEqual(['GET /api/sessions/s1/mutation-snapshot', 'PATCH /api/sessions/s1'])
    expect(warrantsRetry(Object.assign(new Error('Not Found'), { code: 404 }))).toBe(false)
  })

  it('reads Hermes’ refusal whether its detail is words or a code', () => {
    expect(httpErrorText('session not found', 404)).toBe('session not found')
    expect(httpErrorText({ code: 'revision_conflict', message: 'moved on' }, 409)).toBe('revision_conflict: moved on')
    expect(httpErrorText(null, 500)).toBe('HTTP 500')
  })
})
