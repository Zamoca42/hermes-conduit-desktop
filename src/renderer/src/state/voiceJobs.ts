/**
 * Background jobs from a live call, after the phone's VoiceBackgroundJobs:
 * the model hands longer work to Hermes in a chat of its own (start_job)
 * and keeps talking. Each job is an ordinary Hermes session
 * (`session.create` + `prompt.submit`), so it shows in the chat list and
 * opens like any chat. At most three run at once. A finished job's reply
 * comes back to the call as an update, told when the conversation is
 * quiet; a job still running when the call ends keeps running, its result
 * left in its chat.
 *
 * Desktop calls always belong to the chat on screen, where ask_thread goes:
 * start_job is for work the user wants kept apart from it.
 */
import { gateway } from '../gateway'
import { namingFiles } from './media'
import { correctTurn, type Correction } from './localLive'
import { STATUS_PATH, pluginStatus, serves } from './plugin'

const withProfile = (path: string, profile?: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

/** The plugin keeps a voice call's jobs in its bot's Work panel (notifier `work-adopt`). */
export const ADOPT_CAPABILITY = 'work-adopt'
export const ADOPT_PATH = '/api/plugins/conduit_push/workstreams/adopt'

/**
 * Keeps a job in its bot's registry once Hermes took its request, fire and
 * forget, sent once more after a failure, as the phone does: the Work panel
 * lists it as a voice call's. The plugin knows calls as "phone" or "watch".
 */
export async function adoptJob(profile: string | undefined, sessionId: string, title: string, goal: string): Promise<boolean> {
  const status = await gateway.http('GET', withProfile(STATUS_PATH, profile), undefined, 15_000).then(pluginStatus, () => null)
  if (!status || !serves(status, [ADOPT_CAPABILITY])) return false
  const body = { session_id: sessionId, title, via: 'phone', goal: goal.slice(0, 2_000) }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await gateway.http('POST', withProfile(ADOPT_PATH, profile), body, 15_000)
      return true
    } catch {
      if (attempt === 1) await new Promise(resolve => setTimeout(resolve, 3_000))
    }
  }
  return false
}

export const START_JOB = 'start_job'
export const LIST_JOBS = 'list_jobs'
export const CANCEL_JOB = 'cancel_job'
export const INTERRUPT_JOB = 'interrupt_job'
export const MAX_ACTIVE_JOBS = 3
const MAX_RESULT_CHARACTERS = 6_000
const MAX_TITLE = 60

export const JOB_TOOL_SPECS = [
  {
    name: START_JOB,
    description:
      'Start a background job on the user\'s Hermes agent, in a chat of its own, for work that takes more than a moment and that the user wants kept apart from this chat: when they say "in the background", "as a background job" or "in a separate chat". Everything else that needs Hermes goes to ask_thread. Its result arrives later on this call. Do not describe job progress unless asked.',
    parameters: {
      type: 'object',
      properties: { instructions: { type: 'string', description: "The complete task for Hermes, in the user's words plus any needed context." } },
      required: ['instructions']
    }
  },
  {
    name: LIST_JOBS,
    description: "List the user's background jobs from this call and their status. Call only when the user asks about their jobs.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: CANCEL_JOB,
    description: 'Cancel a background job when the user asks. Pass job_id from list_jobs to cancel one job, or omit it to cancel every running job.',
    parameters: { type: 'object', properties: { job_id: { type: 'string', description: "The job's id from list_jobs. Omit to cancel all running jobs." } } }
  },
  {
    name: INTERRUPT_JOB,
    description:
      'Pass the user\'s words into a background job Hermes is still working on, when they correct it, change it, pause it or call it off (for example "wait, make it Alex", "hold that for a minute", "never mind"). Hermes takes them in at once, keeps its work so far and decides what they mean; the job\'s result still arrives later on this call. Pass job_id from list_jobs and the user\'s words as they said them. Not for new requests.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: "The job's id from list_jobs." },
        message: { type: 'string', description: "The user's words about the job, as they said them." },
        kind: {
          type: 'string',
          enum: ['add', 'change'],
          description: 'add when the user adds to the work without changing it; change when they correct, pause, or cancel it. Omit when uncertain.'
        }
      },
      required: ['job_id', 'message']
    }
  }
]

export const JOBS_RULE =
  '\nWhen the user asks for work in the background or in a separate chat, call start_job instead of ask_thread, acknowledge it out loud, and carry on; its result arrives later on this call. When it arrives, tell the user what the job found or did.'

/** Words that keep a request apart from the chat, as the phone's VoiceJobRouting.backgroundPhrases. */
const BACKGROUND_PHRASES = [
  'in the background',
  'as a background job',
  'in a background job',
  'start a background job',
  'in a separate chat',
  'in a new chat',
  '在后台',
  '后台运行',
  '后台任务'
]
export const asksForBackground = (text: string) => {
  const folded = text.toLowerCase().replace(/\s+/g, ' ')
  return BACKGROUND_PHRASES.some(phrase => folded.includes(phrase))
}

/** GPT-Live delegates; its words decide where the work goes. */
export const DELEGATED_JOBS_RULE =
  'Each delegation goes to the chat this call is attached to, unless the user asks for the work in the background or in a separate chat: then say "in the background" or "in a separate chat" in the delegation, and Conduit runs it as a background job in a chat of its own. Its result arrives later on that delegation.'

/** GPT-Live's follow-ups to a running job: "Job 2: make it Alex", or "Add to job 2: …". */
export const DELEGATED_JOB_FOLLOW_UPS =
  'When the user corrects, changes, pauses or calls off a background job that is still running ("wait, make it Alex", "hold that", "never mind"), delegate their words right away, starting with "Job" and its number, like "Job 2: make it Alex": Conduit puts them into that job at once, Hermes decides what they mean, and the job\'s result still arrives on its earlier delegation. When the user only adds to the running job without changing it, start the delegation "Add to job 2:" with its number instead.'

/** The job id and words of "Job 2: …" or "Add to job 2: …" at the start of a delegation; null when it isn't one. */
export function jobFollowUpMarker(request: string): { jobId: string; words: string } | null {
  const m = /^\s*(?:add\s+to\s+)?job\s*#?\s*(\d{1,2})\s*:([\s\S]*)$/i.exec(request)
  return m ? { jobId: `job-${Number(m[1])}`, words: m[2]!.trim() } : null
}

/** Said on a delegation that started a job. */
export const JOB_STARTED =
  "[Started as a background job in a chat of its own: tell the user in a few words that it's running. Its result follows on this delegation; don't guess it.]"

export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface VoiceJob {
  id: string
  title: string
  status: JobStatus
  /** The job's live session, for its events. */
  sid?: string
  reply?: string
  error?: string
}

/** A job's title: its task's first words, one line. */
export function jobTitle(instructions: string): string {
  const line = instructions.split(/\s+/).filter(Boolean).join(' ')
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line
}

/** A finished job's reply for the model, as the phone's completionPrompt. */
export function completionPrompt(title: string, result: string): string {
  const named = namingFiles(result)
  const clipped = named.length > MAX_RESULT_CHARACTERS ? `${named.slice(0, MAX_RESULT_CHARACTERS)}\n[…]` : named
  return `[Background job "${title}" finished. Its final message is below. Tell the user what it found or did, in the language we have been speaking: the substance, with the details that matter, not just a headline. Skip what doesn't work by ear, like code, long tables or links; those stay in the job's chat.]\n\n${clipped}`
}

export const failurePrompt = (title: string, error: string) => `[Background job "${title}" failed: ${error.slice(0, 300)}. Tell the user in a sentence.]`

export function statusSummary(jobs: VoiceJob[]): string {
  if (!jobs.length) return 'No background jobs are running.'
  return jobs
    .map(job =>
      job.status === 'running'
        ? `${job.title} is still running.`
        : job.status === 'done'
          ? `${job.title} has finished.`
          : job.status === 'failed'
            ? `${job.title} failed.`
            : `${job.title} was cancelled.`
    )
    .join(' ')
}

export function listResult(jobs: VoiceJob[]): Record<string, string> {
  const result: Record<string, string> = { summary: statusSummary(jobs) }
  jobs.forEach((job, i) => (result[`job_${i + 1}`] = `id=${job.id}; title=${job.title}; status=${job.status}`))
  return result
}

type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>
type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One call's jobs. `onChange` redraws the call screen; `onOutcome` hands a
 * settled job's notice to the call, which tells it at the next quiet moment.
 */
export class VoiceJobs {
  jobs: VoiceJob[] = []
  private count = 0
  private text = new Map<string, string>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private profile: string | undefined,
    private onChange: (jobs: VoiceJob[]) => void,
    private onOutcome: (notice: string, job: VoiceJob) => void,
    private rpc: Rpc = (method, params) => gateway.rpc(method, params),
    listen: (handler: (event: { type: string; session_id?: string; payload?: unknown }) => void) => () => void = handler => window.conduit.onEvent(handler),
    private correct: (sessionId: string, text: string, profile?: string) => Promise<Correction> = correctTurn,
    private adopt: (profile: string | undefined, sessionId: string, title: string, goal: string) => Promise<boolean> = adoptJob
  ) {
    this.unsubscribe = listen(event => this.event(event))
  }

  /** The call ended: running jobs go on in their chats, but nothing more is told here. */
  dispose() {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private update(id: string, change: Partial<VoiceJob>) {
    this.jobs = this.jobs.map(job => (job.id === id ? { ...job, ...change } : job))
    this.onChange(this.jobs)
  }

  async start(instructions: string): Promise<Record<string, string>> {
    const task = instructions.trim()
    if (!task) return { status: 'error', error: 'instructions is required' }
    if (this.jobs.filter(j => j.status === 'running').length >= MAX_ACTIVE_JOBS)
      return { status: 'error', error: `${MAX_ACTIVE_JOBS} background jobs are already running. Tell the user to wait for one to finish, or cancel one.` }
    const id = `job-${++this.count}`
    const job: VoiceJob = { id, title: jobTitle(task), status: 'running' }
    this.jobs = [...this.jobs, job]
    this.onChange(this.jobs)
    try {
      const params: Row = { cols: 96, source: 'desktop', title: job.title }
      if (this.profile) params.profile = this.profile
      const made = (await this.rpc('session.create', params)) as Row
      const sid = str(made?.session_id)
      if (!sid) throw new Error('Hermes made no session for the job.')
      this.update(id, { sid })
      const submit: Row = { session_id: sid, text: task }
      if (this.profile) submit.profile = this.profile
      await this.rpc('prompt.submit', submit)
      // Hermes took the request: its bot's Work panel keeps it as a call's.
      void this.adopt(this.profile, str(made.stored_session_id) ?? sid, job.title, task).catch(() => false)
    } catch (e) {
      this.update(id, { status: 'failed', error: message(e) })
      return { status: 'error', error: `The job couldn't start: ${message(e)}. Tell the user in a few words.` }
    }
    return {
      status: 'started',
      job_id: id,
      message: "The job is running in a chat of its own. Acknowledge it in a few words; its result arrives later on this call, so don't guess it."
    }
  }

  list(): Record<string, string> {
    return listResult(this.jobs)
  }

  async cancel(jobId?: string): Promise<Record<string, string>> {
    const targets = this.jobs.filter(j => j.status === 'running' && (!jobId || j.id === jobId.trim()))
    if (!targets.length) return { message: jobId ? 'Unknown job_id. Call list_jobs for the jobs’ ids.' : 'There are no background jobs to cancel.' }
    for (const job of targets) {
      this.update(job.id, { status: 'cancelled' })
      if (job.sid) await this.rpc('session.interrupt', { session_id: job.sid, ...(this.profile ? { profile: this.profile } : {}) }).catch(() => undefined)
    }
    return { message: targets.length === 1 ? `Cancelled ${targets[0]!.title}.` : `Cancelled ${targets.length} background jobs.` }
  }

  /** The user's words put into a running job: redirected now, or taken after the step Hermes is finishing. */
  async followUp(jobId: string, words: string): Promise<Record<string, string>> {
    const text = words.trim()
    const job = this.jobs.find(j => j.id === jobId.trim())
    if (!job) return { status: 'error', error: 'Unknown job_id. Call list_jobs for the jobs\u2019 ids. For work in the attached chat, use ask_thread.' }
    if (!text) return { status: 'error', error: 'message is required' }
    const quoted = `"${job.title}"`
    if (job.status !== 'running' || !job.sid)
      return { status: 'not_sent', message: `${quoted} had already finished, so Hermes didn't get this. Tell the user, and ask what they want instead.` }
    let outcome: Correction
    try {
      outcome = await this.correct(job.sid, `(voice) ${text}`, this.profile)
    } catch (e) {
      return { status: 'not_sent', error: message(e) }
    }
    if (outcome === 'redirected')
      return {
        status: 'sent',
        message: `Hermes took the user's words into ${quoted} at once and changes course now. Tell the user in a few words; the result still comes back later on this call, so don't guess it.`
      }
    if (outcome === 'queued')
      return {
        status: 'sent',
        message: `Hermes takes the user's words into ${quoted} right after the step it is finishing. Tell the user in a few words; the result still comes back later on this call, so don't guess it.`
      }
    return { status: 'not_sent', message: `${quoted} had already finished, so Hermes didn't get this. Tell the user, and ask what they want instead.` }
  }

  private event(event: { type: string; session_id?: string; payload?: unknown }) {
    const job = this.jobs.find(j => j.sid && j.sid === event.session_id)
    if (!job || job.status !== 'running') return
    const payload = (event.payload ?? {}) as Row
    if (event.type === 'message.delta') {
      this.text.set(job.id, (this.text.get(job.id) ?? '') + (str(payload.text) ?? ''))
      return
    }
    // An error notice may come before the turn ends: kept, and said if the turn then fails.
    if (event.type === 'error') {
      this.update(job.id, { error: str(payload.message) ?? str(payload.error) })
      return
    }
    if (event.type !== 'message.complete') return
    const status = str(payload.status)
    if (status === 'interrupted') return this.update(job.id, { status: 'cancelled' })
    if (status === 'error') {
      const error = str(payload.error) ?? str(payload.failure_reason) ?? job.error ?? 'the turn failed'
      this.update(job.id, { status: 'failed', error })
      this.onOutcome(failurePrompt(job.title, error), job)
      return
    }
    const reply = (str(payload.text) ?? str(payload.rendered) ?? this.text.get(job.id) ?? '').trim()
    this.update(job.id, { status: 'done', reply })
    this.onOutcome(
      reply
        ? completionPrompt(job.title, reply)
        : `[Background job "${job.title}" finished without a written reply. Tell the user in one short sentence that it's done and its chat shows what happened.]`,
      job
    )
  }
}
