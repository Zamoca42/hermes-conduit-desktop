/**
 * "Call me when it's done" on a live call, after the phone's
 * VoiceBackgroundJobs.requestCallback and HermesCallsClient (#449): the
 * model marks the call's newest request (a background job, or the request
 * in the chat on screen), the job named, or all of them, and each marked
 * request gets a call watch on the Hermes host straight away, held while
 * the call goes on. Work that finishes during the call is told in the call
 * and its watch removed. At hang-up the holds are let go of, so the host
 * calls once the work is done; if Conduit can't say so, a hold lapses on
 * the host by itself. Hermes calls the user's iPhone, as for any call from
 * Hermes: Desktop only asks for it.
 */
import { gateway, GatewayError } from '../gateway'
import { jobTitle, type VoiceJob } from './voiceJobs'
import { STATUS_PATH, pluginStatus, serves } from './plugin'

const withProfile = (path: string, profile?: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

export const CALL_ME_WHEN_DONE = 'call_me_when_done'
export const CALLS_CAPABILITY = 'hermes-calls'
export const CALLS_PATH = '/api/plugins/conduit_push/calls'
export const WATCHES_PATH = `${CALLS_PATH}/watches`
/** How long a watch is held past a renewal, as the phone's callbackHoldSeconds. */
export const HOLD_SECONDS = 90
const RENEW_MS = 30_000
/** The plugin's own bounds (calls_store.py MAX_HOLD_S, RECENT_END_TTL_S). */
const MAX_ENDED_WITHIN = 30 * 60

export const CALLBACK_SPEC = {
  name: CALL_ME_WHEN_DONE,
  description:
    "Have Hermes call the user back on their phone once their request is done, after this call has ended. Use it when the user asks to be called, phoned or rung when it's done (\"call me when it's done\"). When they ask for new work and the call in the same breath, start the work first (ask_thread or start_job), then call this. It covers this call's newest request, unless you pass the job_id of the job they mean. Pass scope all only when they ask to be called about all of their jobs: each one then calls. Then tell the user what it says, in a few words.",
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: "The job's id from start_job or list_jobs, when the user means a particular job." },
      scope: {
        type: 'string',
        enum: ['newest', 'all'],
        description:
          'newest (the default): the newest request. all: every request this call has running and sends from now on, only when the user asks for that.'
      }
    }
  }
}

/** GPT-Live has no tools: it asks for a call in a delegation, as on the phone (callMeRule). */
export const CALL_ME_RULE =
  '\n\nWhen the user asks to be called, phoned or rung when something is done ("call me when it\'s done"), delegate it starting with "Call me:": with the new work when they ask for it in the same breath, like "Call me: check the server", or a bare "Call me:" for the newest request already running. For one particular job, delegate "Call me about job-2:". Only when they ask to be called about all of their jobs, delegate "Call me about all:": each job then calls. Hermes calls them once this call has ended; work that finishes while you\'re still talking is told here as usual. Conduit answers how it went: tell them in a few words. These markers are for Conduit only: never say them aloud.'

/** `next`: the request the call sends from `since` (ms) on: GPT-Live's "Call me:" with its work. */
export type CallbackScope = { kind: 'newest' } | { kind: 'next'; since: number } | { kind: 'all' } | { kind: 'job'; id: string }

/** A delegation's "Call me:" marker: its scope and the work that came with it. */
export function callMeMarker(request: string): { scope: CallbackScope; rest: string } | null {
  const match = /^\s*call me(?:\s+about\s+(all|[\w-]+))?\s*:\s*/i.exec(request)
  if (!match) return null
  const about = match[1]?.toLowerCase()
  const scope: CallbackScope = !about ? { kind: 'newest' } : about === 'all' ? { kind: 'all' } : { kind: 'job', id: about }
  return { scope, rest: request.slice(match[0].length).trim() }
}

/** The tool's arguments as a scope. */
export function callbackScope(args: Record<string, string | undefined>): CallbackScope {
  const id = args.job_id?.trim()
  if (id) return { kind: 'job', id }
  return args.scope?.trim().toLowerCase() === 'all' ? { kind: 'all' } : { kind: 'newest' }
}

export type Availability = 'available' | 'calls_off' | 'when_asked_off' | 'not_paired' | 'unsupported'

type Http = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<unknown>
type Row = Record<string, unknown>
const defaultHttp: Http = (method, path, body) => gateway.http(method, path, body, 15_000)

/** Whether Hermes can call the user when a call's work is done, by the profile's call settings. */
export async function callbackAvailability(profile: string | undefined, http: Http = defaultHttp): Promise<Availability> {
  const status = await http('GET', withProfile(STATUS_PATH, profile)).then(pluginStatus, () => null)
  if (!status || !serves(status, [CALLS_CAPABILITY])) return 'unsupported'
  const calls = (await http('GET', withProfile(CALLS_PATH, profile)).catch(() => null)) as Row | null
  const settings = (calls?.settings ?? null) as Row | null
  if (!calls || calls.ok !== true || !settings) return 'unsupported'
  if (calls.paired !== true && calls.can_ring !== true) return 'not_paired'
  if (settings.enabled !== true) return 'calls_off'
  if (settings.when_asked === false) return 'when_asked_off'
  return 'available'
}

/** Why Hermes can't call, for the live model. */
export function refusal(availability: Availability | 'too_many'): string {
  switch (availability) {
    case 'when_asked_off':
      return "Hermes can't call the user: Call when I ask is off in Conduit's Settings, under Calls from Hermes."
    case 'not_paired':
      return "Hermes can't call the user: nothing can ring for this Hermes profile yet. Calls ring Conduit on a computer once it's open, or an iPhone once Conduit's notifications are on there."
    case 'unsupported':
      return "Hermes can't call the user yet: the Conduit plugin on their Hermes host needs an update."
    case 'too_many':
      return "Hermes can't call the user: too many of their jobs are already waiting to call them."
    default:
      return "Hermes can't call the user: calls are off for this Hermes profile. They can turn on Hermes can call me in Conduit's Settings on their iPhone, under Calls from Hermes."
  }
}

/** The host's refusals of a watch (hermes_calls.py add_call_watch); null for anything a retry may fix. */
function refusalOf(error: unknown): Availability | 'too_many' | null {
  const code = error instanceof GatewayError ? error.code : undefined
  const text = error instanceof Error ? error.message : String(error)
  if (code === 409) return /paired/i.test(text) ? 'not_paired' : 'calls_off'
  if (code === 429 && /waiting to call/i.test(text)) return 'too_many'
  if (code === 404 || code === 405) return 'unsupported'
  return null
}

/** One request the call sent: a background job, or a request in the chat on screen. */
export interface CallWork {
  key: string
  title: string
  /** The Hermes session whose turn's end the host watches. */
  sessionId?: string
  running: boolean
  /** When its request went out (ms), so an earlier turn of the same chat never counts. */
  sentAt: number
  /** A background job (start_job), which job_id can name. */
  job?: boolean
}

interface Watch {
  work: CallWork
  id?: string
  /** Its work ended (or the host saw it end) while the watch was on its way. */
  ended?: boolean
  arming?: Promise<void>
}

const TELL = ' Tell the user in a few words.'

/** One call's "call me when it's done". `note` hands the call a quiet notice to tell at the next pause. */
export class CallBacks {
  private watches = new Map<string, Watch>()
  private seen = new Set<string>()
  private later: 'none' | 'next' | 'all' = 'none'
  private work: CallWork[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private over = false

  constructor(
    private profile: string | undefined,
    private note: (text: string) => void,
    private http: Http = defaultHttp,
    private availability: () => Promise<Availability> = () => callbackAvailability(profile, http)
  ) {}

  /** The call's work as it stands: new work is marked when the call asked for it, and work that ended drops its watch. */
  sync(work: CallWork[]) {
    if (this.over) return
    this.work = work
    for (const item of work) {
      if (!item.sessionId || this.seen.has(item.key)) continue
      this.seen.add(item.key)
      if (item.running && this.later !== 'none') {
        if (this.later === 'next') this.later = 'none'
        void this.arm(item).then(refused => {
          if (refused && !this.over)
            this.note(`[Hermes won't call the user about "${item.title}" after all. ${refusal(refused)} Tell them in a sentence at the next natural pause.]`)
        })
      }
    }
    for (const [key, watch] of this.watches) {
      const now = work.find(item => item.key === key)
      if (!now || !now.running) this.drop(key, watch)
    }
  }

  /** The model asked for a call. Answers what it says to the user. */
  async request(scope: CallbackScope): Promise<Record<string, string>> {
    if (this.over) return { status: 'unavailable', message: 'The call has ended.' }
    const availability = await this.availability().catch((): Availability => 'unsupported')
    if (availability !== 'available') return { status: 'unavailable', message: refusal(availability) + TELL }
    const work = this.work.filter(item => item.sessionId)
    let marked: CallWork[] = []
    let later: 'none' | 'next' | 'all' = 'none'
    if (scope.kind === 'newest') {
      const newest = [...work].sort((a, b) => a.sentAt - b.sentAt).at(-1)
      if (newest?.running) marked = [newest]
      else later = 'next'
    } else if (scope.kind === 'next') {
      // Sent already while the settings were read, or still to go.
      const sent = work.filter(item => item.running && item.sentAt >= scope.since).at(-1)
      if (sent) marked = [sent]
      else later = 'next'
    } else if (scope.kind === 'all') {
      marked = work.filter(item => item.running)
      later = 'all'
    } else {
      const named = this.work.find(item => item.job && item.key === scope.id)
      if (!named) return { status: 'unknown_job', message: 'This call has no background job by that id. Ask the user which job they mean.' }
      if (!named.running)
        return {
          status: 'already_ended',
          message: `"${named.title}" has already ended, so Hermes won't call about it: its outcome is told in this call.${TELL}`
        }
      marked = [named]
    }
    if (later !== 'none' && this.later !== 'all') this.later = later
    const refused = (await Promise.all(marked.map(item => this.arm(item)))).find(Boolean)
    if (refused) return { status: 'unavailable', message: refusal(refused) + TELL }
    return {
      status: 'will_call',
      message: markedMessage(
        marked.map(item => item.title),
        later === 'none' ? 'none' : this.later
      )
    }
  }

  /** The call hung up: the holds are let go of, so the host calls once each request is done. */
  async hangUp(): Promise<void> {
    if (this.over) return
    this.over = true
    this.stopRenewing()
    await Promise.all(
      [...this.watches.values()].map(async watch => {
        await watch.arming
        if (watch.id && !watch.ended) await this.hold(watch, 0).catch(() => undefined)
      })
    )
  }

  /** Watches a marked request on the host, held while the call goes on; a refusal is returned. */
  private async arm(work: CallWork): Promise<Availability | 'too_many' | null> {
    if (this.watches.has(work.key) || !work.sessionId) return null
    const watch: Watch = { work }
    this.watches.set(work.key, watch)
    let refused: Availability | 'too_many' | null = null
    watch.arming = (async () => {
      const body = {
        session_ids: [work.sessionId],
        title: work.title,
        hold_s: HOLD_SECONDS,
        ended_within_s: Math.max(0, Math.min(MAX_ENDED_WITHIN, Math.ceil((Date.now() - work.sentAt) / 1000)))
      }
      try {
        const answer = (await this.http('POST', withProfile(WATCHES_PATH, this.profile), body)) as Row
        if (answer?.status === 'watching' && typeof answer.id === 'string') watch.id = answer.id
        // Its end already reached the host: the call tells it as usual.
        else watch.ended = true
      } catch (e) {
        refused = refusalOf(e)
        watch.ended = true
      }
    })()
    await watch.arming
    if (refused || watch.ended) {
      if (this.watches.get(work.key) === watch) this.watches.delete(work.key)
      return refused
    }
    // Ended while the watch was on its way, or the call hung up meanwhile.
    const now = this.work.find(item => item.key === work.key)
    if (!now?.running) this.drop(work.key, watch)
    else if (this.over) await this.hold(watch, 0).catch(() => undefined)
    else this.startRenewing()
    return null
  }

  /** The call tells its end: no call about it. */
  private drop(key: string, watch: Watch) {
    this.watches.delete(key)
    watch.ended = true
    if (watch.id) void this.http('DELETE', withProfile(`${WATCHES_PATH}/${encodeURIComponent(watch.id)}`, this.profile)).catch(() => undefined)
  }

  private async hold(watch: Watch, seconds: number) {
    if (!watch.id) return
    const answer = (await this.http('PUT', withProfile(`${WATCHES_PATH}/${encodeURIComponent(watch.id)}`, this.profile), { hold_s: seconds })) as Row
    // Gone (it fired, expired or was removed) or released after its end: nothing more to hold.
    if (answer?.status === 'gone' || answer?.status === 'ended') {
      watch.ended = true
      if (this.watches.get(watch.work.key) === watch) this.watches.delete(watch.work.key)
    }
  }

  private startRenewing() {
    if (this.timer || this.over) return
    this.timer = setInterval(() => {
      if (this.over || !this.watches.size) return this.stopRenewing()
      for (const watch of this.watches.values()) if (watch.id && !watch.ended) void this.hold(watch, HOLD_SECONDS).catch(() => undefined)
    }, RENEW_MS)
  }

  private stopRenewing() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** The answer for the live model, as the phone's VoiceCallbackRequestOutcome.marked. */
export function markedMessage(titles: string[], later: 'none' | 'next' | 'all'): string {
  const named = titles.map(title => `"${title}"`).join(', ')
  const what = !titles.length
    ? later === 'all'
      ? 'each request this call sends to Hermes from now on is done'
      : 'the next request this call sends to Hermes is done'
    : later === 'none'
      ? `${named} is done`
      : later === 'next'
        ? `${named} is done, and when the next request this call sends to Hermes is`
        : `each of ${named} is done, and each request this call sends to Hermes from now on`
  return `Hermes will call the user when ${what}, once this call has ended. Work that finishes while you're still talking is told in this call as usual, and Hermes doesn't call about it.${TELL}`
}

/** A request in the chat on screen, while Hermes works on it. */
export const chatWork = (sessionId: string | null | undefined, request: string, sentAt: number): CallWork => ({
  key: `chat-${sentAt}`,
  title: jobTitle(request),
  sessionId: sessionId ?? undefined,
  running: true,
  sentAt
})

/** A background job, once Hermes has its session. */
export const jobWork = (job: VoiceJob): CallWork => ({
  key: job.id,
  title: job.title,
  sessionId: job.stored ?? job.sid,
  running: job.status === 'running',
  sentAt: job.sentAt ?? 0,
  job: true
})
