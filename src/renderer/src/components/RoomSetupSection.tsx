import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { linksMessage } from '../state/roomLinks'
import {
  ceilingToSave,
  changesSavedCeiling,
  customOn,
  mcpServersToSave,
  neverLine,
  roomSetupClient,
  serversLine,
  setupLines,
  toolsLine,
  type RoomSetupState,
  type SetupChoice,
  type SetupResult
} from '../state/roomSetup'

interface Outcome {
  text: string
  trouble?: boolean
  checksAgain?: boolean
}

/**
 * Settings › Multiplayer's This Hermes, after the phone's RoomSetupSection:
 * whether a profile is ready for rooms with other people's agents, what Set
 * up does, and the tools rooms may let it use. A save that needs the gateway
 * restarted restarts it (or asks first while chats run) and then reads the
 * API server until it runs or says why not.
 */
export function RoomSetupSection({ host, profile, profileName, conduitProfile }: { host: string; profile: string; profileName: string; conduitProfile: boolean }) {
  const client = useRef(roomSetupClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs), conduitProfile))
  client.current = roomSetupClient((method, path, body, timeoutMs) => gateway.http(method, path, body, timeoutMs), conduitProfile)
  const key = `${host}|${profile}`
  const current = useRef(key)
  current.current = key
  const [state, setState] = useState<{ key: string; state: RoomSetupState } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [servers, setServers] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)
  const [showsCustom, setShowsCustom] = useState(false)
  const [showsSteps, setShowsSteps] = useState(false)
  const [working, setWorking] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const shown = state?.key === key ? state.state : null

  const show = useCallback((read: RoomSetupState, at: string, keepPicks: boolean) => {
    setState({ key: at, state: read })
    if (!keepPicks) {
      setPicked(new Set(read.ceiling))
      setServers(new Set(read.mcpServers))
    }
  }, [])

  const load = useCallback(async () => {
    const at = current.current
    setLoadError(null)
    try {
      const read = await client.current.state(profile)
      if (at === current.current) show(read, at, editing)
    } catch (error) {
      if (at === current.current) setLoadError(t('Could not read this setting from the host: {error}', { error: linksMessage(error) }))
    }
  }, [profile, editing, show])

  useEffect(() => {
    setState(null)
    setEditing(false)
    setOutcome(null)
    setShowsCustom(false)
    setShowsSteps(false)
    void load()
    // A new host or profile reads again; load changes with editing too, which shouldn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  /** Every 2 s for up to 30 s after the gateway starts restarting. */
  const followRestart = async (at: string, before: string | null) => {
    for (let check = 1; check <= 15; check++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      if (at !== current.current) return
      const read = await client.current.state(profile).catch(() => null)
      if (!read || at !== current.current) continue
      show(read, at, false)
      if (read.apiServer.running)
        return setOutcome({ text: t('The gateway restarted, and its API server runs at {address}.', { address: read.apiServer.address }) })
      if (read.apiServer.error && (read.apiServer.error !== before || check >= 5))
        return setOutcome({ text: t("The gateway restarted, but its API server isn't running: {error}", { error: read.apiServer.error }), trouble: true })
    }
    setOutcome({ text: t('The gateway is taking a while to start its API server.'), checksAgain: true })
  }

  const follow = (result: SetupResult, at: string) => {
    const restart = result.restart
    if (!restart) return setOutcome({ text: t('Saved') })
    if (restart.busy) {
      setOutcome({ text: t('Saved. The API server starts the next time the gateway restarts.') })
      const stops = t('Chats running on it stop if it restarts now.')
      if (window.confirm(`${t('Restart the gateway now?')}\n\n${restart.error ? `${restart.error}\n\n` : ''}${stops}`)) void setUp(true)
    } else if (restart.started) {
      setOutcome({ text: t('Saved. The gateway is restarting to start the API server…') })
      void followRestart(at, result.state.apiServer.error)
    } else {
      setOutcome({ text: t("Saved, but the gateway didn't restart: {error}", { error: restart.error ?? t("Hermes didn't say why.") }), trouble: true })
    }
  }

  const setUp = async (interrupt = false) => {
    if (!shown || working) return
    const at = key
    setWorking(true)
    setOutcome(null)
    try {
      const result = await client.current.setUp(profile, ceilingToSave(shown, picked), mcpServersToSave(shown, servers), interrupt)
      if (at !== current.current) return
      setEditing(false)
      show(result.state, at, false)
      follow(result, at)
    } catch (error) {
      if (at !== current.current) return
      setOutcome({ text: t('Could not set this Hermes up: {error}', { error: linksMessage(error) }), trouble: true })
      void load()
    } finally {
      setWorking(false)
    }
  }

  const save = () => {
    if (!shown) return
    // Each room pins its members' tools when it starts: a change stops the agent answering in rooms already going.
    if (
      changesSavedCeiling(shown, picked, servers) &&
      !window.confirm(
        `${t('Change what rooms may use?')}\n\n${t(
          '{name} then stops answering in rooms already started with other people\'s agents, which hold it to the tools it had when they started. New rooms use these.',
          { name: profileName }
        )}`
      )
    )
      return
    void setUp()
  }

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set)
    if (on) next.add(id)
    else next.delete(id)
    return next
  }

  const choiceRow = (choice: SetupChoice) => (
    <label key={choice.id} className="setup-choice">
      <input type="checkbox" checked={picked.has(choice.id)} disabled={working} onChange={e => setPicked(toggle(picked, choice.id, e.target.checked))} />
      <span>
        <strong>{choice.label}</strong>
        {choice.description ? <span className="meta">{choice.description}</span> : null}
        {neverLine(choice) ? <span className="meta">{neverLine(choice)}</span> : null}
      </span>
    </label>
  )

  const content = (s: RoomSetupState) => {
    if (s.blockers.length)
      return (
        <>
          <p>{t("This Hermes can't be set up for rooms yet:")}</p>
          {s.blockers.map((b, i) => (
            <p key={i} className="warning-text selectable">
              {b.message}
            </p>
          ))}
          <button className="secondary" disabled={working} onClick={() => void load()}>
            {t('Check again')}
          </button>
        </>
      )
    if (s.ready && !editing)
      return (
        <>
          <p className="success-text">{t('Ready for rooms')}</p>
          <p className="meta">
            {t('API server')}: {s.apiServer.address}
          </p>
          <p>{toolsLine(s, profileName)}</p>
          {serversLine(s) ? <p className="meta">{serversLine(s)}</p> : null}
          <button
            className="secondary"
            disabled={working}
            onClick={() => {
              setPicked(new Set(s.ceiling))
              setServers(new Set(s.mcpServers))
              setOutcome(null)
              setEditing(true)
            }}
          >
            {t('Change')}
          </button>
        </>
      )
    const lookups = s.choices.filter(c => c.lookup)
    const custom = s.choices.filter(c => !c.lookup)
    const unchanged = editing && ceilingToSave(s, picked) === null && mcpServersToSave(s, servers) === null
    return (
      <>
        {!s.ready ? (
          <>
            <p className="warning-text">{t('Not ready for rooms yet')}</p>
            <button className="link setup-fold" aria-expanded={showsSteps} onClick={() => setShowsSteps(!showsSteps)}>
              {t('What Set up does')}
            </button>
            {showsSteps ? (
              <>
                <p className="meta">{t("Rooms reach your agents through Hermes' API server. For {name}, Set up will:", { name: profileName })}</p>
                <ul className="setup-steps">
                  {setupLines(s, profileName).map(line => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {s.apiServer.error ? <p className="warning-text selectable">{t("The API server didn't start the last time: {error}", { error: s.apiServer.error })}</p> : null}
          </>
        ) : null}
        <h3 className="setup-heading">{t('Tools rooms may let {name} use', { name: profileName })}</h3>
        {lookups.length ? (
          <>
            <p className="meta">{t('Rooms that look things up or search past chats use these.')}</p>
            {lookups.map(choiceRow)}
          </>
        ) : null}
        {custom.length ? (
          <>
            <button className="link setup-fold" aria-expanded={showsCustom} onClick={() => setShowsCustom(!showsCustom)}>
              {t('Only for rooms set to Custom')}
              {customOn(s, picked) ? <span className="meta"> · {customOn(s, picked)}</span> : null}
            </button>
            {showsCustom ? (
              <>
                <p className="meta">{t('A room uses these only when its Custom choice names their tools.')}</p>
                {custom.map(choiceRow)}
              </>
            ) : null}
          </>
        ) : null}
        <p className="meta">
          {t('Each room\'s choices work within these. Tools added later, by a plugin, an MCP server or a Hermes update, stay out of rooms until you add them here.')}
        </p>
        {s.mcpChoices?.length ? (
          <>
            <h3 className="setup-heading">{t('MCP servers rooms may let {name} use', { name: profileName })}</h3>
            {s.mcpChoices.map(server => (
              <label key={server} className="setup-choice">
                <input type="checkbox" checked={servers.has(server)} disabled={working} onChange={e => setServers(toggle(servers, server, e.target.checked))} />
                <span>{server}</span>
              </label>
            ))}
            <p className="meta">
              {t("Off unless you turn one on. A server's tools then work only in rooms whose Custom choice names them, and its own approvals still apply.")}
            </p>
          </>
        ) : null}
        {s.apiServer.enabled ? (
          <p className="meta">{t("Hermes' API server is already on, so other apps that use it with {name}, such as Open WebUI, get only these tools too.", { name: profileName })}</p>
        ) : null}
        <div className="link-actions">
          {editing ? (
            <button
              className="link"
              disabled={working}
              onClick={() => {
                setPicked(new Set(s.ceiling))
                setServers(new Set(s.mcpServers))
                setEditing(false)
              }}
            >
              {t('Cancel')}
            </button>
          ) : null}
          <button className="primary" disabled={working || unchanged} onClick={save}>
            {working ? t('Working…') : editing ? t('Save') : t('Set up')}
          </button>
        </div>
      </>
    )
  }

  return (
    <section className="pset-section">
      <h2>{t('This Hermes')}</h2>
      {shown ? content(shown) : loadError ? null : <p className="meta">{t('Loading…')}</p>}
      {loadError ? (
        <>
          <p className="error-text">{loadError}</p>
          <button className="secondary" onClick={() => void load()}>
            {t('Try again')}
          </button>
        </>
      ) : null}
      {outcome ? (
        <>
          <p className={outcome.trouble ? 'warning-text' : 'meta'}>{outcome.text}</p>
          {outcome.checksAgain ? (
            <button
              className="secondary"
              onClick={() => {
                setOutcome(null)
                void load()
              }}
            >
              {t('Check again')}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
