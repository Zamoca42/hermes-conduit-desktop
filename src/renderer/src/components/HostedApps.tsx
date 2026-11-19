import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import {
  accountName,
  accountNameProblem,
  accountState,
  appOf,
  appsOf,
  categoryTitle,
  directoryGroups,
  facetWord,
  needsReconnect,
  organizationLockedTools,
  policyRevision,
  rowDetail,
  sectionRows,
  stateWord,
  titleOf,
  type AppAccount,
  type AppState,
  type AppTool,
  type HostedApp
} from '../state/hostedApps'
import type { HostedApps } from '../state/useHostedApps'
import { Icon } from './icons'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span />
    </label>
  )
}

/** The app's logo, or its first letter when there's none or it doesn't load. */
function AppLogo({ app, size }: { app: Pick<HostedApp, 'title' | 'logo'>; size: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [app.logo])
  return (
    <span className="app-logo" style={{ width: size, height: size, fontSize: size * 0.44 }} aria-hidden="true">
      {app.logo && !failed ? (
        <img src={app.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        app.title.charAt(0).toUpperCase()
      )}
    </span>
  )
}

const dotTone = (state: AppState) =>
  state === 'connected' ? 'ok' : state === 'expired' || state === 'broken' ? 'warn' : state === 'connecting' || state === 'unknown' ? 'wait' : null

function AppRow({ app, onOpen }: { app: HostedApp; onOpen: () => void }) {
  const detail = rowDetail(app)
  const word = stateWord(app.state)
  const dot = dotTone(app.state)
  return (
    <button className="app-row" onClick={onOpen}>
      <AppLogo app={app} size={30} />
      <span className="app-row-text">
        <strong>{app.title}</strong>
        {detail ? <span className="meta">{detail}</span> : null}
      </span>
      {dot ? <span className={`app-dot ${dot}`} aria-hidden="true" /> : null}
      {word ? <span className="meta app-row-word">{word}</span> : null}
      <Icon name="chevron" />
    </button>
  )
}

/**
 * Capabilities > Connectors' Apps, above the MCP servers: your apps, and the
 * others a search finds, then Connect an App or Browse Apps. Nothing shows
 * on a Hermes without Nous Portal's connectors.
 */
export function HostedAppsSection({
  apps,
  query,
  onOpenApp,
  onBrowse
}: {
  apps: HostedApps
  query: string
  onOpenApp: (slug: string) => void
  onBrowse: () => void
}) {
  const snapshot = apps.snapshot
  if (!snapshot) {
    return apps.error ? (
      <section className="pset-section">
        <h2>{t('Apps')}</h2>
        <div className="pset-row">
          <span className="error-text">{apps.error}</span>
          <button className="secondary" disabled={apps.loading} onClick={() => void apps.reload()}>
            {t('Try Again')}
          </button>
        </div>
      </section>
    ) : null
  }
  if (!snapshot.available) return null
  const { yours, found } = sectionRows(appsOf(snapshot), query)
  if (query.trim() && !yours.length && !found.length) return null
  return (
    <section className="pset-section">
      <h2>{t('Apps')}</h2>
      {[...yours, ...found].map(app => (
        <AppRow key={app.slug} app={app} onOpen={() => onOpenApp(app.slug)} />
      ))}
      {query.trim() ? null : (
        <button className="app-row" onClick={onBrowse}>
          <span className="app-logo plus" style={{ width: 30, height: 30 }} aria-hidden="true">
            <Icon name="plus" />
          </span>
          <span className="app-row-text">
            <strong>{yours.length ? t('Browse Apps') : t('Connect an App')}</strong>
            <span className="meta">
              {yours.length ? t('{count} apps', { count: snapshot.catalog.length }) : t('Gmail, Slack, Notion and more: sign in once and Hermes can use them.')}
            </span>
          </span>
          <Icon name="chevron" />
        </button>
      )}
      <p className="meta">{t('Signed in through Nous Portal. Hermes keeps the sign-ins; changes apply to new chats.')}</p>
    </section>
  )
}

function Head({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="pulse-head">
      <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
        <Icon name="back" />
      </button>
      <h1>{title}</h1>
    </div>
  )
}

/** Every app Hermes can connect, by category, with a search. */
export function HostedAppsDirectory({ apps, onOpenApp, onBack }: { apps: HostedApps; onOpenApp: (slug: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const groups = apps.snapshot ? directoryGroups(appsOf(apps.snapshot), query) : []
  return (
    <div className="pset">
      <Head title={t('Apps')} onBack={onBack} />
      <p className="meta">
        {t(
          'Connect an app once and Hermes can read and act in it for you, in any chat. You sign in on the app’s own page; Hermes and Nous Portal keep the sign-in, never Conduit.'
        )}
      </p>
      <input
        className="cap-search"
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('Search apps')}
        aria-label={t('Search apps')}
      />
      {apps.error ? <p className="error-text">{apps.error}</p> : null}
      {!apps.snapshot && !apps.error ? <p className="meta">{t('Loading…')}</p> : null}
      {apps.snapshot && !groups.length ? (
        <p className="meta">{query.trim() ? t('Nothing matches “{query}”.', { query: query.trim() }) : t('No apps listed')}</p>
      ) : null}
      {groups.map(group => (
        <section key={group.category} className="pset-section">
          <h2>{group.category}</h2>
          {group.apps.map(app => (
            <AppRow key={app.slug} app={app} onOpen={() => onOpenApp(app.slug)} />
          ))}
        </section>
      ))}
    </div>
  )
}

/** Name an account before its sign-in, or rename one: lowercase letters, digits and dashes. */
function AccountName({
  appTitle,
  account,
  accounts,
  onSave,
  onCancel
}: {
  appTitle: string
  account: AppAccount | null
  accounts: AppAccount[]
  onSave: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(account?.alias ?? '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const typed = name.trim().toLowerCase()
  const problem = typed ? accountNameProblem(typed, accounts, account?.connectionId) : null
  const submit = async () => {
    if (working || !typed || problem) return
    setWorking(true)
    setError(null)
    try {
      await onSave(typed)
    } catch (e) {
      setError(message(e))
      setWorking(false)
    }
  }
  return (
    <div className="app-name-form">
      <strong>{account ? t('Rename Account') : t('Add Account')}</strong>
      <span className="meta">
        {account
          ? t('Hermes and you call this account by its name, like work or home.')
          : t('A short name tells this {app} account apart from your others, like work or home. You sign in next.', { app: appTitle })}
      </span>
      <input
        type="text"
        value={name}
        placeholder={t('work')}
        autoFocus
        spellCheck={false}
        disabled={working}
        aria-label={t('Name')}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      {problem || error ? <span className="error-text">{problem ?? error}</span> : null}
      <div className="pset-actions">
        <button className="secondary" disabled={working} onClick={onCancel}>
          {t('Cancel')}
        </button>
        <button disabled={working || !typed || !!problem} onClick={() => void submit()}>
          {account ? t('Save') : t('Sign In')}
        </button>
      </div>
    </div>
  )
}

/** An app's page: its connection and switch, its accounts, and its tools' switches. */
export function HostedAppPage({ apps, slug, onBack }: { apps: HostedApps; slug: string; onBack: () => void }) {
  const app = apps.snapshot ? appOf(apps.snapshot, slug) : null
  const policy = apps.snapshot?.policy ?? null
  const rulesFailed = apps.snapshot?.rulesFailed === true
  const revision = policyRevision(policy)
  const signingIn = apps.signingIn === slug
  const [tools, setTools] = useState<AppTool[] | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [switchedOff, setSwitchedOff] = useState<string[] | null>(null)
  const [writing, setWriting] = useState(false)
  const [naming, setNaming] = useState<{ account: AppAccount | null } | null>(null)
  const [busyAccount, setBusyAccount] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const connected = app?.connected === true
  const canAct = apps.signingIn === null && !apps.loading
  const canAddAccount = canAct && !rulesFailed

  const loadTools = async (refresh: boolean) => {
    setToolsError(null)
    try {
      setTools(await apps.tools(slug, refresh))
    } catch (e) {
      setToolsError(message(e))
    }
  }

  useEffect(() => {
    if (connected && tools === null) void loadTools(false)
    // Read once the app is connected.
  }, [connected, slug])

  useEffect(() => {
    if (!signingIn) setStopping(false)
  }, [signingIn])

  if (!app) {
    return (
      <div className="pset">
        <Head title={titleOf(slug)} onBack={onBack} />
        {apps.error ? <p className="error-text">{apps.error}</p> : <p className="meta">{t('Loading…')}</p>}
      </div>
    )
  }

  const rulesUnread = (text: string) => (
    <div className="pset-row">
      <span className="meta">{text}</span>
      <button className="secondary" disabled={apps.loading} onClick={() => void apps.reload()}>
        {t('Try Again')}
      </button>
    </div>
  )
  const rulesUnreadLine = rulesUnread(t('Hermes couldn’t read the rules just now, so these switches can’t change.'))

  const setEnabled = async (enabled: boolean) => {
    if (writing || rulesFailed) return
    setWriting(true)
    await apps.setEnabled(slug, enabled).catch(() => undefined)
    setWriting(false)
  }

  const setTool = async (tool: string, on: boolean, off: Set<string>) => {
    if (writing || rulesFailed) return
    const next = new Set(off)
    if (on) next.delete(tool)
    else next.add(tool)
    const disabled = [...next].sort()
    setSwitchedOff(disabled)
    setWriting(true)
    await apps.setTools(slug, disabled).catch(() => undefined)
    setSwitchedOff(null)
    setWriting(false)
  }

  const disconnect = async (account: AppAccount) => {
    if (
      !window.confirm(
        `${t('Disconnect this account?')}\n\n${t('Hermes signs out of “{name}” and can’t use it until you connect it again.', { name: accountName(account) })}`
      )
    )
      return
    setBusyAccount(account.connectionId)
    await apps.remove(account)
    setBusyAccount(null)
  }

  const accountDetail = (account: AppAccount) => {
    const parts: string[] = []
    if (account.alias && account.label !== accountName(account)) parts.push(account.label)
    parts.push(stateWord(accountState(account)) ?? account.status)
    if (account.active && app.accounts.length > 1) parts.push(t('In use'))
    return parts.join(' · ')
  }

  const header = [categoryTitle(app.category), stateWord(app.state)].filter(Boolean).join(' · ')
  const note = apps.notes[slug]

  const connection = (
    <section className="pset-section">
      <h2>{t('Connection')}</h2>
      {app.state === 'offByOrganization' ? (
        <>
          <p className="meta">{t('Your organization turned {app} off for Hermes.', { app: app.title })}</p>
          {rulesFailed ? rulesUnreadLine : null}
        </>
      ) : (
        <>
          {app.connected ? (
            <div className="cap-row">
              <div className="cap-row-text">
                <strong>{t('Let Hermes use {app}', { app: app.title })}</strong>
                <span className="meta">{t('Off keeps the sign-in but hides the app’s tools.')}</span>
              </div>
              <Switch
                label={t('Let Hermes use {app}', { app: app.title })}
                checked={app.state !== 'off'}
                disabled={!canAct || writing || rulesFailed || !revision}
                onChange={on => void setEnabled(on)}
              />
            </div>
          ) : null}
          {app.connected && rulesFailed && !tools?.length ? rulesUnreadLine : null}
          {app.statusReason && needsReconnect(app) ? <p className="meta">{app.statusReason}</p> : null}
          {!app.connected && rulesFailed && !signingIn
            ? rulesUnread(t('Hermes couldn’t read your organization’s rules just now, so it can’t tell yet whether {app} is allowed.', { app: app.title }))
            : null}
          {!app.connected || needsReconnect(app) || app.state === 'connecting' ? (
            <div className="pset-actions app-connect">
              {signingIn ? (
                <>
                  <span className="meta app-waiting">{t('Waiting for the sign-in…')}</span>
                  {apps.signInPage ? (
                    <button className="secondary" onClick={() => window.open(apps.signInPage!, '_blank', 'noopener')}>
                      {t('Open the Page Again')}
                    </button>
                  ) : null}
                  <button
                    className="secondary"
                    disabled={stopping}
                    onClick={() => {
                      setStopping(true)
                      apps.stopSignIn()
                    }}
                  >
                    {t('Stop Waiting')}
                  </button>
                  {apps.signInPage ? <button onClick={apps.wake}>{t('Done')}</button> : null}
                </>
              ) : (
                <button
                  disabled={app.connected ? !canAct : !canAddAccount}
                  onClick={() => apps.signIn(slug, { repairing: needsReconnect(app) ? app.accounts[0]?.connectionId : undefined })}
                >
                  {needsReconnect(app) ? t('Sign In Again') : t('Connect {app}', { app: app.title })}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
      {note ? <p className="meta">{note}</p> : null}
    </section>
  )

  const accounts = (
    <section className="pset-section">
      <h2>{t('Accounts')}</h2>
      {app.accounts.map(account => (
        <div key={account.connectionId} className="cap-row">
          <div className="cap-row-text">
            <strong>{accountName(account)}</strong>
            <span className="meta">{accountDetail(account)}</span>
          </div>
          {busyAccount === account.connectionId ? <span className="meta">{t('Working…')}</span> : null}
          <button className="secondary" disabled={!canAct || busyAccount !== null} onClick={() => setNaming({ account })}>
            {account.alias ? t('Rename Account') : t('Name Account')}
          </button>
          <button className="secondary" disabled={!canAct || busyAccount !== null} onClick={() => apps.signIn(slug, { repairing: account.connectionId })}>
            {t('Sign In Again')}
          </button>
          <button className="secondary danger" disabled={!canAct || busyAccount !== null} onClick={() => void disconnect(account)}>
            {t('Disconnect')}
          </button>
        </div>
      ))}
      {naming ? (
        <AccountName
          appTitle={app.title}
          account={naming.account}
          accounts={app.accounts}
          onCancel={() => setNaming(null)}
          onSave={async name => {
            if (naming.account) await apps.rename(naming.account, name)
            else if (rulesFailed)
              throw new Error(t('Hermes couldn’t read your organization’s rules just now, so it can’t tell yet whether {app} is allowed.', { app: app.title }))
            else apps.signIn(slug, { alias: name })
            setNaming(null)
          }}
        />
      ) : (
        <div className="pset-actions">
          <button className="secondary" disabled={!canAddAccount} onClick={() => setNaming({ account: null })}>
            {t('Add Another Account')}
          </button>
        </div>
      )}
    </section>
  )

  const toolList = () => {
    if (toolsError)
      return (
        <div className="pset-row">
          <span className="error-text">{toolsError}</span>
          <button className="secondary" onClick={() => void loadTools(true)}>
            {t('Try Again')}
          </button>
        </div>
      )
    if (!tools) return <p className="meta">{t('Reading the tool list…')}</p>
    if (!tools.length) return <p className="meta">{t('This app brings no tools.')}</p>
    const off = new Set(switchedOff ?? app.disabledTools)
    const locked = policy ? organizationLockedTools(policy, slug, tools) : new Set<string>()
    const onCount = tools.filter(tool => !off.has(tool.slug) && !locked.has(tool.slug)).length
    return (
      <>
        <p className="meta">{`${t('{count} tools on', { count: onCount })} · ${t('Hermes can’t use a tool that’s off.')}`}</p>
        {rulesFailed ? (
          app.state !== 'offByOrganization' ? (
            rulesUnreadLine
          ) : null
        ) : !revision ? (
          <p className="meta">{t('Your organization manages these switches.')}</p>
        ) : null}
        {tools
          .filter(tool => !tool.deprecated)
          .map(tool => {
            const facet = facetWord(tool.facet)
            const on = !off.has(tool.slug) && !locked.has(tool.slug)
            return (
              <div key={tool.slug} className={`cap-row${on ? '' : ' off'}`}>
                <div className="cap-row-text">
                  <strong>{tool.name}</strong>
                  {facet ? <span className={`cap-badge ${facet.tone}`}>{facet.text}</span> : null}
                  {tool.description ? <span className="meta">{tool.description}</span> : null}
                </div>
                <Switch
                  label={tool.name}
                  checked={on}
                  disabled={!canAct || writing || rulesFailed || !revision || locked.has(tool.slug)}
                  onChange={next => void setTool(tool.slug, next, off)}
                />
              </div>
            )
          })}
      </>
    )
  }

  return (
    <div className="pset">
      <Head title={app.title} onBack={onBack} />
      <div className="app-head">
        <AppLogo app={app} size={52} />
        <div>
          <strong>{app.title}</strong>
          {header ? <span className="meta">{header}</span> : null}
          {app.description ? <span className="meta">{app.description}</span> : null}
        </div>
      </div>
      {connection}
      {app.connected ? accounts : null}
      {app.connected ? (
        <section className="pset-section">
          <h2>{t('Tools')}</h2>
          {toolList()}
        </section>
      ) : null}
    </div>
  )
}
