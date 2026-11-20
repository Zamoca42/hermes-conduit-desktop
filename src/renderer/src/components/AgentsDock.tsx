import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { elapsed, isActive, statusTitle, type DelegateAgent } from '../state/agents'
import { isRunningProcess, type BackgroundProcess } from '../state/processes'
import { Icon } from './icons'
import { ask } from '../state/dialogs'

interface Props {
  agents: DelegateAgent[]
  /** The chat's own turn is still running. */
  running: boolean
  chatKey: string
  steer: (id: string, text: string) => Promise<boolean>
  stop: (id: string) => Promise<void>
  tail: (id: string) => Promise<{ text: string; truncated: boolean } | null>
  processes: BackgroundProcess[]
  kill: (id: string) => Promise<string | null>
}

function AgentCard({ agent, now, steer, stop, tail }: { agent: DelegateAgent; now: number } & Pick<Props, 'steer' | 'stop' | 'tail'>) {
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const active = isActive(agent)
  const time = active && agent.startedAt ? (now - agent.startedAt) / 1000 : agent.durationS

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setNote(null)
    try {
      await work()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`agent-card status-${agent.status}`}>
      <div className="agent-head">
        <strong>{agent.goal || t('Delegate agent')}</strong>
        <span className="spacer" />
        <span className="meta">
          {statusTitle(agent.status)}
          {time !== undefined ? ` · ${elapsed(time)}` : ''}
        </span>
      </div>
      {agent.model || (active && agent.tool) ? (
        <div className="meta">{[agent.model, active && agent.tool ? t('Using {tool}', { tool: agent.tool }) : null].filter(Boolean).join(' · ')}</div>
      ) : null}
      {agent.summary || agent.line ? <div className="agent-line">{agent.summary ?? agent.line}</div> : null}
      {output !== null ? <pre className="agent-output">{output || t('Output appears here once the agent writes some.')}</pre> : null}
      {active ? (
        <form
          className="agent-steer"
          onSubmit={e => {
            e.preventDefault()
            const text = words.trim()
            if (!text) return
            void run(async () => {
              const taken = await steer(agent.id, text)
              if (taken) setWords('')
              setNote(taken ? t('Sent. The agent reads it at its next step.') : t('This agent has already finished.'))
            })
          }}
        >
          <input
            value={words}
            onChange={e => setWords(e.target.value)}
            placeholder={t('Steer this agent…')}
            aria-label={t('Steer this agent…')}
            disabled={busy}
          />
          <button type="submit" className="secondary" disabled={busy || !words.trim()}>
            {t('Steer')}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => stop(agent.id))}>
            {t('Stop agent')}
          </button>
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const answer = await tail(agent.id)
                setOutput(answer ? (answer.truncated ? `…${answer.text}` : answer.text) : '')
              })
            }
          >
            {t('Live output')}
          </button>
        </form>
      ) : null}
      {note ? <div className="meta">{note}</div> : null}
    </li>
  )
}

function ProcessCard({ process, kill }: { process: BackgroundProcess; kill: Props['kill'] }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const running = isRunningProcess(process)
  const subtitle = [
    process.uptimeS !== undefined ? elapsed(process.uptimeS) : null,
    process.pid !== undefined ? `PID ${process.pid}` : null,
    running ? null : t('Exited'),
    process.cwd || null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className={`agent-card process-card${running ? ' status-running' : ' status-completed'}`}>
      <div className="agent-head">
        <code className="process-command">{process.command || process.id}</code>
        <span className="spacer" />
        {running ? (
          <button
            className="link danger"
            disabled={busy}
            onClick={async () => {
              if (!(await ask(`${t('Stop this process?')}\n\n${t('Hermes ends it on your host. Anything it was serving or watching stops with it.')}`)))
                return
              setBusy(true)
              setNote(null)
              kill(process.id)
                .then(failure => setNote(failure))
                .catch(e => setNote(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            {t('Stop process')}
          </button>
        ) : null}
      </div>
      {subtitle ? <div className="meta process-subtitle">{subtitle}</div> : null}
      {process.output ? <pre className="agent-output">{process.output}</pre> : null}
      {note ? <div className="meta">{note}</div> : null}
    </li>
  )
}

/**
 * The delegate agents a chat started, after the phone's waiting line and
 * sheet: "Waiting for 2 background agents" above the composer once the
 * chat's own turn has ended, opening into a card per agent with Steer,
 * Stop and its live output. Ended agents stay until the chat changes or
 * the × hides them. The chat's background processes (servers, watchers,
 * long builds) list under them, each with Stop, as the phone's sheet does.
 */
export function AgentsDock({ agents, running, chatKey, steer, stop, tail, processes, kill }: Props) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [now, setNow] = useState(Date.now())
  const active = agents.filter(isActive).length
  const serving = processes.filter(isRunningProcess).length

  useEffect(() => {
    setOpen(false)
    setHidden(false)
  }, [chatKey])
  // A new agent shows the line again.
  useEffect(() => {
    if (active || serving) setHidden(false)
  }, [active, serving])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  if ((!agents.length && !processes.length) || hidden) return null
  const label = active
    ? running
      ? t('{count} background agents running', { count: String(active) })
      : t('Waiting for {count} background agents', { count: String(active) })
    : serving
      ? `${t('Background processes')} · ${serving}`
      : agents.length
        ? t('Background agents finished')
        : t('Background processes')

  return (
    <div className={`plan-dock agents-dock${open ? ' open' : ''}`}>
      {open ? (
        <ul className="plan-items agent-cards" aria-label={t('Delegate agents')}>
          <li className="meta agent-caption">{t('Started by Hermes for this chat. They keep running until they finish or you stop them.')}</li>
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} now={now} steer={steer} stop={stop} tail={tail} />
          ))}
          {processes.length ? <li className="agent-section">{t('Background processes')}</li> : null}
          {processes.map(process => (
            <ProcessCard key={process.id} process={process} kill={kill} />
          ))}
        </ul>
      ) : null}
      <div className="plan-line">
        <button className="plan-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {active ? <span className="spinner" aria-hidden="true" /> : null}
          <strong>{label}</strong>
          <span className="spacer" />
          <Icon name="chevron" />
        </button>
        {!active && !serving ? (
          <button className="staged-remove" aria-label={t('Hide')} title={t('Hide')} onClick={() => setHidden(true)}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
