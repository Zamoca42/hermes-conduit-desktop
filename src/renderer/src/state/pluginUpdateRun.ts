/**
 * The Conduit plugin update's run on the host, outside the page that shows it
 * so a test can drive it with a gateway of its own: `followHostUpdate` starts
 * the host's job and follows it, and `useStaleUpdateRow` drops a row that is
 * no longer this dashboard's when the page opens.
 */
import { useEffect } from 'react'
import { HOST_FOLLOW_LIMIT_MS, SELF_UPDATE_PATH, jobState, pluginStatus, selfUpdatePath, type PluginStatus, type UpdateState } from './plugin'

/** A plugin request: the gateway's `http`, or a test's. */
export type PluginHttp = (method: 'GET' | 'POST', path: string) => Promise<unknown>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const httpCode = (e: unknown) => (e as { code?: unknown })?.code

/** The plugin's report, `missing` on a 404 and `unknown` on anything else that failed. */
export async function readPluginStatus(http: PluginHttp, statusPath: string): Promise<PluginStatus> {
  try {
    return pluginStatus(await http('GET', statusPath))
  } catch (e) {
    return httpCode(e) === 404 ? { state: 'missing' } : { state: 'unknown' }
  }
}

export interface FollowDeps {
  http: PluginHttp
  /** The plugin's report, read when the restarted dashboard lost the job. */
  readStatus: () => Promise<PluginStatus>
  /** The row as it stands, for a step the host doesn't name. */
  current: () => UpdateState
  /** When the run began, for the follow limit. */
  startedAt: number
  pause?: (ms: number) => Promise<void>
  now?: () => number
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Starts the host's job and follows it, as the phone's runOnHost does, reporting each step through `set`,
 * each answer from the host through `heard` and the job it follows through `onJob`. Stops once the run is
 * no longer `live`. Only an answer is word from the host: a read that fails never calls `heard`, so reads
 * that keep failing let the run's watchdog (`untilQuiet`) end it.
 */
export async function followHostUpdate(
  deps: FollowDeps,
  set: (next: UpdateState) => void,
  heard: () => void,
  acceptScan: boolean,
  live: () => boolean,
  onJob: (id: string) => void
): Promise<void> {
  const { http, readStatus, current, startedAt } = deps
  const pause = deps.pause ?? wait
  const now = deps.now ?? Date.now
  let job: Record<string, unknown> | null = null
  try {
    const started = (await http('POST', selfUpdatePath(acceptScan))) as { job?: Record<string, unknown> }
    job = started?.job ?? null
  } catch (e) {
    // No answer may still have started it: follow one that runs.
    const code = httpCode(e)
    if (code !== undefined && code !== 0) return set({ phase: 'failed', detail: message(e) })
    const probe = (await http('GET', SELF_UPDATE_PATH).catch(() => null)) as { job?: Record<string, unknown> } | null
    job = probe?.job ?? null
  }
  const id = job?.id
  if (!job || typeof id !== 'string') return set({ phase: 'failed', detail: null })
  onJob(id)
  heard()
  for (;;) {
    const state = jobState(job)
    if (state && state.phase !== 'updating') return set(state)
    set(state ?? current())
    if (now() - startedAt > HOST_FOLLOW_LIMIT_MS) return set({ phase: 'runningOnHost' })
    await pause(2000)
    if (!live()) return
    // Reads fail while the dashboard restarts; the next poll asks again.
    let latest: { job?: Record<string, unknown> } | null
    try {
      latest = (await http('GET', SELF_UPDATE_PATH)) as { job?: Record<string, unknown> }
    } catch {
      continue
    }
    heard()
    if (!latest?.job || latest.job.id !== id) {
      // The restarted dashboard lost the job: its report says where it stands.
      const status = await readStatus()
      return set(
        status.state === 'reported' && !status.restartNeeded
          ? { phase: 'updated', version: status.loadedVersion ?? status.version }
          : { phase: 'needsDashboardRestart', detail: null }
      )
    }
    job = latest.job
  }
}

/**
 * Drops the update row when the page opens on a dashboard it no longer belongs to. The row is module state
 * that outlives the page (and the Shell's remount on a dashboard switch), so `rowHost` is the dashboard the
 * run was on and `host` the one on screen. Another dashboard's row clears at once, whatever its phase, so
 * "Restart the Hermes dashboard to finish" about A's update never shows on B; only a live run is kept,
 * since it stops by itself. A held scan on this dashboard asks the host first: Update Anyway would force
 * an update unseen once the job has moved on, and only the host's answer clears it (a failed read keeps it).
 * `clear(row)` clears the row only if it is still `row`.
 */
export function useStaleUpdateRow(row: UpdateState, rowHost: string, host: string, http: PluginHttp, clear: (row: UpdateState) => void): void {
  useEffect(() => {
    if (row.phase === 'idle' || row.phase === 'updating') return
    if (rowHost !== host) return clear(row)
    if (row.phase !== 'scanHeld') return
    void http('GET', SELF_UPDATE_PATH)
      .then(r => {
        const id = (r as { job?: { id?: unknown } })?.job?.id
        if (!row.id || id !== row.id) clear(row)
      })
      .catch(() => undefined)
    // Only when the page opens: the row's own changes after that are this run's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
