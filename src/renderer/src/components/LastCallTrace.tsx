import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { lastCallTrace, lastReadingTrace, subscribeCallTrace } from '../state/callTrace'

/**
 * Settings' Last live call: the steps of the last Grok Live, Qwen Live,
 * Local Live or GPT-Live call, shown and copied to paste into an issue,
 * after the phone's Diagnostics & logs. What was said is never in them.
 * With `reading`, the last Read Aloud reading's.
 */
export function LastCallTrace({ reading = false }: { reading?: boolean }) {
  const [, setVersion] = useState(0)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => subscribeCallTrace(() => setVersion(v => v + 1)), [])
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  const trace = reading ? lastReadingTrace() : lastCallTrace()
  if (!trace) return <p className="meta">{reading ? t('Nothing read aloud since Conduit opened.') : t('No live call since Conduit opened.')}</p>
  const report = trace.report()
  return (
    <div className="call-trace">
      <p className="meta">
        {t('{mode}, {count} steps', { mode: trace.name, count: String(trace.steps.length) })}
        {trace.isEnded ? '' : ` · ${t('In progress')}`}
      </p>
      <div className="call-trace-actions">
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? t('Hide') : t('Show')}
        </button>
        <button
          className="link"
          onClick={() =>
            void navigator.clipboard.writeText(report).then(
              () => setCopied(true),
              () => undefined
            )
          }
        >
          {copied ? t('Copied') : t('Copy')}
        </button>
      </div>
      {open ? <pre className="call-trace-steps">{report}</pre> : null}
    </div>
  )
}
