import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  ProviderService,
  blocksSave,
  catalogNames,
  KEY_ORDERS,
  endpointID,
  isBaseURL,
  isConnected,
  keyOrderFrom,
  keyOrderKey,
  keyState,
  providerStatus,
  removableRows,
  removableVars,
  showsKeyOrder,
  statusTitle,
  takenEndpointIDs,
  type KeyOrder,
  type ProviderEntry,
  type SignIn
} from '../state/providers'
import { readConfig, updateConfig, valueAt, withValue, type Http } from '../state/profileConfig'
import { ProviderLogo } from './ProviderLogo'
import { Icon } from './icons'

const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, timeoutMs?: number) => gateway.http(method, path, body, timeoutMs)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The connected providers as last shown, kept per dashboard and profile (Screens that open on their last answer). */
interface KeptProvider {
  id: string
  name: string
  title: string
  warn: boolean
}
const summaryKey = (profile: string) => `providers:summary:${profile || 'default'}`
function keptSummary(profile: string): KeptProvider[] | null {
  const raw = keptAnswer(summaryKey(profile))
  if (!Array.isArray(raw)) return null
  return raw.filter(
    (e): e is KeptProvider => !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.title === 'string'
  ).map(e => ({ ...e, warn: e.warn === true }))
}

interface Props {
  profile: string
  profileName: string
  profiles: string[]
  /** The provider the default model runs on, which can't be removed. */
  defaultProvider: string
  /** Every name Hermes' model catalog lists, so a new endpoint never takes one. */
  catalog: string[] | null
  /** Hermes' model lists change with the providers: read them again. */
  onChanged: () => void
}

/**
 * Settings > Models' Providers, after the phone's Models & providers: the
 * connected providers, Add a provider and a provider's page, with a shared
 * key or one only this profile uses, a sign-in, or a custom endpoint.
 */
export function ProvidersSection({ profile, profileName, profiles, defaultProvider, catalog, onChanged }: Props) {
  const service = useMemo(() => new ProviderService(request, profile, profiles), [profile, profiles])
  const [entries, setEntries] = useState<ProviderEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const generation = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++generation.current
    setError(null)
    try {
      const keep = answerKeeper(summaryKey(profile))
      const fresh = await service.read()
      if (generation.current === mine) {
        setEntries(fresh)
        // Which providers are connected and how, never a key, a preview or a sign-in.
        keep(fresh.filter(isConnected).map(e => ({ id: e.id, name: e.name, title: statusTitle(e), warn: providerStatus(e) === 'oldCopy' })))
      }
    } catch (e) {
      if (generation.current === mine) setError(message(e))
    }
  }, [service])

  const [kept, setKept] = useState<KeptProvider[] | null>(null)
  useEffect(() => {
    setEntries(null)
    setKept(keptSummary(profile))
    setOpen(null)
    setAdding(false)
    void reload()
  }, [reload])

  const changed = useCallback(async () => {
    await reload()
    onChanged()
  }, [reload, onChanged])

  const entry = open ? entries?.find(e => e.id === open) : undefined
  if (open && entry) {
    return (
      <ProviderPage
        entry={entry}
        service={service}
        profileName={profileName}
        defaultProvider={defaultProvider}
        onBack={() => setOpen(null)}
        onChanged={changed}
      />
    )
  }
  if (open === 'endpoint:new') {
    return (
      <EndpointForm
        service={service}
        taken={takenEndpointIDs(entries ?? [], catalog ?? [])}
        catalogReady={catalog !== null}
        onBack={() => setOpen(null)}
        onSaved={async id => {
          await changed()
          setOpen(`endpoint:${id}`)
        }}
      />
    )
  }
  if (adding) {
    return (
      <AddProvider
        entries={(entries ?? []).filter(e => !isConnected(e))}
        onBack={() => setAdding(false)}
        onPick={id => {
          setAdding(false)
          setOpen(id)
        }}
      />
    )
  }

  const connected = (entries ?? []).filter(isConnected)
  return (
    <section className="pset-section">
      <h2>{t('Providers')}</h2>
      <p className="meta">{t("Where this profile's models come from. Keys are saved on your Hermes host and are never shown again.")}</p>
      {entries === null ? (
        error ? (
          <div className="pset-row">
            <span className="error-text">{t('Could not load providers.')}</span>
            <button className="secondary" onClick={() => void reload()}>
              {t('Try Again')}
            </button>
          </div>
        ) : kept?.length ? (
          // The providers connected last time, until Hermes answers; a row opens once it has.
          <ul className="provider-list">
            {kept.map(e => (
              <li key={e.id}>
                <button className="provider-row" disabled>
                  <ProviderLogo slug={e.id} title={e.name} />
                  <strong>{e.name}</strong>
                  <span className="spacer" />
                  <span className={`meta${e.warn ? ' pset-warn' : ''}`}>{e.title}</span>
                  <Icon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : (
        <>
          {connected.length ? (
            <ul className="provider-list">
              {connected.map(e => (
                <li key={e.id}>
                  <button className="provider-row" onClick={() => setOpen(e.id)}>
                    <ProviderLogo slug={e.id} title={e.name} />
                    <strong>{e.name}</strong>
                    <span className="spacer" />
                    <span className={`meta${providerStatus(e) === 'oldCopy' ? ' pset-warn' : ''}`}>{statusTitle(e)}</span>
                    <Icon name="chevron" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="meta">{t('No providers yet.')}</p>
          )}
          <div>
            <button className="secondary" onClick={() => setAdding(true)}>
              {t('Add a provider')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const head = useRef<HTMLDivElement>(null)
  // A page opens where the list was, at the foot of Models: bring it into view.
  useEffect(() => {
    head.current?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <div className="pset-row provider-head" ref={head}>
      <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
        <Icon name="back" />
      </button>
      <h2>{title}</h2>
      <span className="spacer" />
    </div>
  )
}

function AddProvider({ entries, onBack, onPick }: { entries: ProviderEntry[]; onBack: () => void; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const wanted = query.trim().toLowerCase()
  const shown = entries.filter(e => !wanted || e.name.toLowerCase().includes(wanted) || e.id.toLowerCase().includes(wanted))
  return (
    <section className="pset-section">
      <Header title={t('Add a provider')} onBack={onBack} />
      <input
        className="cap-search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('Search providers')}
        aria-label={t('Search providers')}
      />
      <ul className="provider-list">
        <li>
          <button className="provider-row" onClick={() => onPick('endpoint:new')}>
            <strong>{t('Custom endpoint')}</strong>
            <span className="spacer" />
            <span className="meta">{t('Any OpenAI-compatible server, such as vLLM, LM Studio or Ollama')}</span>
            <Icon name="chevron" />
          </button>
        </li>
        {shown.map(e => (
          <li key={e.id}>
            <button className="provider-row" onClick={() => onPick(e.id)}>
              <ProviderLogo slug={e.id} title={e.name} />
              <strong>{e.name}</strong>
              <span className="spacer" />
              <span className="meta">{e.account ? t('Account') : t('API key')}</span>
              <Icon name="chevron" />
            </button>
          </li>
        ))}
      </ul>
      {wanted && !shown.length ? <p className="meta">{t('Nothing matches “{wanted}”.', { wanted: query.trim() })}</p> : null}
    </section>
  )
}

function ProviderPage({
  entry,
  service,
  profileName,
  defaultProvider,
  onBack,
  onChanged
}: {
  entry: ProviderEntry
  service: ProviderService
  profileName: string
  defaultProvider: string
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const runsDefault = !!defaultProvider && catalogNames(entry).includes(defaultProvider)

  const run = async (work: () => Promise<string | null | void>) => {
    setBusy(true)
    setNote(null)
    try {
      const said = await work()
      if (said) setNote({ text: said, bad: false })
    } catch (e) {
      setNote({ text: t('Could not save credential: {error}', { error: message(e) }), bad: true })
    } finally {
      setBusy(false)
      await onChanged()
    }
  }

  return (
    <section className="pset-section provider-page">
      <Header title={entry.name} onBack={onBack} />
      <p className="meta">{statusTitle(entry)}</p>
      {runsDefault ? <p className="meta">{t('This provider runs the default model. Pick another default to remove it.')}</p> : null}
      {entry.account ? <AccountSection entry={entry} service={service} busy={busy} run={run} /> : null}
      {entry.key ? <KeySection entry={entry} service={service} profileName={profileName} busy={busy} runsDefault={runsDefault} run={run} /> : null}
      {showsKeyOrder(entry) ? <KeyOrderSection entry={entry} profile={service.profile} /> : null}
      {entry.settings.length ? <SettingsSection entry={entry} service={service} busy={busy} run={run} /> : null}
      {entry.endpoint ? (
        <>
          <dl className="provider-facts">
            <dt>{t('Address')}</dt>
            <dd>{entry.endpoint.baseURL}</dd>
            <dt>{t('Model')}</dt>
            <dd>{entry.endpoint.model || t('None')}</dd>
            <dt>{t('API key')}</dt>
            <dd>{entry.endpoint.keySaved ? t('Key saved') : t('Not set')}</dd>
          </dl>
          <div>
            <button
              className="link danger"
              disabled={busy || runsDefault || entry.endpoint.isCurrent}
              onClick={() => {
                if (!window.confirm(`${t('Remove {name}?', { name: entry.name })}\n\n${t('The endpoint is removed from this profile on your Hermes host.')}`))
                  return
                void run(async () => {
                  await service.removeEndpoint(entry.endpoint!.endpointID)
                  onBack()
                })
              }}
            >
              {t('Remove provider')}
            </button>
          </div>
        </>
      ) : null}
      {note ? <p className={note.bad ? 'error-text' : 'meta'}>{note.text}</p> : null}
    </section>
  )
}

type Run = (work: () => Promise<string | null | void>) => Promise<void>

const configHttp: Http = (method, path, body) => gateway.http(method, path, body)

const keyOrderTitle = (order: KeyOrder) =>
  order === 'fill_first'
    ? t('First key until it runs out')
    : order === 'round_robin'
      ? t('Take turns')
      : order === 'random'
        ? t('Random')
        : t('Least used first')

/** How Hermes picks among the profile's keys for the provider once it has more than one (`credential_pool_strategies.<id>`). */
function KeyOrderSection({ entry, profile }: { entry: ProviderEntry; profile: string }) {
  const key = keyOrderKey(entry.id)!
  const keys = entry.key?.keysInUse ?? 0
  const [order, setOrder] = useState<KeyOrder | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = useCallback(async () => {
    setFailed(false)
    try {
      setOrder(keyOrderFrom(valueAt(await readConfig(configHttp, profile), key)))
    } catch {
      setFailed(true)
    }
  }, [profile, key])
  useEffect(() => {
    void read()
  }, [read])
  const choose = async (next: KeyOrder) => {
    if (!order || next === order) return
    const before = order
    setOrder(next)
    setSaving(true)
    setError(null)
    try {
      await updateConfig(configHttp, profile, config => withValue(config, key, next))
    } catch {
      setOrder(before)
      setError(t('Could not save the key order.'))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="provider-block">
      <h3>{t('Key order')}</h3>
      <p className="meta">
        {(entry.key?.signInsInUse ?? 0) > 0
          ? t('This profile has {count} keys and sign-ins for {name}. Hermes moves to another when one hits its limit.', {
              count: String(keys),
              name: entry.name
            })
          : t('This profile has {count} keys for {name}. Hermes moves to another when one hits its limit.', { count: String(keys), name: entry.name })}
      </p>
      {order ? (
        <div className="pset-row">
          <span>{t('Use keys')}</span>
          <select
            className="language-select"
            value={order}
            disabled={saving}
            aria-label={t('Key order')}
            onChange={e => void choose(e.target.value as KeyOrder)}
          >
            {KEY_ORDERS.map(o => (
              <option key={o} value={o}>
                {keyOrderTitle(o)}
              </option>
            ))}
          </select>
        </div>
      ) : failed ? (
        <div className="pset-row">
          <span className="meta">{t('Could not load the key order.')}</span>
          <button className="secondary" onClick={() => void read()}>
            {t('Try Again')}
          </button>
        </div>
      ) : (
        <p className="meta">{t('Loading…')}</p>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  )
}

/** The provider's settings that aren't keys (a base URL override, a region), set in this profile's `.env`. */
function SettingsSection({ entry, service, busy, run }: { entry: ProviderEntry; service: ProviderService; busy: boolean; run: Run }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const title = (variable: string) => (isBaseURL(variable) ? t('Base URL override') : variable)
  const done = () => {
    setEditing(null)
    setDraft('')
  }
  return (
    <div className="provider-block">
      <h3>{t('Settings')}</h3>
      {!entry.key && !entry.account ? (
        <p className="meta">{t('This provider needs no key here. Hermes reaches it with these settings for this profile.')}</p>
      ) : null}
      {entry.settings.map(setting => (
        <div key={setting.variable} className="provider-setting">
          <div className="pset-row">
            <div className="mem-text">
              <span>{title(setting.variable)}</span>
              <span className="meta">
                {setting.saved ? t('Set for this profile') : isBaseURL(setting.variable) ? t("Not set, uses the provider's own") : t('Not set')}
              </span>
              {setting.description && !isBaseURL(setting.variable) ? <span className="meta">{setting.description}</span> : null}
            </div>
            {editing !== setting.variable ? (
              <button
                className="secondary"
                disabled={busy}
                aria-label={`${setting.saved ? t('Change') : t('Set')}, ${title(setting.variable)}`}
                onClick={() => {
                  setDraft('')
                  setEditing(setting.variable)
                }}
              >
                {setting.saved ? t('Change') : t('Set')}
              </button>
            ) : null}
          </div>
          {editing === setting.variable ? (
            <div className="provider-setting-edit">
              <input
                className="pset-note"
                value={draft}
                autoFocus
                spellCheck={false}
                placeholder={isBaseURL(setting.variable) ? 'https://' : setting.variable}
                aria-label={title(setting.variable)}
                disabled={busy}
                onChange={e => setDraft(e.target.value)}
              />
              <div className="pset-actions">
                {setting.saved ? (
                  <button
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => void run(async () => (await service.removeVariables([setting.variable]), done()))}
                  >
                    {t('Clear')}
                  </button>
                ) : null}
                <button className="secondary" disabled={busy} onClick={done}>
                  {t('Cancel')}
                </button>
                <button
                  className="primary"
                  disabled={busy || !draft.trim()}
                  onClick={() => void run(async () => (await service.saveSetting(setting.variable, draft.trim()), done()))}
                >
                  {t('Save')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function AccountSection({ entry, service, busy, run }: { entry: ProviderEntry; service: ProviderService; busy: boolean; run: Run }) {
  const account = entry.account!
  const [signIn, setSignIn] = useState<SignIn | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const live = useRef<SignIn | null>(null)

  // A sign-in left behind is cancelled on Hermes.
  useEffect(
    () => () => {
      if (live.current) void service.cancel(live.current)
      live.current = null
    },
    [service]
  )

  const start = async () => {
    setFailure(null)
    try {
      const started = await service.startSignIn(entry.id)
      live.current = started
      setSignIn(started)
      if (started.verificationURL) window.open(started.verificationURL, '_blank')
      while (live.current === started) {
        const outcome = await service.poll(entry.id, started)
        if (live.current !== started) return
        if (outcome.kind === 'pending') continue
        live.current = null
        setSignIn(null)
        if (outcome.kind === 'failed') setFailure(outcome.message)
        else await run(async () => null)
        return
      }
    } catch (e) {
      live.current = null
      setSignIn(null)
      setFailure(message(e))
    }
  }

  return (
    <div className="provider-block">
      <h3>{t('Account')}</h3>
      {account.signedIn ? (
        <>
          <p className="meta">{t('Signed in')}</p>
          {account.signsOutHere ? (
            <div>
              <button
                className="link danger"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`${t('Remove {name}?', { name: entry.name })}\n\n${t('Hermes signs out of it for every profile.')}`)) return
                  void run(() => service.signOut(entry.id))
                }}
              >
                {t('Remove provider')}
              </button>
            </div>
          ) : account.command ? (
            <p className="meta">{t('Sign out on the host with {command}.', { command: account.command })}</p>
          ) : null}
        </>
      ) : account.flow === 'external' ? (
        <>
          <p className="meta">{t('This provider signs in on your Hermes host. Run this there, then check again:')}</p>
          {account.command ? <code className="provider-command">{account.command}</code> : null}
          <div>
            <button className="secondary" disabled={busy} onClick={() => void run(async () => null)}>
              {t('Check again')}
            </button>
          </div>
        </>
      ) : signIn ? (
        <>
          <p className="meta">{t('Enter this code on the sign-in page:')}</p>
          <code className="provider-code">{signIn.userCode}</code>
          <div className="pset-row provider-actions">
            {signIn.verificationURL ? (
              <a className="link" href={signIn.verificationURL} target="_blank" rel="noreferrer">
                {t('Open sign-in page')}
              </a>
            ) : null}
            <button className="link" onClick={() => void navigator.clipboard.writeText(signIn.userCode)}>
              {t('Copy')}
            </button>
            <span className="spacer" />
            <button
              className="link"
              onClick={() => {
                if (live.current) void service.cancel(live.current)
                live.current = null
                setSignIn(null)
              }}
            >
              {t('Cancel')}
            </button>
          </div>
          <p className="meta">{t('Waiting for you to finish…')}</p>
        </>
      ) : (
        <div>
          <button className="secondary" disabled={busy} onClick={() => void start()}>
            {t('Sign in')}
          </button>
        </div>
      )}
      {failure ? <p className="error-text">{failure}</p> : null}
    </div>
  )
}

function KeySection({
  entry,
  service,
  profileName,
  busy,
  runsDefault,
  run
}: {
  entry: ProviderEntry
  service: ProviderService
  profileName: string
  busy: boolean
  runsDefault: boolean
  run: Run
}) {
  const key = entry.key!
  const state = keyState(entry)
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<'all' | 'profile'>('all')
  const [checking, setChecking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const onMain = entry.onMainProfile
  const caption =
    state === 'shared'
      ? onMain
        ? t('Every profile without a key of its own uses this one.')
        : t('This profile uses the key shared by all profiles.')
      : state === 'own'
        ? t('This profile uses its own key instead of the shared one.')
        : state === 'oldCopy'
          ? t('This profile still uses a shared key that was replaced since.')
          : state === 'mainProfileOnly'
            ? t("This key is in the main profile's settings file, which other profiles can't read. Paste it again to share it.")
            : t('Share a key with every profile, or save one only this profile uses.')

  const save = async () => {
    const pasted = value.trim()
    if (!pasted) return
    setRefused(null)
    setChecking(true)
    const check = key.borrowedOnly ? null : await service.check(pasted, key.vars[0] ?? '')
    setChecking(false)
    if (check && blocksSave(check)) {
      setRefused(check.message || t("The provider didn't take this key."))
      return
    }
    await run(async () => {
      const clean = scope === 'profile' && !onMain ? await service.override(pasted, entry) : await service.share(pasted, entry)
      setValue('')
      if (!clean)
        return scope === 'profile'
          ? t("Saved, but this profile's old key couldn't be removed, so it may still be used first.")
          : t("Saved, but the old key couldn't be removed everywhere. A profile still using it says Old copy of the shared key.")
      if (check && !check.reachable) return t("Saved. Hermes couldn't reach the provider to check the key.")
      return null
    })
  }

  return (
    <div className="provider-block">
      <h3>{t('API key')}</h3>
      <p className="meta">{caption}</p>
      {!onMain ? <p className="meta">{t('For the {profile} profile. Sign-ins and shared keys reach every profile.', { profile: profileName })}</p> : null}
      {key.heldVars.length ? <p className="meta">{t("Another provider reads this key too, so Conduit leaves it in this profile's settings.")}</p> : null}
      <div className="pset-row provider-key">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={e => {
            setValue(e.target.value)
            setRefused(null)
          }}
          placeholder={t('Paste API key')}
          aria-label={t('Paste API key')}
          disabled={busy || checking}
        />
        {!onMain ? (
          <select className="language-select" value={scope} onChange={e => setScope(e.target.value as 'all' | 'profile')} aria-label={t('Use for')}>
            <option value="all">{t('All profiles')}</option>
            <option value="profile">{t('Only this profile')}</option>
          </select>
        ) : null}
        <button className="secondary" disabled={busy || checking || !value.trim()} onClick={() => void save()}>
          {checking ? t('Checking…') : state === 'none' ? t('Save key') : t('Replace')}
        </button>
      </div>
      {refused ? <p className="error-text">{refused}</p> : null}
      <p className="meta">{t("Conduit never shows a key, so you'd paste it again to use it.")}</p>
      <div className="pset-row provider-actions">
        {key.signupURL ? (
          <a className="link" href={key.signupURL} target="_blank" rel="noreferrer">
            {t('Get a key')}
          </a>
        ) : null}
        <span className="spacer" />
        {(state === 'own' || state === 'oldCopy') && removableRows(key).length + removableVars(key).length > 0 ? (
          <button className="link" disabled={busy || (runsDefault && !key.sharedRows.length)} onClick={() => void run(() => service.useShared(entry))}>
            {key.sharedRows.length ? t('Use the shared key') : t("Remove this profile's key")}
          </button>
        ) : null}
        {key.sharedRows.length && (onMain || state === 'shared') ? (
          <button
            className="link danger"
            disabled={busy || runsDefault}
            onClick={() => {
              if (!window.confirm(`${t('Remove the shared key?')}\n\n${t('Every profile without a key of its own stops using {name}.', { name: entry.name })}`))
                return
              void run(() => service.unshare(entry))
            }}
          >
            {t('Remove shared key')}
          </button>
        ) : null}
        {state === 'mainProfileOnly' && removableVars(key).length ? (
          <button
            className="link danger"
            disabled={busy || runsDefault}
            onClick={() => {
              if (!window.confirm(t('Remove {name}?', { name: entry.name }))) return
              void run(() => service.removeVariables(removableVars(key)))
            }}
          >
            {t('Remove key')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function EndpointForm({
  service,
  taken,
  catalogReady,
  onBack,
  onSaved
}: {
  service: ProviderService
  taken: Set<string>
  catalogReady: boolean
  onBack: () => void
  onSaved: (id: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const id = endpointID(name, taken)
  const draft = { endpointID: id, name, baseURL: address, model, models: models ?? [], key, makeDefault }

  const find = async () => {
    setBusy(true)
    setNote(null)
    const check = await service.checkEndpoint({ ...draft, model: '' })
    setBusy(false)
    if (!check.reachable && !check.ok) {
      setNote({ text: check.message || t("Hermes couldn't reach the server."), bad: true })
      return
    }
    setModels(check.models)
    setModel(check.models[0] ?? '')
    setNote({ text: check.message || t('The server answered.'), bad: false })
  }

  const save = async () => {
    setBusy(true)
    setNote(null)
    try {
      await service.saveEndpoint(draft)
      await onSaved(id)
    } catch (e) {
      setNote({ text: t('Could not save the endpoint: {error}', { error: message(e) }), bad: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pset-section provider-page">
      <Header title={t('Custom endpoint')} onBack={onBack} />
      <p className="meta">{t('Any OpenAI-compatible server, such as vLLM, LM Studio or Ollama')}</p>
      {!catalogReady ? <p className="meta">{t("Custom endpoints wait for Hermes' model list.")}</p> : null}
      <label className="provider-field">
        <span>{t('Name')}</span>
        <input value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      </label>
      <label className="provider-field">
        <span>{t('Address')}</span>
        <input
          value={address}
          onChange={e => {
            setAddress(e.target.value)
            setModels(null)
          }}
          placeholder="http://localhost:8000/v1"
          spellCheck={false}
          disabled={busy}
        />
      </label>
      <label className="provider-field">
        <span>{t('API key (optional)')}</span>
        <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} disabled={busy} />
      </label>
      <div>
        <button className="secondary" disabled={busy || !address.trim()} onClick={() => void find()}>
          {busy && models === null ? t('Checking…') : t('Find models')}
        </button>
      </div>
      {models !== null ? (
        <label className="provider-field">
          <span>{t('Model')}</span>
          {models.length ? (
            <select className="language-select" value={model} onChange={e => setModel(e.target.value)}>
              {models.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input value={model} onChange={e => setModel(e.target.value)} placeholder={t('Model name')} disabled={busy} />
          )}
        </label>
      ) : null}
      <label className="toggle">
        <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} disabled={busy} />
        {t('Use as default model')}
      </label>
      <div>
        <button className="secondary" disabled={busy || !catalogReady || !name.trim() || !address.trim() || !model} onClick={() => void save()}>
          {t('Save endpoint')}
        </button>
      </div>
      {note ? <p className={note.bad ? 'error-text' : 'meta'}>{note.text}</p> : null}
    </section>
  )
}
