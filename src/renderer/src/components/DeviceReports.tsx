import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { endLine, type DeviceReport } from '@shared/deviceReports'

function useDeviceReports() {
  const [state, setState] = useState<{ reports: DeviceReport[]; offered: DeviceReport[] }>({ reports: [], offered: [] })
  const read = useCallback(() => {
    void window.conduit.deviceReports().then(setState, () => undefined)
  }, [])
  useEffect(() => {
    read()
    return window.conduit.onDeviceReports(read)
  }, [read])
  return state
}

/**
 * After a crash or a freeze, a card over the main screen asks once whether
 * to send the report to Conduit's developer, after the phone's. Not now
 * keeps it in Settings > Device reports; nothing goes without Send.
 */
export function CrashReportBanner() {
  const { offered } = useDeviceReports()
  const [phase, setPhase] = useState<'ask' | 'sending' | 'sent' | 'failed'>('ask')
  const [asked, setAsked] = useState<DeviceReport[]>([])
  // The card asks about what was offered when it showed; a report that comes while it's up joins.
  useEffect(() => {
    if (phase === 'ask') setAsked(offered)
  }, [offered, phase])
  if (phase === 'sent')
    return (
      <div className="banner report-banner" role="status">
        <span className="dot ok" />
        {t('Report sent. Thank you!')}
        <button
          onClick={() => {
            setPhase('ask')
            setAsked([])
          }}
        >
          {t('Dismiss')}
        </button>
      </div>
    )
  if (!asked.length) return null
  const ids = asked.map(r => r.id)
  const send = async () => {
    setPhase('sending')
    setPhase((await window.conduit.sendDeviceReports(ids).catch(() => false)) ? 'sent' : 'failed')
  }
  return (
    <div className="banner report-banner" role="alertdialog" aria-label={t('Device reports')}>
      <span className="dot warn" />
      <span className="report-banner-text">
        <strong>
          {asked[0]!.kind === 'hang'
            ? t('Conduit froze last time')
            : asked[0]!.process === 'window'
              ? t('Conduit closed unexpectedly last time')
              : t('Part of Conduit stopped unexpectedly')}
        </strong>{' '}
        {phase === 'sending'
          ? t('Sending the report…')
          : phase === 'failed'
            ? t('Couldn’t send the report')
            : t('Send the report to Conduit’s developer? It shows where the app stopped, never your messages.')}
      </span>
      <button disabled={phase === 'sending'} onClick={() => void send()}>
        {phase === 'failed' ? t('Try Again') : t('Send')}
      </button>
      <button
        disabled={phase === 'sending'}
        onClick={() => {
          void window.conduit.declineDeviceReports(ids)
          setPhase('ask')
          setAsked([])
        }}
      >
        {t('Not now')}
      </button>
    </div>
  )
}

/** Settings > Device reports: the crash and freeze reports kept here, with Send for those not sent. */
export function DeviceReportsSetting() {
  const { reports } = useDeviceReports()
  const [sending, setSending] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  if (!reports.length) return <p className="meta">{t('No crash or freeze reports.')}</p>
  const unsent = reports.filter(r => r.state !== 'sent')
  return (
    <div className="device-reports">
      <ul>
        {reports.map(report => (
          <li key={report.id}>
            <span>{new Date(report.at).toLocaleString()}</span>
            <span className="meta">
              {endLine(report)} · {report.version}
              {report.state === 'sent' ? ` · ${t('Sent')}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {unsent.length ? (
        <div className="call-trace-actions">
          <button
            className="link"
            disabled={sending === 'sending'}
            onClick={() => {
              setSending('sending')
              void window.conduit.sendDeviceReports(unsent.map(r => r.id)).then(
                ok => setSending(ok ? 'sent' : 'failed'),
                () => setSending('failed')
              )
            }}
          >
            {sending === 'sending' ? t('Sending…') : t('Send')}
          </button>
          {sending === 'failed' ? <span className="error-text">{t('Couldn’t send the report')}</span> : null}
        </div>
      ) : sending === 'sent' ? (
        <p className="meta">{t('Report sent. Thank you!')}</p>
      ) : null}
    </div>
  )
}
