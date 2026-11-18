import { useState, type FormEvent } from 'react'
import type { SignInMethod } from '@shared/ipc'
import { t } from '@shared/i18n'
import { PairWithPhone } from './PairWithPhone'

const methodLabels = (): Record<SignInMethod, string> => ({
  password: t('User name and password'),
  token: t('Session token'),
  open: t('No sign-in')
})

/** Connect to a Hermes dashboard: its address first, then whatever sign-in it asks for. */
/** `onCancel`, when adding another host, goes back to the one that's open. */
export function SignIn({ notice, onCancel }: { notice?: string; onCancel?: () => void }) {
  const [address, setAddress] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [methods, setMethods] = useState<SignInMethod[]>([])
  const [method, setMethod] = useState<SignInMethod>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(notice ?? null)
  const [pairing, setPairing] = useState(false)

  async function findHost(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const probe = await window.conduit.probe(address)
    setBusy(false)
    if (!probe.ok) {
      setError(probe.error)
      return
    }
    setUrl(probe.url)
    setMethods(probe.methods)
    setMethod(probe.methods[0] ?? 'password')
    // An open dashboard needs nothing more.
    if (probe.methods.length === 1 && probe.methods[0] === 'open') {
      await signIn(probe.url, 'open')
    }
  }

  async function signIn(target: string, chosen: SignInMethod) {
    setBusy(true)
    setError(null)
    const result = await window.conduit.signIn({ url: target, method: chosen, username, password, token })
    setBusy(false)
    if (!result.ok) setError(result.error)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (url) void signIn(url, method)
  }

  if (pairing) {
    return (
      <div className="signin">
        <PairWithPhone onBack={() => setPairing(false)} />
      </div>
    )
  }

  return (
    <div className="signin">
      {url === null ? (
        <form className="signin-card" onSubmit={findHost}>
          <h1>{onCancel ? t('Add another Hermes') : t('Connect to Hermes')}</h1>
          <p>{t('Enter the address of your Hermes dashboard, the same one the Conduit app on your phone uses.')}</p>
          <label className="field">
            {t('Dashboard address')}
            <input
              autoFocus
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder={t('hermes.example.com or 192.168.1.20:9119')}
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy || !address.trim()}>
            {busy ? t('Connecting…') : t('Continue')}
          </button>
          <div className="or-line">{t('or')}</div>
          <button className="secondary pair-button" type="button" onClick={() => setPairing(true)}>
            {t('Pair with your iPhone')}
          </button>
          {onCancel ? (
            <button className="link-button" type="button" onClick={onCancel}>
              {t('Cancel')}
            </button>
          ) : null}
        </form>
      ) : (
        <form className="signin-card" onSubmit={submit}>
          <h1>{t('Sign in')}</h1>
          <p>{url}</p>
          {methods.length > 1 ? (
            <div className="segmented" role="group" aria-label={t('Sign-in method')}>
              {methods.map(m => (
                <button key={m} type="button" aria-pressed={m === method} onClick={() => setMethod(m)}>
                  {methodLabels()[m]}
                </button>
              ))}
            </div>
          ) : null}
          {method === 'password' ? (
            <>
              <label className="field">
                {t('User name')}
                <input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
              </label>
              <label className="field">
                {t('Password')}
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
            </>
          ) : null}
          {method === 'token' ? (
            <label className="field">
              {t('Session token')}
              <input autoFocus value={token} onChange={e => setToken(e.target.value)} spellCheck={false} />
            </label>
          ) : null}
          {method === 'open' ? <p>{t('This dashboard doesn’t ask for a sign-in.')}</p> : null}
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t('Signing in…') : t('Sign in')}
          </button>
          <button
            className="link-button"
            type="button"
            onClick={() => {
              setUrl(null)
              setError(null)
            }}
          >
            {t('Use a different address')}
          </button>
        </form>
      )}
    </div>
  )
}
