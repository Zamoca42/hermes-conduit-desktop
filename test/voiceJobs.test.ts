import { describe, expect, it } from 'vitest'
import { VoiceJobs, completionPrompt, jobTitle, listResult, type VoiceJob } from '../src/renderer/src/state/voiceJobs'

type Event = { type: string; session_id?: string; payload?: unknown }

function setup(fail = false) {
  const calls: [string, Record<string, unknown>][] = []
  let handler: (event: Event) => void = () => {}
  const changes: VoiceJob[][] = []
  const told: string[] = []
  let n = 0
  const jobs = new VoiceJobs(
    'work',
    list => changes.push(list),
    notice => told.push(notice),
    async (method, params) => {
      calls.push([method, params])
      if (fail && method === 'prompt.submit') throw new Error('HTTP 500')
      return method === 'session.create' ? { session_id: `s${++n}` } : {}
    },
    h => {
      handler = h
      return () => (handler = () => {})
    }
  )
  return { jobs, calls, changes, told, emit: (e: Event) => handler(e) }
}

describe('background jobs from a call', () => {
  it('starts a job in a chat of its own and tells its reply', async () => {
    const { jobs, calls, told, emit } = setup()
    const started = await jobs.start('Research the best GPU for training')
    expect(started).toMatchObject({ status: 'started', job_id: 'job-1' })
    expect(calls).toEqual([
      ['session.create', { cols: 96, source: 'desktop', title: 'Research the best GPU for training', profile: 'work' }],
      ['prompt.submit', { session_id: 's1', text: 'Research the best GPU for training', profile: 'work' }]
    ])
    emit({ type: 'message.delta', session_id: 'other', payload: { text: 'nope' } })
    emit({ type: 'message.delta', session_id: 's1', payload: { text: 'The 5090, ' } })
    emit({ type: 'message.delta', session_id: 's1', payload: { text: 'see MEDIA:/tmp/x/gpus.csv' } })
    emit({ type: 'message.complete', session_id: 's1', payload: {} })
    expect(jobs.jobs[0]).toMatchObject({ status: 'done', reply: 'The 5090, see MEDIA:/tmp/x/gpus.csv' })
    expect(told).toHaveLength(1)
    expect(told[0]).toContain('Background job "Research the best GPU for training" finished')
    expect(told[0]).toContain('(a file in the chat: gpus.csv)')
  })

  it('holds three at once, lists and cancels them', async () => {
    const { jobs, calls } = setup()
    for (const task of ['a', 'b', 'c']) await jobs.start(task)
    expect((await jobs.start('d')).error).toMatch(/3 background jobs/)
    expect(jobs.list()).toMatchObject({ summary: 'a is still running. b is still running. c is still running.', job_2: 'id=job-2; title=b; status=running' })
    expect((await jobs.cancel('job-2')).message).toBe('Cancelled b.')
    expect(calls.at(-1)).toEqual(['session.interrupt', { session_id: 's2', profile: 'work' }])
    expect((await jobs.cancel()).message).toBe('Cancelled 2 background jobs.')
    expect((await jobs.cancel()).message).toBe('There are no background jobs to cancel.')
  })

  it('says a failure, at start or at the end of the turn', async () => {
    const { jobs } = setup(true)
    expect((await jobs.start('x')).error).toMatch(/couldn't start: HTTP 500/)
    expect(jobs.jobs[0]!.status).toBe('failed')
    const second = setup()
    await second.jobs.start('y')
    second.emit({ type: 'error', session_id: 's1', payload: { message: 'Provider refused' } })
    expect(second.jobs.jobs[0]!.status).toBe('running')
    second.emit({ type: 'message.complete', session_id: 's1', payload: { status: 'error' } })
    expect(second.told[0]).toBe('[Background job "y" failed: Provider refused. Tell the user in a sentence.]')
  })

  it('keeps titles to one short line and clips long results', () => {
    expect(jobTitle('one\ntwo   three')).toBe('one two three')
    expect(jobTitle('x'.repeat(80))).toHaveLength(60)
    expect(completionPrompt('t', 'y'.repeat(7000))).toMatch(/\n\[…\]$/)
    expect(listResult([])).toEqual({ summary: 'No background jobs are running.' })
  })
})

describe("GPT-Live's background words", () => {
  it('runs a delegation as a job only when the user asks for one', async () => {
    const { asksForBackground } = await import('../src/renderer/src/state/voiceJobs')
    expect(asksForBackground('Research GPUs in the background')).toBe(true)
    expect(asksForBackground('Do it in a  separate chat please')).toBe(true)
    expect(asksForBackground('在后台运行这个')).toBe(true)
    expect(asksForBackground('What is in the background of this photo?')).toBe(true)
    expect(asksForBackground('Check the repo')).toBe(false)
  })
})
