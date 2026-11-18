import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { t } from '../../../shared/i18n'
import { cronPath, parseDeliveryTargets, parseJob, parseJobs, parseRuns, type CronJob, type CronRun, type DeliveryTarget } from './cron'

export type CronAction = 'pause' | 'resume' | 'trigger'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * The scheduled jobs of `profile` (null: every profile's, each naming its
 * own), read again when Hermes says its jobs changed. An action names the
 * job's own profile, as the phone does.
 */
export function useCron(profile: string | null, connected: boolean) {
  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const mine = ++generation.current
    try {
      const raw = await gateway.http('GET', cronPath('/api/cron/jobs', profile ?? 'all'))
      if (mine !== generation.current) return
      setJobs(parseJobs(raw))
      setError(null)
    } catch (e) {
      if (mine !== generation.current) return
      setError(t('Could not load scheduled jobs: {reason}', { reason: message(e) }))
    }
  }, [profile])

  useEffect(() => {
    setJobs(null)
    setError(null)
    if (!connected) return
    void load()
    const off = window.conduit.onEvent(event => {
      if (event.type !== 'cron.changed') return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void load(), 400)
    })
    return () => {
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, load])

  const jobProfile = (job: CronJob) => job.profile ?? profile ?? undefined

  /** Pause, Resume or Run now; null when it worked, else what to tell the user. */
  const act = useCallback(
    async (action: CronAction, job: CronJob): Promise<string | null> => {
      setBusy(job.id)
      const owner = job.profile ?? profile ?? undefined
      try {
        await gateway.http('POST', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}/${action}`, owner), owner ? { profile: owner } : {})
        if (action !== 'trigger') {
          setJobs(list => list?.map(row => (row.id === job.id && row.profile === job.profile ? { ...row, enabled: action === 'resume' } : row)) ?? list)
        }
        void load()
        return null
      } catch (e) {
        const reason = message(e)
        return action === 'pause'
          ? t('Could not pause scheduled job: {reason}', { reason })
          : action === 'resume'
            ? t('Could not resume scheduled job: {reason}', { reason })
            : t('Could not run scheduled job: {reason}', { reason })
      } finally {
        setBusy(null)
      }
    },
    [load, profile]
  )

  const remove = useCallback(
    async (job: CronJob): Promise<string | null> => {
      setBusy(job.id)
      try {
        await gateway.http('DELETE', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}`, job.profile ?? profile ?? undefined))
        setJobs(list => list?.filter(row => !(row.id === job.id && row.profile === job.profile)) ?? list)
        void load()
        return null
      } catch (e) {
        return t('Could not delete scheduled job: {reason}', { reason: message(e) })
      } finally {
        setBusy(null)
      }
    },
    [load, profile]
  )

  /** A new job in `owner`; the job Hermes made, when it says. */
  const create = useCallback(
    async (body: Record<string, unknown>, owner: string | undefined): Promise<CronJob | null> => {
      const raw = (await gateway.http('POST', cronPath('/api/cron/jobs', owner), body)) as Record<string, unknown> | null
      void load()
      const job = parseJob(raw?.job ?? raw)
      return job ? { ...job, profile: job.profile ?? owner } : null
    },
    [load]
  )

  const update = useCallback(
    async (job: CronJob, updates: Record<string, unknown>): Promise<void> => {
      if (!Object.keys(updates).length) return
      await gateway.http('PUT', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}`, job.profile ?? profile ?? undefined), { updates })
      void load()
    },
    [load, profile]
  )

  const runs = useCallback(
    async (job: CronJob): Promise<CronRun[]> => {
      const raw = await gateway.http('GET', cronPath(`/api/cron/jobs/${encodeURIComponent(job.id)}/runs?limit=20`, job.profile ?? profile ?? undefined))
      return parseRuns(raw)
    },
    [profile]
  )

  const deliveryTargets = useCallback(async (owner: string | undefined): Promise<DeliveryTarget[]> => {
    try {
      return parseDeliveryTargets(await gateway.http('GET', cronPath('/api/cron/delivery-targets', owner)))
    } catch {
      return []
    }
  }, [])

  return { jobs, error, busy, reload: load, act, remove, create, update, runs, deliveryTargets, jobProfile }
}
