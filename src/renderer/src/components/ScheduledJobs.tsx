import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { locale, t } from '@shared/i18n'
import type { Bot } from '../state/bots'
import {
  EVERY_DAY,
  WEEKDAYS,
  WEEKENDS,
  absoluteDateText,
  canSave,
  createBody,
  createReasoningUpdate,
  deliveryChoices,
  deliveryTitle,
  displayName,
  isActive,
  isFinished,
  jobDraftFrom,
  jobUpdates,
  modelSummary,
  newJobDraft,
  nextRunLine,
  pinsModel,
  previewSchedule,
  runTime,
  scheduleText,
  statusLabel,
  type CronJob,
  type CronRun,
  type DeliveryTarget,
  type IntervalUnit,
  type JobDraft,
  type ScheduleMode
} from '../state/cron'
import { useCron } from '../state/useCron'
import { ProfileStrip } from './ChatList'
import { Icon } from './icons'
import { REASONING_LEVELS, groupModels, reasoningTitle } from '../state/models'
import { useModelCatalog } from '../state/modelCatalog'
import { ModelOptions } from './ModelOptions'
import { ModelCatalogNote } from './ModelCatalogNote'

interface Props {
  bots: Bot[] | null
  connected: boolean
  /** The profile the list shows (null: every one), shared with Chats. */
  profile: string | null
  onProfile: (profile: string | null) => void
  /** Opens a run's conversation. */
  onOpenRun: (run: CronRun, job: CronJob) => void
  /** The Board | Scheduled switch, for the header. */
  segment?: ReactNode
}

/** Pinned jobs, kept on this computer as "profile\tjobID" (Hermes has no pin for a job). */
const PIN_KEY = 'conduit.pinnedCronJobs'
const readPins = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
const pinKey = (job: CronJob) => `${job.profile ?? 'default'}\t${job.id}`
const jobKey = pinKey

type Pane = { kind: 'job'; key: string } | { kind: 'edit'; job: CronJob | null } | null

/**
 * Tasks > Scheduled, after the phone's: Hermes' scheduled jobs with their
 * schedules in words, when each runs next and an on/off switch; a job's
 * details hold Run now, its settings and its run history, each run a
 * conversation. Jobs are made and changed here or by asking Hermes.
 */
export function ScheduledJobs({ bots, connected, profile, onProfile, onOpenRun, segment }: Props) {
  const cron = useCron(profile, connected)
  const [pins, setPins] = useState(readPins)
  const [pane, setPane] = useState<Pane>(null)
  const [menu, setMenu] = useState<{ job: CronJob; x: number; y: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  useEffect(() => setPane(null), [profile])

  const jobs = cron.jobs ?? []
  const pinned = useMemo(() => pins.flatMap(key => jobs.filter(job => pinKey(job) === key)), [pins, jobs])
  const others = useMemo(() => jobs.filter(job => !pins.includes(pinKey(job))), [pins, jobs])
  const selected = pane?.kind === 'job' ? jobs.find(job => jobKey(job) === pane.key) ?? null : null
  const botTitle = (name?: string) => bots?.find(b => b.name === (name ?? 'default'))?.title ?? name ?? ''

  function togglePin(job: CronJob) {
    const key = pinKey(job)
    const next = pins.includes(key) ? pins.filter(k => k !== key) : [...pins, key]
    setPins(next)
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify(next))
    } catch {
      // Kept for this window only.
    }
  }

  async function act(action: 'pause' | 'resume' | 'trigger', job: CronJob) {
    setNote(null)
    const failure = await cron.act(action, job)
    if (failure) setNote(failure)
    else if (action === 'trigger') setNote(t('{name} is running. Its run shows in its history in a moment.', { name: displayName(job) }))
  }

  async function remove(job: CronJob) {
    const ask = t("This removes {name} from Hermes, so it won't run again. Chats from its past runs are kept.", { name: displayName(job) })
    if (!window.confirm(`${t('Delete scheduled job?')}\n\n${ask}`)) return
    setNote(null)
    const failure = await cron.remove(job)
    if (failure) {
      setNote(failure)
      return
    }
    if (pins.includes(pinKey(job))) togglePin(job)
    if (pane?.kind === 'job' && pane.key === jobKey(job)) setPane(null)
  }

  const row = (job: CronJob, isPinned: boolean) => (
    <div
      key={jobKey(job)}
      className="row-wrap job-row-wrap"
      onContextMenu={e => {
        e.preventDefault()
        setMenu({ job, x: e.clientX, y: e.clientY })
      }}
    >
      <button className="row job-row" aria-current={selected && jobKey(selected) === jobKey(job) ? 'true' : undefined} onClick={() => setPane({ kind: 'job', key: jobKey(job) })}>
        <span className="row-title">
          {isPinned ? <Icon name="pin" className="row-pin" /> : null}
          {displayName(job)}
        </span>
        <span className="meta">{scheduleText(job) ?? t('No schedule')}</span>
        {pinsModel(job) && modelSummary(job) ? <span className="meta job-model">{modelSummary(job)}</span> : null}
        <span className={`meta job-next${isActive(job) ? ' on' : ''}`}>
          <Icon name="clock" />
          {nextRunLine(job)}
          {!profile && job.profile && (bots?.length ?? 0) > 1 ? ` · ${botTitle(job.profile)}` : ''}
        </span>
      </button>
      {!isFinished(job) ? (
        <label className="switch" title={job.enabled ? t('Pause') : t('Resume')}>
          <input
            type="checkbox"
            role="switch"
            aria-label={displayName(job)}
            checked={job.enabled}
            disabled={cron.busy !== null}
            onChange={e => void act(e.target.checked ? 'resume' : 'pause', job)}
          />
          <span aria-hidden="true" />
        </label>
      ) : null}
      <button
        className="row-more"
        aria-label={t('More')}
        title={t('More')}
        aria-haspopup="menu"
        onClick={e => {
          e.stopPropagation()
          const box = e.currentTarget.getBoundingClientRect()
          setMenu(m => (m && jobKey(m.job) === jobKey(job) ? null : { job, x: box.right, y: box.bottom }))
        }}
      >
        <Icon name="more" />
      </button>
    </div>
  )

  return (
    <>
      <section className="chatlist" aria-label={t('Scheduled')}>
        <div className="chatlist-head">
          {segment ?? <h1>{t('Scheduled')}</h1>}
          <button className="round" aria-label={t('New job')} title={t('New job')} disabled={!connected} onClick={() => setPane({ kind: 'edit', job: null })}>
            <Icon name="plus" />
          </button>
        </div>
        {(bots?.length ?? 0) > 1 ? <ProfileStrip bots={bots!} profile={profile} onProfile={onProfile} /> : null}
        <div className="chatlist-scroll">
          {cron.jobs === null && !cron.error ? <div className="empty">{t('Loading…')}</div> : null}
          {cron.error ? <div className="empty">{cron.error}</div> : null}
          {cron.jobs && !jobs.length ? <div className="empty">{t('No scheduled jobs yet. Make one with the + button, or ask Hermes to run something on a schedule.')}</div> : null}
          {pinned.length ? (
            <div role="group" aria-label={t('Pinned')}>
              <div className="sect">{t('Pinned')}</div>
              {pinned.map(job => row(job, true))}
            </div>
          ) : null}
          {others.length ? (
            <div role="group" aria-label={t('Jobs')}>
              {pinned.length ? <div className="sect">{t('Jobs')}</div> : null}
              {others.map(job => row(job, false))}
            </div>
          ) : null}
        </div>
        {menu ? (
          <div className="host-menu row-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}>
            <button role="menuitem" onClick={() => togglePin(menu.job)}>
              {pins.includes(pinKey(menu.job)) ? t('Unpin') : t('Pin')}
            </button>
            {!isFinished(menu.job) ? (
              <>
                <button role="menuitem" disabled={cron.busy !== null} onClick={() => void act('trigger', menu.job)}>
                  {t('Run now')}
                </button>
                <button role="menuitem" disabled={cron.busy !== null} onClick={() => void act(menu.job.enabled ? 'pause' : 'resume', menu.job)}>
                  {menu.job.enabled ? t('Pause') : t('Resume')}
                </button>
              </>
            ) : null}
            <button role="menuitem" onClick={() => setPane({ kind: 'edit', job: menu.job })}>
              {t('Edit')}
            </button>
            <button role="menuitem" className="danger" disabled={cron.busy !== null} onClick={() => void remove(menu.job)}>
              {t('Delete')}
            </button>
          </div>
        ) : null}
      </section>
      <main className="needs job-pane">
        <div className="needs-inner">
          {note ? (
            <div className="model-note" role="status">
              {note}
              <button className="staged-remove" aria-label={t('Close')} onClick={() => setNote(null)}>
                <Icon name="close" />
              </button>
            </div>
          ) : null}
          {pane?.kind === 'edit' ? (
            <JobEditor
              key={pane.job ? jobKey(pane.job) : 'new'}
              job={pane.job}
              bots={bots}
              profile={profile}
              loadTargets={cron.deliveryTargets}
              onCancel={() => setPane(pane.job ? { kind: 'job', key: jobKey(pane.job) } : null)}
              onSave={async (draft, original, owner) => {
                if (pane.job) {
                  await cron.update(pane.job, jobUpdates(draft, original))
                  setPane({ kind: 'job', key: jobKey(pane.job) })
                } else {
                  const body = createBody(draft)
                  if (!body) return
                  const made = await cron.create(body, owner)
                  setPane(made ? { kind: 'job', key: jobKey(made) } : null)
                  // Hermes' create takes no reasoning; the new job gets it as an edit.
                  const reasoning = createReasoningUpdate(draft)
                  if (reasoning) {
                    try {
                      if (!made) throw new Error(t("Hermes sent a reply Conduit didn't understand. Updating Hermes and Conduit usually fixes this."))
                      await cron.update(made, reasoning)
                    } catch (e) {
                      setNote(t('The job is saved, but not its reasoning: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
                    }
                  }
                }
              }}
            />
          ) : selected ? (
            <JobDetails
              key={jobKey(selected)}
              job={selected}
              busy={cron.busy === selected.id}
              profileName={!profile && (bots?.length ?? 0) > 1 ? botTitle(selected.profile) : null}
              loadRuns={cron.runs}
              onAct={action => void act(action, selected)}
              onEdit={() => setPane({ kind: 'edit', job: selected })}
              onDelete={() => void remove(selected)}
              onOpenRun={run => onOpenRun(run, selected)}
            />
          ) : (
            <div className="needs-empty">
              <Icon name="clock" />
              <span>{jobs.length ? t('Pick a job to see its details and run history.') : t('Scheduled jobs run a prompt on their own, on a schedule.')}</span>
              <span className="meta">{t('Each run is saved as its own conversation. Ask Hermes to add or change a schedule, or make one here.')}</span>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

function JobDetails({
  job,
  busy,
  profileName,
  loadRuns,
  onAct,
  onEdit,
  onDelete,
  onOpenRun
}: {
  job: CronJob
  busy: boolean
  profileName: string | null
  loadRuns: (job: CronJob) => Promise<CronRun[]>
  onAct: (action: 'pause' | 'resume' | 'trigger') => void
  onEdit: () => void
  onDelete: () => void
  onOpenRun: (run: CronRun) => void
}) {
  const [runs, setRuns] = useState<CronRun[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRuns(null)
    setFailure(null)
    loadRuns(job)
      .then(list => live && setRuns(list))
      .catch(e => live && setFailure(t('Could not load scheduled-job runs: {reason}', { reason: e instanceof Error ? e.message : String(e) })))
    return () => {
      live = false
    }
    // Read again after a run or a change: the job's last run moves.
  }, [job.id, job.profile, job.lastRunAt, loadRuns])

  return (
    <>
      <div className="job-head">
        <h1>{displayName(job)}</h1>
        <span className={`job-status ${isFinished(job) ? 'finished' : isActive(job) ? 'active' : 'paused'}`}>{statusLabel(job)}</span>
      </div>
      <div className="job-actions">
        {!isFinished(job) ? (
          <>
            <button className="primary" disabled={busy} onClick={() => onAct('trigger')}>
              {busy ? t('Working…') : t('Run now')}
            </button>
            <button className="secondary" disabled={busy} onClick={() => onAct(job.enabled ? 'pause' : 'resume')}>
              {job.enabled ? t('Pause') : t('Resume')}
            </button>
          </>
        ) : null}
        <button className="secondary" onClick={onEdit}>
          {t('Edit job')}
        </button>
        <button className="secondary danger" disabled={busy} onClick={onDelete}>
          {t('Delete job')}
        </button>
      </div>
      <dl className="job-facts">
        <dt>{t('Schedule')}</dt>
        <dd>{scheduleText(job) ?? '—'}</dd>
        <dt>{t('Next run')}</dt>
        <dd>{isFinished(job) ? '—' : runTime(job.nextRunAt)}</dd>
        <dt>{t('Last run')}</dt>
        <dd>{runTime(job.lastRunAt)}</dd>
        <dt>{t('Delivery')}</dt>
        <dd>{deliveryTitle(job.deliver ?? 'local')}</dd>
        {modelSummary(job) ? (
          <>
            <dt>{t('Model')}</dt>
            <dd>{modelSummary(job)}</dd>
          </>
        ) : null}
        {profileName ? (
          <>
            <dt>{t('Bot')}</dt>
            <dd>{profileName}</dd>
          </>
        ) : null}
        {job.lastError ? (
          <>
            <dt>{t('Last error')}</dt>
            <dd className="error-text">{job.lastError}</dd>
          </>
        ) : null}
      </dl>
      {job.prompt?.trim() ? (
        <section className="job-section">
          <h2>{t('Prompt')}</h2>
          <p className="job-prompt">{job.prompt}</p>
        </section>
      ) : null}
      <section className="job-section">
        <h2>{t('Run history')}</h2>
        {failure ? <p className="meta">{failure}</p> : null}
        {!runs && !failure ? <p className="meta">{t('Loading…')}</p> : null}
        {runs && !runs.length ? <p className="meta">{t('This job has not run yet.')}</p> : null}
        {runs?.map(run => (
          <button key={run.key} className="needs-row job-run" disabled={!run.id} onClick={() => onOpenRun(run)}>
            <span className="needs-body">
              <span className="needs-top">
                <span className="needs-title">{run.title ?? run.preview ?? t('Run')}</span>
                <span className="meta row-time">{run.active ? t('Running') : run.startedAt ? absoluteDateText(new Date(run.startedAt)) : ''}</span>
              </span>
              {/* The model, as the phone shows it: a run's preview is Hermes' own instructions to the job. */}
              {run.model ? <span className="meta">{run.model}</span> : null}
            </span>
          </button>
        ))}
      </section>
    </>
  )
}

const MODES: { mode: ScheduleMode; label: () => string }[] = [
  { mode: 'time', label: () => t('At a time') },
  { mode: 'interval', label: () => t('Every…') },
  { mode: 'once', label: () => t('Once') },
  { mode: 'custom', label: () => t('Custom') }
]

function JobEditor({
  job,
  bots,
  profile,
  loadTargets,
  onCancel,
  onSave
}: {
  job: CronJob | null
  bots: Bot[] | null
  profile: string | null
  loadTargets: (owner: string | undefined) => Promise<DeliveryTarget[]>
  onCancel: () => void
  onSave: (draft: JobDraft, original: JobDraft, owner: string | undefined) => Promise<void>
}) {
  const [original] = useState(() => (job ? jobDraftFrom(job) : newJobDraft()))
  const [draft, setDraft] = useState(original)
  const [owner, setOwner] = useState<string>(job?.profile ?? profile ?? 'default')
  const [targets, setTargets] = useState<DeliveryTarget[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadTargets(owner).then(list => live && setTargets(list))
    return () => {
      live = false
    }
  }, [owner, loadTargets])

  const catalog = useModelCatalog(useMemo(() => ({ profile: owner, explicit_only: true }), [owner]))
  const groups = useMemo(() => groupModels(catalog.providers ?? [], ''), [catalog.providers])
  const modelValue = draft.provider || draft.model ? `${draft.provider}\n${draft.model}` : ''
  const listed = !modelValue || groups.some(group => group.slug === draft.provider && group.models.includes(draft.model))

  const schedule = draft.schedule
  const setSchedule = (patch: Partial<JobDraft['schedule']>) => setDraft(d => ({ ...d, schedule: { ...d.schedule, ...patch } }))
  const preview = previewSchedule(schedule)
  const choices = deliveryChoices(targets, draft.deliver)
  const target = choices.find(c => c.id === draft.deliver)
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  const days = new Set(schedule.days)
  const preset = (list: number[]) => list.length === days.size && list.every(day => days.has(day))

  async function save() {
    if (saving || !canSave(draft)) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft, original, owner)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <form
      className="job-editor"
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
    >
      <h1>{job ? t('Edit scheduled job') : t('New scheduled job')}</h1>
      {!job && !profile && (bots?.length ?? 0) > 1 ? (
        <label className="field">
          {t('Bot')}
          <select value={owner} onChange={e => setOwner(e.target.value)}>
            {bots!.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        {t('Name')}
        <input value={draft.name} placeholder={t('Name, like Morning brief')} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} autoFocus />
      </label>
      <label className="field">
        {t('Prompt')}
        <textarea className="job-prompt-field" rows={5} value={draft.prompt} placeholder={t('What Hermes should do each time')} onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))} />
      </label>
      <fieldset className="field job-schedule">
        <legend>{t('Schedule')}</legend>
        <div className="segmented" role="radiogroup" aria-label={t('Repeats')}>
          {MODES.map(({ mode, label }) => (
            <button key={mode} type="button" role="radio" aria-checked={schedule.mode === mode} className={schedule.mode === mode ? 'on' : undefined} onClick={() => setSchedule({ mode })}>
              {label()}
            </button>
          ))}
        </div>
        {schedule.mode === 'time' ? (
          <>
            <label className="job-inline">
              {t('Time')}
              <input
                type="time"
                value={time}
                onChange={e => {
                  const [hour, minute] = e.target.value.split(':').map(Number)
                  if (Number.isInteger(hour) && Number.isInteger(minute)) setSchedule({ hour, minute })
                }}
              />
            </label>
            <div className="segmented">
              <button type="button" className={preset(EVERY_DAY) ? 'on' : undefined} onClick={() => setSchedule({ days: [...EVERY_DAY] })}>
                {t('Every day')}
              </button>
              <button type="button" className={preset(WEEKDAYS) ? 'on' : undefined} onClick={() => setSchedule({ days: [...WEEKDAYS] })}>
                {t('Weekdays')}
              </button>
              <button type="button" className={preset(WEEKENDS) ? 'on' : undefined} onClick={() => setSchedule({ days: [...WEEKENDS] })}>
                {t('Weekends')}
              </button>
            </div>
            <div className="job-days" role="group" aria-label={t('Days')}>
              {[1, 2, 3, 4, 5, 6, 0].map(day => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={days.has(day)}
                  onClick={() => setSchedule({ days: days.has(day) ? schedule.days.filter(d => d !== day) : [...schedule.days, day] })}
                >
                  {new Date(2000, 0, 2 + day).toLocaleDateString(locale(), { weekday: 'short' })}
                </button>
              ))}
            </div>
          </>
        ) : schedule.mode === 'interval' ? (
          <div className="job-inline">
            <input
              type="number"
              min={1}
              aria-label={t('Every…')}
              value={schedule.intervalValue}
              onChange={e => setSchedule({ intervalValue: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
            <select aria-label={t('Unit')} value={schedule.intervalUnit} onChange={e => setSchedule({ intervalUnit: e.target.value as IntervalUnit })}>
              <option value="minutes">{t('Minutes')}</option>
              <option value="hours">{t('Hours')}</option>
              <option value="days">{t('Days')}</option>
            </select>
          </div>
        ) : schedule.mode === 'once' ? (
          <label className="job-inline">
            {t('Runs at')}
            <input type="datetime-local" value={schedule.runAt} onChange={e => setSchedule({ runAt: e.target.value })} />
          </label>
        ) : (
          <>
            <input className="job-custom" value={schedule.custom} placeholder={t('0 9 * * 1 or every monday 9am')} onChange={e => setSchedule({ custom: e.target.value })} />
            <span className="meta">{t('A cron expression, or a phrase Hermes reads, like every 2h or weekdays at 9am.')}</span>
          </>
        )}
        <span className="meta">{preview ?? (schedule.mode === 'time' && !schedule.days.length ? t('Pick at least one day.') : schedule.mode === 'custom' && schedule.custom.trim() ? '' : t('Not a schedule yet.'))}</span>
      </fieldset>
      <label className="field">
        {t('Deliver to')}
        <select value={draft.deliver} onChange={e => setDraft(d => ({ ...d, deliver: e.target.value }))}>
          {choices.map(choice => (
            <option key={choice.id} value={choice.id}>
              {deliveryTitle(choice.id, choice.name)}
            </option>
          ))}
        </select>
        <span className="meta">
          {target && !target.homeTargetSet ? t('This platform has no home channel yet. Set one in Hermes, or the run is only saved.') : t('Each run is also saved as its own conversation.')}
        </span>
      </label>
      {draft.runsAgent ? (
        <div className="field job-model-field">
          <label>
            {t('Model')}
            <select
              value={modelValue}
              disabled={saving || !catalog.answered}
              onChange={e => {
                const [provider = '', model = ''] = e.target.value.split('\n')
                setDraft(d => ({ ...d, provider, model }))
              }}
            >
              <option value="">{t('Profile default')}</option>
              {!listed ? <option value={modelValue}>{draft.model || draft.provider}</option> : null}
              <ModelOptions providers={catalog.providers ?? []} groups={groups} />
            </select>
          </label>
          <label>
            {t('Reasoning')}
            <select value={draft.reasoning} disabled={saving} onChange={e => setDraft(d => ({ ...d, reasoning: e.target.value }))}>
              <option value="">{t('Profile default')}</option>
              {draft.reasoning && !(REASONING_LEVELS as readonly string[]).includes(draft.reasoning) ? (
                <option value={draft.reasoning}>{draft.reasoning}</option>
              ) : null}
              {REASONING_LEVELS.map(level => (
                <option key={level} value={level}>
                  {reasoningTitle(level)}
                </option>
              ))}
            </select>
          </label>
          <ModelCatalogNote catalog={catalog} />
          <span className="meta">{t("Each run uses this model and reasoning. Profile default follows the profile's, so a change there reaches this job too.")}</span>
        </div>
      ) : null}
      {error ? <div className="error-text">{error}</div> : null}
      <div className="job-actions">
        <button type="submit" className="primary" disabled={saving || !canSave(draft)}>
          {saving ? t('Working…') : job ? t('Save') : t('Create')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  )
}
