import { useState, type FormEvent } from 'react'
import type { SignInMethod } from '@shared/ipc'

const methodLabels: Record<SignInMethod, string> = {
  password: 'User name and password',
  token: 'Session token',
  open: 'No sign-in'
}

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

  return (
    <div className="signin">
      {url === null ? (
        <form className="signin-card" onSubmit={findHost}>
          <h1>{onCancel ? 'Add another Hermes' : 'Connect to Hermes'}</h1>
          <p>Enter the address of your Hermes dashboard, the same one the Conduit app on your phone uses.</p>
          <label className="field">
            Dashboard address
            <input
              autoFocus
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder="hermes.example.com or 192.168.1.20:9119"
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy || !address.trim()}>
            {busy ? 'Connecting…' : 'Continue'}
          </button>
          {onCancel ? (
            <button className="link-button" type="button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </form>
      ) : (
        <form className="signin-card" onSubmit={submit}>
          <h1>Sign in</h1>
          <p>{url}</p>
          {methods.length > 1 ? (
            <div className="segmented" role="group" aria-label="Sign-in method">
              {methods.map(m => (
                <button key={m} type="button" aria-pressed={m === method} onClick={() => setMethod(m)}>
                  {methodLabels[m]}
                </button>
              ))}
            </div>
          ) : null}
          {method === 'password' ? (
            <>
              <label className="field">
                User name
                <input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" spellCheck={false} />
              </label>
              <label className="field">
                Password
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
            </>
          ) : null}
          {method === 'token' ? (
            <label className="field">
              Session token
              <input autoFocus value={token} onChange={e => setToken(e.target.value)} spellCheck={false} />
            </label>
          ) : null}
          {method === 'open' ? <p>This dashboard doesn’t ask for a sign-in.</p> : null}
          {error ? <div className="error-text" role="alert">{error}</div> : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            className="link-button"
            type="button"
            onClick={() => {
              setUrl(null)
              setError(null)
            }}
          >
            Use a different address
          </button>
        </form>
      )}
    </div>
  )
}
