import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { actionNote, goalCaption, heartbeatCaption, isEmpty, loopCaption, parseControl, type SessionControl } from '../state/sessionControl'
import { Icon } from './icons'

interface Props {
  liveId: string | null
  profile?: string
  connected: boolean
  /** Changes when Hermes may have changed the controls: a turn ended, a command answered. */
  pulse: number
}

/**
 * The chat's goal, loop and heartbeat above the composer, after the phone's
 * dock: each with pause or resume and an end, and the goal's extra criteria,
 * which come off one by one. Pause and resume run at once; an end asks
 * first. Only word this visit got shows: another chat clears it until
 * Hermes' read or event comes.
 */
export function ControlDock({ liveId, profile, connected, pulse }: Props) {
  const [control, setControl] = useState<SessionControl | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const current = useRef(liveId)
  current.current = liveId

  const read = useCallback(async () => {
    const sid = current.current
    if (!sid) return
    const params: Record<string, unknown> = { session_id: sid }
    if (profile) params.profile = profile
    try {
      const snapshot = parseControl(await gateway.rpc('session.control.read', params))
      if (snapshot && current.current === sid) setControl(snapshot)
    } catch {
      // A Hermes without session control shows no dock.
    }
  }, [profile])

  useEffect(() => {
    setControl(null)
    setNote(null)
    if (liveId && connected) void read()
  }, [liveId, connected, read])

  useEffect(() => {
    if (pulse && connected) void read()
  }, [pulse, connected, read])

  useEffect(
    () =>
      window.conduit.onEvent(event => {
        if (event.type !== 'session.control.update' || event.session_id !== current.current) return
        const snapshot = parseControl(event.payload)
        if (snapshot) setControl(snapshot)
      }),
    []
  )

  const act = async (action: string, args?: Record<string, unknown>, confirm?: { title: string; body: string }) => {
    const sid = current.current
    if (!sid) return
    if (confirm && !window.confirm(`${confirm.title}\n\n${confirm.body}`)) return
    setWorking(action)
    setNote(null)
    try {
      const params: Record<string, unknown> = { session_id: sid, action }
      if (args) params.args = args
      if (profile) params.profile = profile
      const answer = await gateway.rpc('session.control', params)
      if (current.current !== sid) return
      const snapshot = parseControl(answer)
      if (snapshot) setControl(snapshot)
      else await read()
      setNote(actionNote(answer) ?? null)
    } catch (e) {
      if (current.current === sid) setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(null)
    }
  }

  if (isEmpty(control)) return null
  const { goal, loop, heartbeat } = control!
  const busy = working !== null

  return (
    <div className="control-dock">
      {goal ? (
        <div className="control-row">
          <div className="control-text">
            <span className="meta">{goalCaption(goal)}</span>
            <strong>{goal.title}</strong>
            {goal.pausedReason && goal.status === 'paused' ? <span className="meta">{goal.pausedReason}</span> : null}
            {goal.subgoals.length ? (
              <ul className="control-criteria">
                {goal.subgoals.map((criterion, i) => (
                  <li key={`${i}-${criterion}`}>
                    <span>{criterion}</span>
                    <button
                      className="staged-remove"
                      aria-label={t('Remove a Criterion')}
                      title={t('Remove a Criterion')}
                      disabled={busy}
                      onClick={() => {
                        // Hermes counts criteria by place: refuse when the list moved under the click.
                        if (control?.goal?.subgoals[i] !== criterion) {
                          setNote(t("The goal's criteria changed. Pick the one to remove again."))
                          return
                        }
                        void act('subgoal.remove', { index: i + 1 })
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="control-actions">
            {goal.status !== 'done' ? (
              <button className="link" disabled={busy} onClick={() => void act(goal.status === 'paused' ? 'goal.resume' : 'goal.pause')}>
                {goal.status === 'paused' ? t('Resume Goal') : t('Pause Goal')}
              </button>
            ) : null}
            {goal.subgoals.length > 1 ? (
              <button
                className="link"
                disabled={busy}
                onClick={() =>
                  void act('subgoal.clear', undefined, { title: t('Remove every criterion?'), body: t('The goal stays; only its extra criteria go.') })
                }
              >
                {t('Remove All')}
              </button>
            ) : null}
            <button
              className="link danger"
              disabled={busy}
              onClick={() =>
                void act('goal.clear', undefined, { title: t('Clear this goal?'), body: t('Hermes stops working toward it. Set a new one with /goal.') })
              }
            >
              {t('Clear Goal')}
            </button>
          </div>
        </div>
      ) : null}
      {loop ? (
        <div className="control-row">
          <div className="control-text">
            <span className="meta">{loopCaption(loop)}</span>
            <strong>{loop.prompt}</strong>
            {loop.until ? <span className="meta">{t('Until {until}', { until: loop.until })}</span> : null}
          </div>
          <div className="control-actions">
            <button className="link" disabled={busy} onClick={() => void act(loop.status === 'paused' ? 'loop.resume' : 'loop.pause')}>
              {loop.status === 'paused' ? t('Resume Loop') : t('Pause Loop')}
            </button>
            <button
              className="link danger"
              disabled={busy}
              onClick={() =>
                void act('loop.stop', undefined, { title: t('Stop this loop?'), body: t('Hermes stops running the prompt. Start another with /loop.') })
              }
            >
              {t('Stop Loop')}
            </button>
          </div>
        </div>
      ) : null}
      {heartbeat ? (
        <div className="control-row">
          <div className="control-text">
            <span className="meta">{heartbeatCaption(heartbeat)}</span>
            <strong>{heartbeat.prompt}</strong>
          </div>
          <div className="control-actions">
            <button className="link" disabled={busy} onClick={() => void act(heartbeat.status === 'paused' ? 'heartbeat.resume' : 'heartbeat.pause')}>
              {heartbeat.status === 'paused' ? t('Resume Heartbeat') : t('Pause Heartbeat')}
            </button>
            <button
              className="link danger"
              disabled={busy}
              onClick={() =>
                void act('heartbeat.clear', undefined, {
                  title: t('Clear this heartbeat?'),
                  body: t("Hermes stops coming back to this chat when it's idle. Set another with /heartbeat.")
                })
              }
            >
              {t('Clear Heartbeat')}
            </button>
          </div>
        </div>
      ) : null}
      {note ? <div className="meta control-note">{note}</div> : null}
    </div>
  )
}
