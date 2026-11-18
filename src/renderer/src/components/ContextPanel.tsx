import { useEffect, useRef, useState } from 'react'
import { gateway } from '../gateway'
import { locale, t } from '@shared/i18n'
import { money, parseBreakdown, parseSessionUsage, sessionUsagePath, type ContextBreakdown, type SessionUsage } from '../state/context'
import type { OpenChat } from '../state/useChat'
import { Icon } from './icons'

interface Props {
  chat: OpenChat
  profile?: string
  /** Whether a reply is running: Hermes refuses a compression mid-turn. */
  running: boolean
  onClose: () => void
  /** Runs /compress in the chat, as the typed command does. */
  onCompress: () => void
}

type UsageReadout = { kind: 'loading' } | { kind: 'loaded'; usage: SessionUsage } | { kind: 'empty' } | { kind: 'update' } | { kind: 'failed' }

const count = (value: number) => value.toLocaleString(locale())

/**
 * The phone's Context sheet: how full the chat's window is and what fills
 * it, Compress Now, and the chat's tokens and cost. Esc or a click outside
 * closes it.
 */
export function ContextPanel({ chat, profile, running, onClose, onCompress }: Props) {
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null)
  const [usage, setUsage] = useState<UsageReadout>({ kind: 'loading' })
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    if (chat.liveId) {
      gateway
        .rpc('session.context_breakdown', { session_id: chat.liveId })
        .then(raw => live && setBreakdown(parseBreakdown(raw)))
        .catch(() => undefined)
    }
    const id = chat.storedId ?? chat.liveId
    if (id) {
      gateway
        .http('GET', sessionUsagePath(id, profile))
        .then(raw => live && setUsage({ kind: 'loaded', usage: parseSessionUsage(raw) }))
        .catch(e => {
          if (!live) return
          const code = (e as { code?: unknown }).code
          const text = e instanceof Error ? e.message : String(e)
          // The plugin's answer for a chat with no row yet; any other 404 is an older plugin.
          setUsage(code === 404 ? (/^session not found$/i.test(text.trim()) ? { kind: 'empty' } : { kind: 'update' }) : { kind: 'failed' })
        })
    } else {
      setUsage({ kind: 'empty' })
    }
    return () => {
      live = false
    }
  }, [chat.liveId, chat.storedId, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (panel.current && !panel.current.contains(target) && !target.closest?.('.context-chip')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // The breakdown is Hermes' full accounting, as the phone takes it; the live tick until it's read.
  const window_ = breakdown?.window ?? chat.context ?? null
  const capacity = Math.max(window_?.max ?? 0, breakdown?.window?.max ?? 0)
  const shown = (breakdown?.categories ?? []).filter(c => c.tokens > 0)
  const total = Math.max(capacity, shown.reduce((sum, c) => sum + c.tokens, 0), 1)
  const percent = Math.round(window_?.percent ?? 0)

  return (
    <div className="model-picker context-panel" role="dialog" aria-label={t('Context')} ref={panel}>
      <div className="model-current">
        <span className="model-current-name">{t('Context')}</span>
        <button className="staged-remove" aria-label={t('Close')} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="context-body">
        <dl className="job-facts">
          <dt>{t('Used')}</dt>
          <dd>{t('{count} tokens', { count: count(window_?.used ?? 0) })}</dd>
          <dt>{t('Capacity')}</dt>
          <dd>{capacity ? t('{count} tokens', { count: count(capacity) }) : '—'}</dd>
        </dl>
        <div className="context-meter">
          <div className="context-meter-top">
            <span className="meta">{t('Window usage')}</span>
            <strong>{percent}%</strong>
          </div>
          <div className="context-bar" role="img" aria-label={t('Window usage')}>
            {shown.length ? (
              shown.map(c => <span key={c.id} style={{ width: `max(${(c.tokens / total) * 100}%, 2px)`, background: c.color }} title={`${c.label}: ${count(c.tokens)}`} />)
            ) : (
              <span style={{ width: `${Math.min(100, window_?.percent ?? 0)}%`, background: 'var(--accent)' }} />
            )}
          </div>
        </div>
        <div className="context-compress">
          <button
            className="secondary"
            disabled={running}
            onClick={() => {
              onClose()
              onCompress()
            }}
          >
            {t('Compress Now')}
          </button>
          <span className="meta">{t('Summarizes older messages so the chat has room again. The chat and its memory stay.')}</span>
        </div>
        {shown.length ? (
          <section className="job-section">
            <h3>{t('Breakdown')}</h3>
            {shown.map(c => (
              <div key={c.id} className="context-row">
                <span className="context-dot" style={{ background: c.color }} />
                <span>{c.label}</span>
                <span className="meta">{count(c.tokens)}</span>
              </div>
            ))}
          </section>
        ) : null}
        <section className="job-section">
          <h3>{t('Usage')}</h3>
          {usage.kind === 'loading' ? <span className="meta">{t('Loading…')}</span> : null}
          {usage.kind === 'empty' ? <span className="meta">{t('Nothing has run in this chat yet.')}</span> : null}
          {usage.kind === 'update' ? <span className="meta">{t("Update the Conduit plugin on this host to see this chat's tokens and cost.")}</span> : null}
          {usage.kind === 'failed' ? <span className="meta">{t("Couldn't load this chat's usage.")}</span> : null}
          {usage.kind === 'loaded' ? (
            <>
              <dl className="job-facts">
                <dt>{t('Input')}</dt>
                <dd>{count(usage.usage.input)}</dd>
                <dt>{t('Output')}</dt>
                <dd>{count(usage.usage.output)}</dd>
                {usage.usage.cacheRead ? (
                  <>
                    <dt>{t('Cache reads')}</dt>
                    <dd>{count(usage.usage.cacheRead)}</dd>
                  </>
                ) : null}
                <dt>{usage.usage.costStatus === 'estimated' ? t('Estimated cost') : t('Cost')}</dt>
                <dd>{costText(usage.usage)}</dd>
                <dt>{t('API calls')}</dt>
                <dd>{count(usage.usage.apiCalls)}</dd>
              </dl>
              {usage.usage.compressions || usage.usage.subagentRuns ? <span className="meta">{t("Includes the chat's compressions and the agents it started.")}</span> : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function costText(usage: SessionUsage): string {
  switch (usage.costStatus) {
    case 'unknown':
      return t('Not reported by this host')
    case 'included':
      return t('Included in your plan')
    case 'partial':
      return usage.costUSD === null ? t('Not reported by this host') : t('At least {amount}', { amount: money(usage.costUSD, locale()) })
    default:
      return usage.costUSD === null ? t('Not reported by this host') : money(usage.costUSD, locale())
  }
}
