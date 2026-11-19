import { useEffect, useState } from 'react'
import type { HostSummary } from '@shared/ipc'
import { t } from '@shared/i18n'
import { hostName } from './TitleBar'

/**
 * Ask Which Dashboard at Launch, after the phone's (issue 1908): Settings'
 * switch, shown only with two or more hosts saved.
 */
export function AskDashboardSetting({ hosts }: { hosts: number }) {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void window.conduit.askHostAtLaunch().then(next => live && setOn(next))
    return () => {
      live = false
    }
  }, [])
  if (hosts < 2 || on === null) return null
  return (
    <>
      <dt>{t('Saved Dashboards')}</dt>
      <dd>
        <label className="toggle">
          <input
            type="checkbox"
            checked={on}
            onChange={async e => {
              const next = e.target.checked
              if (await window.conduit.setAskHostAtLaunch(next)) setOn(next)
            }}
          />
          {t('Ask Which Dashboard at Launch')}
        </label>
        <p className="meta">{t('When Conduit opens, your dashboards stay listed until you pick one, instead of signing in to the last one you used.')}</p>
      </dd>
    </>
  )
}

/** The window at launch with that switch on: the saved hosts, until one is picked. */
export function DashboardChoice({ hosts, onAdd }: { hosts: HostSummary[]; onAdd: () => void }) {
  const [opening, setOpening] = useState<string | null>(null)
  return (
    <div className="dashboard-choice">
      <h1>{t('Your dashboards')}</h1>
      <ul>
        {hosts.map(host => (
          <li key={host.url}>
            <button
              disabled={opening !== null}
              title={host.url}
              onClick={async () => {
                setOpening(host.url)
                if (!(await window.conduit.switchHost(host.url))) setOpening(null)
              }}
            >
              <span className="host-label">{hostName(host.url)}</span>
              {host.username ? <span className="meta">{host.username}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <button className="link" disabled={opening !== null} onClick={onAdd}>
        {t('Add a dashboard')}
      </button>
    </div>
  )
}
