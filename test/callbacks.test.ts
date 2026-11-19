import { describe, expect, it, vi } from 'vitest'
import { CallBacks, callMeMarker, callbackScope, markedMessage, type Availability, type CallWork } from '../src/renderer/src/state/callbacks'
import { GatewayError } from '../src/renderer/src/gateway'

type Req = [string, string, unknown]

function setup(availability: Availability = 'available', answer: (req: Req) => unknown = () => ({ ok: true, status: 'watching', id: 'w1' })) {
  const requests: Req[] = []
  const notes: string[] = []
  const callbacks = new CallBacks(
    'work',
    note => notes.push(note),
    async (method, path, body) => {
      const req: Req = [method, path, body]
      requests.push(req)
      return answer(req)
    },
    async () => availability
  )
  return { callbacks, requests, notes }
}

const job = (key: string, running = true, sentAt = 1): CallWork => ({ key, title: `Job ${key}`, sessionId: `s-${key}`, running, sentAt, job: true })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('call me when it is done', () => {
  it('watches the newest running request, held while the call goes on', async () => {
    const { callbacks, requests } = setup()
    callbacks.sync([job('job-1', true, 1), job('job-2', true, 2)])
    const result = await callbacks.request({ kind: 'newest' })
    expect(result.status).toBe('will_call')
    expect(result.message).toContain('"Job job-2" is done')
    expect(requests).toHaveLength(1)
    const [method, path, body] = requests[0]!
    expect(method).toBe('POST')
    expect(path).toBe('/api/plugins/conduit_push/calls/watches?profile=work')
    expect(body).toMatchObject({ session_ids: ['s-job-2'], title: 'Job job-2', hold_s: 90 })
  })

  it('lets the hold go at hang-up so Hermes calls', async () => {
    const { callbacks, requests } = setup('available', ([method]) =>
      method === 'POST' ? { ok: true, status: 'watching', id: 'w1' } : { ok: true, status: 'watching' }
    )
    callbacks.sync([job('job-1')])
    await callbacks.request({ kind: 'newest' })
    await callbacks.hangUp()
    expect(requests.at(-1)).toEqual(['PUT', '/api/plugins/conduit_push/calls/watches/w1?profile=work', { hold_s: 0 }])
  })

  it('removes the watch when the work ends during the call, which tells it', async () => {
    const { callbacks, requests } = setup()
    callbacks.sync([job('job-1')])
    await callbacks.request({ kind: 'newest' })
    callbacks.sync([job('job-1', false)])
    await flush()
    expect(requests.at(-1)).toEqual(['DELETE', '/api/plugins/conduit_push/calls/watches/w1?profile=work', undefined])
    await callbacks.hangUp()
    expect(requests.filter(([m]) => m === 'PUT')).toHaveLength(0)
  })

  it('marks the next request when nothing runs yet', async () => {
    const { callbacks, requests } = setup()
    const result = await callbacks.request({ kind: 'newest' })
    expect(result.message).toContain('the next request this call sends to Hermes is done')
    expect(requests).toHaveLength(0)
    callbacks.sync([job('job-1', true, 5)])
    await flush()
    expect(requests).toHaveLength(1)
    // Only the next one.
    callbacks.sync([job('job-1', true, 5), job('job-2', true, 6)])
    await flush()
    expect(requests).toHaveLength(1)
  })

  it('marks all running work and later work with scope all', async () => {
    const { callbacks, requests } = setup()
    callbacks.sync([job('job-1'), job('job-2')])
    const result = await callbacks.request({ kind: 'all' })
    expect(result.message).toContain('each of "Job job-1", "Job job-2" is done')
    expect(requests).toHaveLength(2)
    callbacks.sync([job('job-1'), job('job-2'), job('job-3')])
    await flush()
    expect(requests).toHaveLength(3)
  })

  it('names a job, and says when it already ended or is unknown', async () => {
    const { callbacks } = setup()
    callbacks.sync([job('job-1', false), job('job-2')])
    expect((await callbacks.request({ kind: 'job', id: 'job-1' })).status).toBe('already_ended')
    expect((await callbacks.request({ kind: 'job', id: 'job-9' })).status).toBe('unknown_job')
    expect((await callbacks.request({ kind: 'job', id: 'job-2' })).status).toBe('will_call')
  })

  it('a request already sent counts for GPT-Live\'s "Call me:" with work', async () => {
    const { callbacks, requests } = setup()
    callbacks.sync([job('job-1', true, 1), job('chat', true, 100)])
    await callbacks.request({ kind: 'next', since: 50 })
    expect(requests[0]![2]).toMatchObject({ session_ids: ['s-chat'] })
  })

  it('tells the model why Hermes can’t call', async () => {
    const off = setup('calls_off')
    off.callbacks.sync([job('job-1')])
    const result = await off.callbacks.request({ kind: 'newest' })
    expect(result.status).toBe('unavailable')
    expect(result.message).toContain('calls are off')
    expect(off.requests).toHaveLength(0)
    const refused = setup('available', () => {
      throw new GatewayError('Too many jobs are waiting to call', 429)
    })
    refused.callbacks.sync([job('job-1')])
    expect((await refused.callbacks.request({ kind: 'newest' })).message).toContain('too many')
  })

  it('keeps no watch when the host saw the work end already', async () => {
    const { callbacks, requests } = setup('available', () => ({ ok: true, status: 'ended', outcome: 'done' }))
    callbacks.sync([job('job-1')])
    await callbacks.request({ kind: 'newest' })
    await callbacks.hangUp()
    expect(requests.map(([m]) => m)).toEqual(['POST'])
  })

  it('renews the hold while the call goes on', async () => {
    vi.useFakeTimers()
    try {
      const { callbacks, requests } = setup()
      callbacks.sync([job('job-1')])
      await callbacks.request({ kind: 'newest' })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(requests.at(-1)).toEqual(['PUT', '/api/plugins/conduit_push/calls/watches/w1?profile=work', { hold_s: 90 }])
      await callbacks.hangUp()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the markers and the tool arguments', () => {
    expect(callMeMarker('Call me: check the server')).toEqual({ scope: { kind: 'newest' }, rest: 'check the server' })
    expect(callMeMarker('call me about all:')).toEqual({ scope: { kind: 'all' }, rest: '' })
    expect(callMeMarker('Call me about job-2:')).toEqual({ scope: { kind: 'job', id: 'job-2' }, rest: '' })
    expect(callMeMarker('call me later maybe')).toBeNull()
    expect(callbackScope({ job_id: ' job-3 ' })).toEqual({ kind: 'job', id: 'job-3' })
    expect(callbackScope({ scope: 'all' })).toEqual({ kind: 'all' })
    expect(callbackScope({})).toEqual({ kind: 'newest' })
    expect(markedMessage([], 'all')).toContain('each request this call sends to Hermes from now on')
  })
})
