/**
 * What Capabilities > Connectors' Apps and its pages share, after the phone's
 * HostedAppsModel: the apps as Hermes last gave them, and an app's sign-in
 * while it runs. A sign-in opens the app's own page in the browser, then asks
 * Hermes how far it got every two seconds until the account is connected.
 * Done, or coming back to the window, has Hermes read the accounts now; Stop
 * Waiting, leaving Capabilities, another bot or Hermes' deadline gives the
 * sign-in up, so no half-made account stays behind.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../../shared/i18n'
import { gateway, GatewayError } from '../gateway'
import {
  carryingLink,
  isConnected,
  isRetryable,
  parseAccount,
  parseAccounts,
  parseCatalog,
  parseOperation,
  parsePolicy,
  parseStatuses,
  parseTools,
  policyRevision,
  targetOf,
  UNAVAILABLE,
  type AppAccount,
  type AppTool,
  type Operation,
  type Policy,
  type Snapshot
} from './hostedApps'

const METHOD_NOT_FOUND = -32601
const POLL_MS = 2_000
const OWNER = { type: 'account' }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const reasonOf = (e: unknown) => (e instanceof GatewayError ? e.reason : undefined)
const unsupported = (e: unknown) => e instanceof GatewayError && e.code === METHOD_NOT_FOUND
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class Stopped extends Error {}

export interface HostedApps {
  snapshot: Snapshot | null
  loading: boolean
  /** A read that failed, worded for the user. */
  error: string | null
  /** The app whose sign-in runs; one at a time. */
  signingIn: string | null
  /** The sign-in's page, to open again. */
  signInPage: string | null
  /** A line under an app: why its sign-in or a switch didn't take. */
  notes: Record<string, string>
  reload: () => Promise<void>
  tools: (slug: string, refresh?: boolean) => Promise<AppTool[]>
  signIn: (slug: string, options?: { alias?: string; repairing?: string }) => void
  stopSignIn: () => void
  /** Signed in on the page: Hermes looks at the accounts now rather than at its next check. */
  wake: () => void
  setEnabled: (slug: string, enabled: boolean) => Promise<void>
  setTools: (slug: string, disabled: string[]) => Promise<void>
  rename: (account: AppAccount, alias: string) => Promise<void>
  remove: (account: AppAccount) => Promise<void>
}

export function useHostedApps(profile: string): HostedApps {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [signInPage, setSignInPage] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const generation = useRef(0)
  const snapshotRef = useRef<Snapshot | null>(null)
  snapshotRef.current = snapshot
  /** The running sign-in: its operation once Hermes gave one, and whether it was stopped. */
  const signIn = useRef<{ slug: string; operation: Operation | null; stopped: boolean; woke: boolean } | null>(null)

  const rpc = useCallback(
    <T = unknown>(method: string, params: Record<string, unknown> = {}) =>
      gateway.rpc<T>(method, profile && profile !== 'default' ? { ...params, profile } : params),
    [profile]
  )

  const note = (slug: string, text: string | null) =>
    setNotes(all => {
      const next = { ...all }
      if (text) next[slug] = text
      else delete next[slug]
      return next
    })

  const worded = (e: unknown) => (unsupported(e) ? t('This Hermes can’t connect apps yet. Update Hermes to use them.') : message(e))

  const reload = useCallback(async () => {
    const mine = generation.current
    setLoading(true)
    setError(null)
    try {
      let list: ReturnType<typeof parseStatuses>
      try {
        list = parseStatuses(await rpc('connectors.list', { owner: OWNER }))
      } catch (e) {
        // A Hermes without Nous Portal's connectors, or one too old for them, shows no section.
        if (reasonOf(e) === 'CONNECTORS_UNAVAILABLE' || unsupported(e)) list = { available: false, statuses: [] }
        else throw e
      }
      if (!list.available) {
        if (generation.current === mine) setSnapshot(UNAVAILABLE)
        return
      }
      const [catalog, accounts] = [rpc('connectors.catalog').then(parseCatalog), rpc('connectors.accounts').then(parseAccounts)]
      let policy: Policy | null = null
      let rulesFailed = false
      try {
        policy = parsePolicy(await rpc('connectors.policy.get'))
        if (!policy) throw new Error('unreadable rules')
      } catch (e) {
        // No Nous sign-in, or a Hermes without rules: nothing restricts the apps.
        if (reasonOf(e) !== 'NEEDS_NOUS_AUTH' && !unsupported(e)) {
          rulesFailed = true
          policy = snapshotRef.current?.policy ?? null
        }
      }
      const next: Snapshot = { available: true, catalog: await catalog, statuses: list.statuses, accounts: await accounts, policy, rulesFailed }
      if (generation.current === mine) setSnapshot(next)
    } catch (e) {
      if (generation.current === mine) setError(worded(e))
    } finally {
      if (generation.current === mine) setLoading(false)
    }
  }, [rpc])

  /** Tells Hermes to stop waiting, and removes the accounts the sign-in left unfinished. */
  const giveUp = useCallback(
    async (operation: Operation) => {
      const fresh = await rpc('connectors.operation.status', { owner: OWNER, op_id: operation.id })
        .then(parseOperation)
        .catch(() => null)
      await rpc('connection.respond', { owner: OWNER, op_id: operation.id, result: { targets: [], settled_by: 'continue' } }).catch(() => undefined)
      if (!fresh) return
      for (const target of fresh.targets) {
        if (isConnected(target)) continue
        const id = target.connectionId ?? targetOf(operation, target.name)?.connectionId
        if (id) await rpc('connectors.accounts.remove', { connection_id: id }).catch(() => undefined)
      }
    },
    [rpc]
  )

  const startSignIn = useCallback(
    (slug: string, options: { alias?: string; repairing?: string } = {}) => {
      if (signIn.current) return
      const mine = generation.current
      const run = { slug, operation: null as Operation | null, stopped: false, woke: false }
      signIn.current = run
      setSigningIn(slug)
      setSignInPage(null)
      note(slug, null)
      const live = () => !run.stopped && generation.current === mine
      void (async () => {
        try {
          const params: Record<string, unknown> = { owner: OWNER, connectors: [slug], reconnect: !!options.repairing }
          if (options.repairing) params.connection_id = options.repairing
          else if (options.alias) params.alias = options.alias
          let current = parseOperation(await rpc('connectors.connect', params))
          if (!current) throw new Error(t('Hermes couldn’t open the sign-in page. Try again.'))
          run.operation = current
          if (!live()) throw new Stopped()
          if (isConnected(targetOf(current, slug))) return
          const page = targetOf(current, slug)?.connectUrl
          if (!page) {
            note(slug, targetOf(current, slug)?.detail ?? t('Hermes couldn’t open the sign-in page. Try again.'))
            await giveUp(current)
            return
          }
          setSignInPage(page)
          window.open(page, '_blank', 'noopener')
          for (;;) {
            await sleep(POLL_MS)
            if (!live()) throw new Stopped()
            current = carryingLink(parseOperation(await rpc('connectors.operation.status', { owner: OWNER, op_id: current.id })) ?? current, current)
            run.operation = current
            if (!live()) throw new Stopped()
            const target = targetOf(current, slug)
            if (isConnected(target)) return
            if (isRetryable(target) || current.settled) {
              note(slug, target?.detail ?? t('The sign-in didn’t finish. Try again.'))
              await giveUp(current)
              return
            }
            if (current.deadline && Date.now() > current.deadline) {
              note(slug, t('The sign-in wasn’t finished.'))
              await giveUp(current)
              return
            }
          }
        } catch (e) {
          if (run.operation && (e instanceof Stopped || live())) await giveUp(run.operation)
          if (!(e instanceof Stopped) && live()) note(slug, worded(e))
        } finally {
          if (signIn.current === run) {
            signIn.current = null
            if (generation.current === mine) {
              setSigningIn(null)
              setSignInPage(null)
              void reload()
            }
          }
        }
      })()
    },
    [rpc, giveUp, reload]
  )

  const stopSignIn = useCallback(() => {
    const run = signIn.current
    if (!run) return
    // The sign-in shows as running until Hermes was told, so a new one waits for it.
    run.stopped = true
  }, [])

  const wake = useCallback(() => {
    const operation = signIn.current?.operation
    if (operation) void rpc('connectors.operation.wake', { owner: OWNER, op_id: operation.id }).catch(() => undefined)
  }, [rpc])

  // Back in the window during a sign-in: the page was likely finished, so Hermes looks now, once.
  useEffect(() => {
    const onFocus = () => {
      const run = signIn.current
      if (!run?.operation || run.woke) return
      run.woke = true
      wake()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [wake])

  // Another bot, or leaving Capabilities, starts over and gives up a sign-in.
  useEffect(() => {
    generation.current++
    setSnapshot(null)
    setError(null)
    setNotes({})
    void reload()
    return () => {
      generation.current++
      if (signIn.current) signIn.current.stopped = true
      signIn.current = null
      setSigningIn(null)
      setSignInPage(null)
    }
  }, [reload])

  const tools = useCallback(async (slug: string, refresh = false) => parseTools(await rpc('connectors.tools', { slug, refresh })), [rpc])

  /** A rules change against the member rules' revision; the rules are read again after, a conflict included. */
  const writeRules = useCallback(
    async (slug: string, change: Record<string, unknown>) => {
      const mine = generation.current
      const revision = policyRevision(snapshotRef.current?.policy ?? null)
      if (!revision) return note(slug, t('Your organization manages these switches.'))
      let conflict = false
      try {
        await rpc('connectors.policy.set', { change, expected_revision: revision })
      } catch (e) {
        if (reasonOf(e) !== 'POLICY_CONFLICT') {
          note(slug, worded(e))
          void reload()
          return
        }
        conflict = true
      }
      try {
        const policy = parsePolicy(await rpc('connectors.policy.get'))
        if (policy && generation.current === mine) setSnapshot(s => s && { ...s, policy, rulesFailed: false })
      } catch {
        void reload()
      }
      note(slug, conflict ? t('The switches changed somewhere else. They show what’s set now; try again.') : null)
    },
    [rpc, reload]
  )

  const setEnabled = useCallback((slug: string, enabled: boolean) => writeRules(slug, { type: 'connector', connector: slug, enabled }), [writeRules])
  const setTools = useCallback(
    (slug: string, disabled: string[]) => writeRules(slug, { type: 'tools', connector: slug, disabled_tools: disabled }),
    [writeRules]
  )

  const rename = useCallback(
    async (account: AppAccount, alias: string) => {
      const answer = await rpc('connectors.accounts.rename', { connection_id: account.connectionId, alias })
      const renamed = answer && typeof answer === 'object' ? parseAccount(answer as Record<string, unknown>) : null
      setSnapshot(s => s && { ...s, accounts: s.accounts.map(a => (a.connectionId === account.connectionId ? (renamed ?? { ...a, alias }) : a)) })
    },
    [rpc]
  )

  const remove = useCallback(
    async (account: AppAccount) => {
      try {
        await rpc('connectors.accounts.remove', { connection_id: account.connectionId })
        setSnapshot(s => s && { ...s, accounts: s.accounts.filter(a => a.connectionId !== account.connectionId) })
        void reload()
      } catch (e) {
        note(account.connector, worded(e))
      }
    },
    [rpc, reload]
  )

  return { snapshot, loading, error, signingIn, signInPage, notes, reload, tools, signIn: startSignIn, stopSignIn, wake, setEnabled, setTools, rename, remove }
}
