import { createContext, useContext, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { Icon } from './icons'
import { PictureProfile } from './Picture'
import { openAppsDirectory } from '../state/appsDirectory'
import {
  appTitle,
  asksApproval,
  hasRequiredValues,
  isResolved,
  opensPage,
  reissues,
  rowAnswer,
  targetTitle,
  type ConnectionCard,
  type ConnectionField,
  type ConnectionTarget
} from '../state/connections'

/** The open chat's answers to its connection cards (useChat's), so the transcript can draw them. */
export interface ConnectionActions {
  respond: (card: ConnectionCard, targets: Record<string, unknown>[], continues?: boolean) => Promise<void>
  reissue: (card: ConnectionCard, name: string) => Promise<void>
  wake: (card: ConnectionCard) => Promise<void>
}

export const ConnectionActionsContext = createContext<ConnectionActions | null>(null)

const installs = (target: ConnectionTarget) => target.kind === 'plugin' || target.kind === 'skill'

/**
 * The card Hermes waits on while the model connects something, after the
 * phone's ConnectionCard: each app, MCP server, plugin or skill with what's
 * left to do (Connect, set up with its keys, Install, Skip, Try Again), and
 * Continue, which lets Hermes carry on without the rest. A key typed for a
 * server lives only in this card's state and goes once with the approval.
 */
export function ConnectionCardView({ card }: { card: ConnectionCard }) {
  const actions = useContext(ConnectionActionsContext)
  const profile = useContext(PictureProfile)
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  /** Rows whose page was opened from this card: only those say they wait on the sign-in. */
  const [opened, setOpened] = useState<string[]>([])
  /** The seq an answer went out at: a newer frame answers it, and until then the buttons wait. */
  const [sentAt, setSentAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = !card.settled && !!actions
  const sending = sentAt !== null && card.seq <= sentAt && !card.settled
  const needsUser = live && !sending
  const display = card.suggested !== undefined
  const unresolved = display || card.targets.some(target => !isResolved(target))

  // Hermes' newer frame answers what was sent, and a failure before it.
  useEffect(() => setError(null), [card.seq, card.settled])

  // A settled card keeps no keys; a resolved row drops its own.
  useEffect(() => {
    if (card.settled) setDrafts({})
    else
      setDrafts(current => {
        const resolved = card.targets.filter(isResolved).map(target => target.name)
        return resolved.some(name => name in current) ? Object.fromEntries(Object.entries(current).filter(([name]) => !resolved.includes(name))) : current
      })
  }, [card])

  async function answer(act: () => Promise<void>) {
    setError(null)
    setSentAt(card.seq)
    try {
      await act()
    } catch (e) {
      setSentAt(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const values = (target: ConnectionTarget) =>
    Object.fromEntries(target.fields.map(field => [field.name, drafts[target.name]?.[field.name] ?? field.defaultValue]))

  const caption = sending
    ? t('SENDING')
    : error
      ? t('TRY AGAIN')
      : live
        ? t('HERMES IS WAITING')
        : card.targets.some(target => target.state === 'connected') && !display
          ? t('CONNECTED')
          : t('DONE')
  const title = display
    ? t('Apps Hermes can use for you')
    : card.targets.length && card.targets.every(installs)
      ? t('Install for Hermes')
      : t('Connect for Hermes')

  return (
    <section className={`ask connection-card${live ? '' : ' settled'}`} aria-label={title}>
      <header className="ask-head">
        <span className="ask-icon">
          <Icon name="link" />
        </span>
        <span className="ask-title">{caption}</span>
        {sending ? <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} /> : null}
      </header>
      <p className="ask-text">
        <strong>{title}</strong>
      </p>

      {display ? (
        <>
          <ul className="connection-suggested">
            {(card.suggested ?? []).map(slug => (
              <li key={slug}>{appTitle(slug)}</li>
            ))}
          </ul>
          {live ? (
            <div className="connection-browse">
              <button className="ask-btn primary" onClick={() => openAppsDirectory(card.suggested ?? [], profile)}>
                {t('Browse Apps')}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        card.targets.map(target => (
          <div key={target.name} className="connection-row">
            <div className="connection-row-head">
              <span className="connection-glyph" aria-hidden="true">
                <Icon name={target.kind === 'mcp' ? 'server' : installs(target) ? 'puzzle' : 'link'} />
              </span>
              <span className="connection-name">
                <strong>{targetTitle(target)}</strong>
                <span className={`meta${target.state === 'connected' && !target.discoveryError ? ' connected' : ''}`}>{stateWord(target, live, opened)}</span>
              </span>
              {live ? rowAction(target) : null}
            </div>
            {target.summary && installs(target) ? <p className="meta">{target.summary}</p> : null}
            {scanLine(target) ? <p className={`meta${scanWarns(target) ? ' warns' : ''}`}>{scanLine(target)}</p> : null}
            {(target.detail ?? target.discoveryError) && (!isResolved(target) || target.discoveryError) ? (
              <p className="meta">{target.detail ?? target.discoveryError}</p>
            ) : null}
            {live && asksApproval(target) ? approval(target) : null}
          </div>
        ))
      )}

      {error ? <p className="ask-error">{error}</p> : null}

      {live && unresolved ? (
        <div className="connection-continue">
          <button className="ask-btn" disabled={!needsUser} onClick={() => void answer(() => actions!.respond(card, [], true))}>
            {t('Continue')}
          </button>
          <p className="meta">
            {display
              ? t("Continue when you're done; Hermes carries on with the apps you connected.")
              : t("Continue lets Hermes carry on without what isn't connected yet.")}
          </p>
        </div>
      ) : null}
    </section>
  )

  /** Connect opens the app's page in the browser; Done tells Hermes to look now. Try Again has Hermes make a new page. */
  function rowAction(target: ConnectionTarget) {
    if (opensPage(target) && target.connectUrl) {
      const waiting = opened.includes(target.name)
      return (
        <span className="connection-actions">
          <a
            className={`ask-btn${waiting ? '' : ' primary'}`}
            href={target.connectUrl}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!needsUser}
            aria-label={`${t('Connect')} ${targetTitle(target)}`}
            onClick={e => {
              if (!needsUser) return e.preventDefault()
              setOpened(current => (current.includes(target.name) ? current : [...current, target.name]))
            }}
          >
            {t('Connect')}
          </a>
          {waiting ? (
            <button className="ask-btn primary" disabled={!needsUser} onClick={() => void actions!.wake(card).catch(() => undefined)}>
              {t('Done')}
            </button>
          ) : null}
        </span>
      )
    }
    if (reissues(target))
      return (
        <button
          className="ask-btn"
          disabled={!needsUser}
          aria-label={`${t('Try Again')} ${targetTitle(target)}`}
          onClick={() => {
            setOpened(current => current.filter(name => name !== target.name))
            void answer(() => actions!.reissue(card, target.name))
          }}
        >
          {t('Try Again')}
        </button>
      )
    if (target.kind === 'connector' && target.state === 'pending') return <Icon name="spinner" style={{ animation: 'spin 1s linear infinite' }} />
    return null
  }

  /** An install or a server's setup: the keys it asks for, then Install (or Connect) and Skip. */
  function approval(target: ConnectionTarget) {
    const typed = values(target)
    const approve = target.action === 'install' ? t('Install') : target.action === 'enable' ? t('Turn On') : t('Connect')
    return (
      <form
        className="input-ask-fields"
        onSubmit={e => {
          e.preventDefault()
          if (needsUser && hasRequiredValues(target.fields, typed)) void answer(() => actions!.respond(card, [rowAnswer(target.name, true, typed)]))
        }}
      >
        {target.instructions && target.fields.length ? <p className="meta">{target.instructions}</p> : null}
        {target.fields.map(field => (
          <input
            key={field.name}
            className="input-ask-field"
            type={field.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            placeholder={fieldLabel(field)}
            aria-label={fieldLabel(field)}
            value={typed[field.name] ?? ''}
            disabled={!needsUser}
            onChange={e => setDrafts(current => ({ ...current, [target.name]: { ...current[target.name], [field.name]: e.target.value } }))}
          />
        ))}
        <div className="ask-actions">
          <button
            type="button"
            className="ask-btn"
            disabled={!needsUser}
            aria-label={`${t('Skip')} ${targetTitle(target)}`}
            onClick={() => {
              setDrafts(current => Object.fromEntries(Object.entries(current).filter(([name]) => name !== target.name)))
              void answer(() => actions!.respond(card, [rowAnswer(target.name, false)]))
            }}
          >
            {t('Skip')}
          </button>
          <button
            type="submit"
            className="ask-btn primary"
            disabled={!needsUser || !hasRequiredValues(target.fields, typed)}
            aria-label={`${approve} ${targetTitle(target)}`}
          >
            {approve}
          </button>
        </div>
      </form>
    )
  }
}

const fieldLabel = (field: ConnectionField) => (field.required ? t('{label} (required)', { label: field.prompt ?? field.name }) : (field.prompt ?? field.name))

function stateWord(target: ConnectionTarget, live: boolean, opened: string[]): string {
  switch (target.state) {
    case 'connected':
      if (target.discoveryError) return t("Connected, but its tools didn't load")
      return installs(target) ? t('Installed') : t('Connected')
    case 'skipped':
      return t('Skipped')
    case 'failed':
    case 'expired':
      return live ? t("Didn't connect") : t('Not connected')
    case 'initiated':
      if (live && opened.includes(target.name)) return t('Waiting for the sign-in…')
      return t('Not connected')
    case 'pending':
      if (installs(target)) return target.alreadyInstalled ? t('Already installed') : t('Not installed')
      return t('Not connected')
    default:
      return t('Not connected')
  }
}

/** A catalog item's tier and the catalog's scan of it, as they come. */
function scanLine(target: ConnectionTarget): string | null {
  if (!installs(target)) return null
  const tier = target.tier === 'official' ? t('Official') : target.tier === 'verified' ? t('Verified') : target.tier === 'community' ? t('Community') : null
  const scan =
    target.scanStatus === 'passed'
      ? t('Security scan passed')
      : target.scanStatus === 'warnings'
        ? t('Security scan found warnings')
        : target.scanStatus === 'failed'
          ? t('Security scan failed')
          : null
  const parts = [tier, scan].filter((part): part is string => !!part)
  if (target.scanSummary && target.scanStatus !== 'passed') parts.push(target.scanSummary)
  return parts.length ? parts.join(' · ') : null
}

const scanWarns = (target: ConnectionTarget) => target.scanStatus === 'warnings' || target.scanStatus === 'failed'
