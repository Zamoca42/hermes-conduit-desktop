import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { AppLockKind, AppLockState } from '@shared/ipc'

const useName = (kind: AppLockKind) => (kind === 'touch-id' ? t('Use Touch ID') : t('Use Windows Hello'))

/**
 * Settings' lock, after the phone's Use Face ID: Touch ID or Windows Hello
 * before Conduit opens the saved hosts, once per launch. Shown only where
 * the computer offers one.
 */
export function AppLockSetting() {
  const [state, setState] = useState<AppLockState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void window.conduit.appLock().then(next => live && setState(next))
    return () => {
      live = false
    }
  }, [])
  if (!state?.kind) return null
  const kind = state.kind
  return (
    <>
      <dt>{t('Lock')}</dt>
      <dd>
        <label className="toggle">
          <input
            type="checkbox"
            checked={state.on}
            disabled={busy}
            onChange={async e => {
              const on = e.target.checked
              setBusy(true)
              if (await window.conduit.setAppLock(on)) setState({ kind, on })
              setBusy(false)
            }}
          />
          {useName(kind)}
        </label>
        <p className="meta">
          {kind === 'touch-id' ? t('Touch ID unlocks the saved sign-in when Conduit opens.') : t('Windows Hello unlocks the saved sign-in when Conduit opens.')}
        </p>
      </dd>
    </>
  )
}

/** The window while the saved hosts wait for Touch ID or Windows Hello. */
export function LockedScreen() {
  const [kind, setKind] = useState<AppLockKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void window.conduit.appLock().then(state => setKind(state.kind))
  }, [])
  const unlock = async () => {
    setBusy(true)
    setFailed(false)
    if (!(await window.conduit.unlock())) setFailed(true)
    setBusy(false)
  }
  return (
    <div className="locked-screen">
      <h1>{t('Conduit is locked')}</h1>
      <p className="meta">{t('Your saved Hermes sign-ins open once you unlock.')}</p>
      <button className="primary" disabled={busy} onClick={() => void unlock()}>
        {kind === 'windows-hello' ? t('Unlock with Windows Hello') : t('Unlock with Touch ID')}
      </button>
      {failed ? <p className="meta">{t('Not unlocked. Try again.')}</p> : null}
    </div>
  )
}
