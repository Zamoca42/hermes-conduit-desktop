import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  KINDS,
  LOCAL,
  draftRequest,
  emptyDraft,
  itemDetails,
  kindTitle,
  sourceCaption,
  sourceStatus,
  vaultItems,
  vaultSources,
  type VaultDraft,
  type VaultItem,
  type VaultSource
} from '../state/vault'
import { Icon } from './icons'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const unsupported = (e: unknown) => /method not found|unknown method|-32601/i.test(message(e)) || (e as { code?: unknown })?.code === -32601

interface Props {
  bots: { name: string; title: string }[]
  profile: string
  onBack: () => void
}

/**
 * Settings > Passwords & logins, after the phone's CredentialVaultSettingsPage:
 * what Hermes keeps to sign in and fill pages with, and the password managers
 * it takes logins from. Write-only: it lists what Hermes describes, never a
 * password, which Hermes doesn't send.
 */
/** Where the page's last answer is kept: two RPCs, so a name of its own. */
const vaultKey = (profile?: string) => `rpc:vault:${profile || 'default'}`

export function VaultPage({ bots, profile: initialProfile, onBack }: Props) {
  const [profile, setProfile] = useState(initialProfile)
  const [items, setItems] = useState<VaultItem[] | null>(null)
  const [sources, setSources] = useState<VaultSource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [unlocking, setUnlocking] = useState<VaultSource | null>(null)
  const reads = useRef(0)

  const call = useCallback(
    <T,>(method: string, params: Record<string, unknown> = {}) => gateway.rpc<T>(method, profile && profile !== 'default' ? { ...params, profile } : params),
    [profile]
  )

  const reload = useCallback(async () => {
    const read = ++reads.current
    setLoading(true)
    const keep = answerKeeper(vaultKey(profile))
    try {
      // Sources first: an unlocked manager's items come with the list.
      const rawSources = await call('vault.sources')
      const rawItems = await call('vault.list')
      const s = vaultSources(rawSources)
      const i = vaultItems(rawItems)
      if (read !== reads.current) return
      setSources(s)
      setItems(i)
      // The items' metadata and the sources, never a password: Hermes' list has none.
      keep({ sources: rawSources, items: rawItems })
      setError(null)
      setNoVault(false)
    } catch (e) {
      if (read !== reads.current) return
      if (unsupported(e)) setNoVault(true)
      // A read that fails keeps what's shown.
      else setError(message(e))
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [call])

  useEffect(() => {
    // What the page listed last time on this dashboard and profile, until Hermes answers.
    const kept = keptAnswer(vaultKey(profile)) as { sources?: unknown; items?: unknown } | undefined
    setItems(kept?.items ? vaultItems(kept.items) : null)
    setSources(kept?.sources ? vaultSources(kept.sources) : [])
    void reload()
  }, [reload])

  /** Runs a change, then reads the vault again; a change that failed still says so. */
  const run = async (id: string, change: () => Promise<unknown>) => {
    if (busy.has(id)) return
    setBusy(b => new Set(b).add(id))
    let failed: string | null = null
    try {
      await change()
    } catch (e) {
      failed = message(e)
    }
    await reload()
    if (failed) setError(failed)
    setBusy(b => {
      const next = new Set(b)
      next.delete(id)
      return next
    })
  }

  const remove = (item: VaultItem) => {
    if (!window.confirm(`${t('Remove this item?')}\n\n${t("Hermes forgets “{name}”. This can't be undone.", { name: item.label })}`)) return
    void run(item.id, () => call('vault.remove', { id: item.id }))
  }

  const profileName = bots.find(b => b.name === profile)?.title ?? profile
  const managers = sources.filter(s => s.name !== LOCAL)

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Passwords & logins')}</h1>
        <span className="spacer" />
        {bots.length > 1 ? (
          <select className="language-select" value={profile} aria-label={t('Bot')} onChange={e => setProfile(e.target.value)}>
            {bots.map(bot => (
              <option key={bot.name} value={bot.name}>
                {bot.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <p className="meta">
        {t(
          'For the {name} profile. Ask Hermes to sign in to a site and it asks you for the login once, on the spot, then signs in by itself. Passwords stay encrypted on the Hermes computer and go straight into the page: the model never sees them, and Conduit never shows them.',
          { name: profileName }
        )}
      </p>

      <section className="pset-section">
        <h2>{t('Saved')}</h2>
        {noVault && !items ? (
          <p className="meta">{t('This Hermes has no credential vault yet. Update Hermes to 0.23 or later to keep logins here.')}</p>
        ) : items ? (
          <>
            {!items.length ? (
              <p className="meta">
                {t(
                  "Nothing saved yet. You don't have to add anything: Hermes asks for a login the first time it needs one. Use Add to enter one ahead of time."
                )}
              </p>
            ) : null}
            {items.map(item => (
              <div key={item.id} className="vault-item">
                <Icon name={item.kind === 'payment' ? 'file' : item.kind === 'address' ? 'pin' : 'link'} />
                <div className="vault-item-text">
                  <span>
                    <strong>{item.label}</strong>
                    {item.hasOTP ? <span className="vault-badge">{t('2FA codes')}</span> : null}
                  </span>
                  <span className="meta">{itemDetails(item, sources)}</span>
                </div>
                {item.source === LOCAL ? (
                  <button
                    className="link danger"
                    disabled={busy.has(item.id)}
                    aria-label={t('Remove {name}', { name: item.label })}
                    onClick={() => remove(item)}
                  >
                    {t('Remove')}
                  </button>
                ) : null}
              </div>
            ))}
          </>
        ) : !loading && error ? null : (
          <p className="meta">{t('Loading…')}</p>
        )}
        {error ? <p className="error-text">{error}</p> : null}
        {(error && !items) || (noVault && !items) ? (
          <button className="secondary" disabled={loading} onClick={() => void reload()}>
            {t('Try again')}
          </button>
        ) : null}
        {items && !adding ? (
          <button className="secondary" onClick={() => setAdding(true)}>
            {t('Add a login, card or address')}
          </button>
        ) : null}
        {adding ? (
          <AddForm
            onCancel={() => setAdding(false)}
            onSave={async request => {
              await call('vault.add', {
                kind: request.kind,
                label: request.label,
                secret: request.secret,
                ...(request.origin ? { origin: request.origin } : {})
              })
              setAdding(false)
              await reload()
            }}
          />
        ) : null}
      </section>

      {managers.length ? (
        <section className="pset-section">
          <h2>{t('Password managers')}</h2>
          <p className="meta">
            {t(
              "Hermes picks up a password manager installed on its computer. It asks you to unlock one the first time it needs a login from it; only the manager's session stays in Hermes' memory, never your master password."
            )}
          </p>
          {managers.map(source => (
            <div key={source.name} className="vault-source">
              <div className="pset-row">
                <span>
                  <strong>{source.displayName}</strong> <span className="vault-badge">{sourceStatus(source)}</span>
                </span>
                {source.installed ? (
                  <label className="switch-inline">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      disabled={busy.has(source.name)}
                      aria-label={source.displayName}
                      onChange={e => void run(source.name, () => call('vault.source.set', { name: source.name, enabled: e.target.checked }))}
                    />
                  </label>
                ) : null}
              </div>
              <p className="meta">{sourceCaption(source)}</p>
              {source.installed && source.enabled ? (
                source.unlocked ? (
                  <button
                    className="secondary"
                    disabled={busy.has(source.name)}
                    onClick={() => void run(source.name, () => call('vault.lock', { name: source.name }))}
                  >
                    {t('Lock')}
                  </button>
                ) : unlocking?.name === source.name ? (
                  <UnlockForm
                    source={source}
                    onCancel={() => setUnlocking(null)}
                    onUnlock={async password => {
                      await call('vault.unlock', { name: source.name, password })
                      setUnlocking(null)
                      await reload()
                    }}
                  />
                ) : (
                  <button className="secondary" disabled={busy.has(source.name)} onClick={() => setUnlocking(source)}>
                    {t('Unlock')}
                  </button>
                )
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}

/** The Add form, after the phone's VaultItemAddSheet. Its fields live only here and go once onto the socket. */
function AddForm({
  onCancel,
  onSave
}: {
  onCancel: () => void
  onSave: (request: { kind: string; label: string; origin: string | null; secret: Record<string, string> }) => Promise<void>
}) {
  const [draft, setDraft] = useState<VaultDraft>(emptyDraft)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (key: keyof VaultDraft) => (e: { target: { value: string } }) => setDraft(d => ({ ...d, [key]: e.target.value }))
  const field = (key: keyof VaultDraft, label: string, type = 'text') => (
    <input
      className="pset-note"
      type={type}
      value={draft[key]}
      placeholder={label}
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
      onChange={set(key)}
    />
  )
  const save = async () => {
    const outcome = draftRequest(draft)
    if (!outcome.ok) return setProblem(outcome.problem)
    setSaving(true)
    setProblem(null)
    try {
      await onSave(outcome.request)
    } catch (e) {
      setProblem(message(e))
      setSaving(false)
    }
  }
  return (
    <div className="vault-form">
      <h3>{t('Add to vault')}</h3>
      <div className="pset-row">
        <span>{t('Kind')}</span>
        <select
          className="language-select"
          value={draft.kind}
          aria-label={t('Kind')}
          onChange={e => setDraft(d => ({ ...d, kind: e.target.value as VaultDraft['kind'] }))}
        >
          {KINDS.map(kind => (
            <option key={kind} value={kind}>
              {kindTitle(kind)}
            </option>
          ))}
        </select>
      </div>
      <span className="meta">{t('Name and site')}</span>
      {field('label', t('Label, like GitHub work account'))}
      {field('origin', draft.kind === 'login' ? t('Site, like github.com') : t('Site (optional)'))}
      {draft.kind === 'login' ? (
        <>
          <span className="meta">{t('Signs in with')}</span>
          <select className="language-select" value={draft.identifierType} aria-label={t('Signs in with')} onChange={set('identifierType')}>
            <option value="email">{t('Email')}</option>
            <option value="phone">{t('Phone')}</option>
            <option value="username">{t('Username')}</option>
          </select>
          {field('identifier', draft.identifierType === 'email' ? t('Email') : draft.identifierType === 'phone' ? t('Phone') : t('Username'))}
          {field('password', t('Password'), 'password')}
          {field('otpSecret', t('Authenticator key (optional)'), 'password')}
          <span className="meta">
            {t('The setup key a site shows when you turn on two-factor sign-in, or its otpauth:// link. With it saved, Hermes makes the codes itself.')}
          </span>
        </>
      ) : draft.kind === 'payment' ? (
        <>
          {field('cardNumber', t('Card number'), 'password')}
          {field('cardholderName', t('Name on card (optional)'))}
          <div className="vault-pair">
            {field('expMonth', t('Month'))}
            {field('expYear', t('Year'))}
          </div>
          {field('cvc', t('Security code'), 'password')}
          {field('postalCode', t('Billing postal code (optional)'))}
        </>
      ) : (
        <>
          {field('addressLine1', t('Street'))}
          {field('addressLine2', t('Apartment, suite (optional)'))}
          {field('city', t('City'))}
          {field('state', t('State or region (optional)'))}
          {field('postalCode', t('Postal code'))}
          {field('country', t('Country'))}
        </>
      )}
      <span className="meta">{t('Saved encrypted on the Hermes computer. Conduit keeps none of it and never shows it again.')}</span>
      {problem ? <p className="error-text">{problem}</p> : null}
      <div className="pset-actions">
        <button className="secondary" onClick={onCancel} disabled={saving}>
          {t('Cancel')}
        </button>
        <button className="primary" onClick={() => void save()} disabled={saving}>
          {t('Save')}
        </button>
      </div>
    </div>
  )
}

function UnlockForm({ source, onCancel, onUnlock }: { source: VaultSource; onCancel: () => void; onUnlock: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const unlock = async () => {
    if (!password) return
    setWorking(true)
    setProblem(null)
    try {
      await onUnlock(password)
    } catch (e) {
      setProblem(message(e))
      setWorking(false)
    }
  }
  return (
    <div className="vault-form">
      <h3>{t('Unlock {name}', { name: source.displayName })}</h3>
      <input
        className="pset-note"
        type="password"
        autoFocus
        value={password}
        placeholder={t('Master password')}
        aria-label={t('Master password')}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') void unlock()
        }}
      />
      <span className="meta">
        {t("Hermes hands your master password to {name} on its computer and forgets it. It's never saved, logged or shown to the model.", {
          name: source.displayName
        })}
      </span>
      {problem ? <p className="error-text">{problem}</p> : null}
      <div className="pset-actions">
        <button className="secondary" onClick={onCancel} disabled={working}>
          {t('Cancel')}
        </button>
        <button className="primary" onClick={() => void unlock()} disabled={working || !password}>
          {t('Unlock')}
        </button>
      </div>
    </div>
  )
}
