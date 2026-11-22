import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackScroll } from '../state/keptScroll'
import { t } from '@shared/i18n'
import { gateway, GatewayError } from '../gateway'
import { scoped } from '../state/capabilities'
import {
  officialGroups,
  parseOfficial,
  parseResults,
  parseScan,
  parseSources,
  policyTitle,
  repoURL,
  trustLabel,
  waitForAction,
  type HubResults,
  type HubScan,
  type HubSkill,
  type HubSnapshot,
  type OfficialSkill
} from '../state/skillHub'
import { Markdown } from './Markdown'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'
import { Select } from './Select'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const missingRoute = (e: unknown) => e instanceof GatewayError && (e.code === 404 || e.code === 405)
const severityTitle = (s: string) => (s === 'critical' ? t('Critical') : s === 'high' ? t('High') : s === 'medium' ? t('Medium') : s === 'low' ? t('Low') : s)

function SkillRow({ skill, installed, onOpen }: { skill: HubSkill; installed: boolean; onOpen: () => void }) {
  return (
    <button className="cap-row cap-row-text hub-row" onClick={onOpen}>
      <strong>{skill.name}</strong>
      <span className="cap-badge">{trustLabel(skill.trust)}</span>
      {installed ? <span className="cap-badge on">{t('Installed')}</span> : null}
      {skill.description ? <span className="meta">{skill.description}</span> : null}
    </button>
  )
}

/** A hub skill's page: the security scan, its SKILL.md, and Install or Remove. */
function HubSkillPage({
  skill,
  profile,
  installedName,
  onBack,
  onChanged
}: {
  skill: HubSkill
  profile: string
  installedName?: string
  onBack: () => void
  onChanged: (identifier: string, name: string | null) => void
}) {
  const [scan, setScan] = useState<HubScan | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState<'install' | 'remove' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    []
  )
  const id = encodeURIComponent(skill.identifier)

  const runScan = useCallback(async () => {
    setScan(null)
    setScanError(null)
    try {
      const answer = parseScan(await gateway.http('GET', scoped(`/api/skills/hub/scan?identifier=${id}`, profile), undefined, 90_000))
      if (live.current) setScan(answer)
    } catch (e) {
      if (live.current) setScanError(message(e))
    }
  }, [id, profile])

  useEffect(() => {
    void runScan()
    void gateway
      .http('GET', scoped(`/api/skills/hub/preview?identifier=${id}`, profile), undefined, 60_000)
      .then(
        answer => live.current && setPreview(typeof (answer as { skill_md?: unknown })?.skill_md === 'string' ? (answer as { skill_md: string }).skill_md : '')
      )
      .catch(() => live.current && setPreview(''))
  }, [id, profile, runScan])

  const act = async (kind: 'install' | 'remove') => {
    setBusy(kind)
    setProblem(null)
    try {
      const body: Record<string, unknown> = kind === 'install' ? { identifier: skill.identifier } : { name: installedName }
      if (profile !== 'default') body.profile = profile
      const started = (await gateway.http('POST', scoped(`/api/skills/hub/${kind === 'install' ? 'install' : 'uninstall'}`, profile), body, 45_000)) as {
        name?: unknown
      }
      if (typeof started?.name !== 'string') throw new Error(t("Hermes didn't start the install."))
      const outcome = await waitForAction(path => gateway.http('GET', path), started.name, { live: () => live.current })
      if (!live.current) return
      if (outcome.ok) onChanged(skill.identifier, kind === 'install' ? skill.name : null)
      else setProblem(outcome.reason)
    } catch (e) {
      if (live.current) setProblem(message(e))
    } finally {
      if (live.current) setBusy(null)
    }
  }

  const source = repoURL(skill.repo)
  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{skill.name}</h1>
      </div>
      <p className="meta">
        {trustLabel(skill.trust)}
        {skill.source && skill.source !== 'official' ? ` · ${skill.source}` : ''}
      </p>
      {skill.description ? <p>{skill.description}</p> : null}
      <div className="pset-actions hub-actions">
        {installedName ? (
          <button className="secondary" disabled={busy !== null} onClick={() => void act('remove')}>
            {busy === 'remove' ? t('Removing…') : t('Remove Skill')}
          </button>
        ) : (
          <button className="primary" disabled={busy !== null || !scan || scan.policy === 'block'} onClick={() => void act('install')}>
            {busy === 'install' ? t('Installing…') : t('Install')}
          </button>
        )}
        {source ? (
          <a className="link" href={source} target="_blank" rel="noreferrer">
            {t('View Source')}
          </a>
        ) : null}
      </div>
      {!installedName && !scan && !scanError ? <p className="meta">{t("Install waits for Hermes' security scan.")}</p> : null}
      {problem ? <p className="error-text">{problem}</p> : null}
      <section className="pset-section">
        <h2>{t('Security Scan')}</h2>
        {scanError ? (
          <div className="pset-row">
            <span className="error-text">{t("Hermes couldn't scan this skill, so it can't be installed from here.")}</span>
            <button className="secondary" onClick={() => void runScan()}>
              {t('Try Again')}
            </button>
          </div>
        ) : !scan ? (
          <p className="meta">{t('Hermes is scanning this skill…')}</p>
        ) : (
          <>
            <div className={`host-status tone-${scan.policy === 'allow' ? 'good' : scan.policy === 'ask' ? 'warn' : 'bad'}`}>
              <span className="host-status-mark" aria-hidden="true">
                {scan.policy === 'allow' ? '✓' : '!'}
              </span>
              <div className="host-status-text">
                <strong>{policyTitle(scan.policy)}</strong>
                {scan.reason ? <div className="meta">{scan.reason}</div> : null}
              </div>
            </div>
            {scan.findings.length ? (
              <ul className="hub-findings">
                {scan.findings.map((f, i) => (
                  <li key={i}>
                    <span className={`cap-badge sev-${f.severity}`}>{severityTitle(f.severity)}</span> {f.description}
                    {f.file ? (
                      <span className="meta">
                        {' '}
                        · {f.file}
                        {f.line ? `:${f.line}` : ''}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>
      <section className="pset-section cap-skill-body">
        <h2>{t('Instructions')}</h2>
        {preview === null ? (
          <p className="meta">{t('Loading…')}</p>
        ) : preview ? (
          <Markdown text={preview.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()} />
        ) : (
          <p className="meta">{t('No description.')}</p>
        )}
      </section>
    </div>
  )
}

/**
 * Browse Skill Hub, after the phone's: the Hermes Index's featured skills, a
 * search across the profile's sources, and a skill's page. Hermes searches
 * its sources itself, so nothing downloads the whole catalog.
 */
export function SkillHub({ profile, onBack, onChanged }: { profile: string; onBack: () => void; onChanged: () => void }) {
  useMouseBack(onBack)
  const [hub, setHub] = useState<HubSnapshot | null>(null)
  const [hubError, setHubError] = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [results, setResults] = useState<HubResults | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [open, setOpen] = useState<HubSkill | null>(null)
  // Back from a skill's page lands where the list was.
  useBackScroll(open ? `skill:${open.identifier}` : 'list')
  const [official, setOfficial] = useState<OfficialSkill[] | null>(null)
  const [category, setCategory] = useState('')
  const searchId = useRef(0)

  const loadHub = useCallback(async () => {
    setHubError(null)
    try {
      setHub(parseSources(await gateway.http('GET', scoped('/api/skills/hub/sources', profile), undefined, 60_000)))
    } catch (e) {
      if (missingRoute(e)) setUnsupported(true)
      else setHubError(message(e))
    }
  }, [profile])

  useEffect(() => {
    void loadHub()
    void gateway
      .http('GET', scoped('/api/skills/hub/official', profile), undefined, 60_000)
      .then(answer => setOfficial(parseOfficial(answer)))
      .catch(() => setOfficial([]))
  }, [loadHub, profile])

  const search = async () => {
    const q = query.trim()
    const mine = ++searchId.current
    if (!q) {
      setResults(null)
      return
    }
    setSearching(true)
    setSearchError(null)
    try {
      const path = `/api/skills/hub/search?q=${encodeURIComponent(q)}&limit=30${source !== 'all' ? `&source=${encodeURIComponent(source)}` : ''}`
      const answer = parseResults(await gateway.http('GET', scoped(path, profile), undefined, 60_000))
      if (searchId.current === mine) setResults(answer)
    } catch (e) {
      if (searchId.current === mine) setSearchError(message(e))
    } finally {
      if (searchId.current === mine) setSearching(false)
    }
  }

  const installed: Record<string, string> = {
    ...Object.fromEntries((official ?? []).filter(s => s.installed).map(s => [s.identifier, s.name])),
    ...(hub?.installed ?? {}),
    ...(results?.installed ?? {})
  }
  const categories = officialGroups(official ?? [])
  const shownGroups = category ? categories.filter(group => group.category === category) : categories

  if (open)
    return (
      <HubSkillPage
        key={open.identifier}
        skill={open}
        profile={profile}
        installedName={installed[open.identifier]}
        onBack={() => setOpen(null)}
        onChanged={(identifier, name) => {
          const mark = (map: Record<string, string>) => {
            const next = { ...map }
            if (name) next[identifier] = name
            else delete next[identifier]
            return next
          }
          setHub(now => now && { ...now, installed: mark(now.installed) })
          setResults(now => now && { ...now, installed: mark(now.installed) })
          setOfficial(now => now && now.map(s => (s.identifier === identifier ? { ...s, installed: !!name } : s)))
          onChanged()
        }}
      />
    )

  const list = (skills: HubSkill[]) =>
    skills.map(skill => <SkillRow key={skill.identifier} skill={skill} installed={!!installed[skill.identifier]} onOpen={() => setOpen(skill)} />)

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{t('Skill Hub')}</h1>
      </div>
      {unsupported ? (
        <section className="pset-section">
          <h2>{t('No skill hub on this Hermes')}</h2>
          <p className="meta">{t('Update Hermes to browse and install skills from the hub.')}</p>
        </section>
      ) : (
        <>
          <form
            className="cap-bar"
            onSubmit={e => {
              e.preventDefault()
              void search()
            }}
          >
            <input
              className="cap-search"
              type="search"
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                if (!e.target.value.trim()) setResults(null)
              }}
              placeholder={t('Search the skill hub')}
              aria-label={t('Search the skill hub')}
            />
            {hub && hub.sources.length > 1 ? (
              <Select className="language-select" value={source} aria-label={t('Source')} onChange={picked => setSource(picked)}>
                <option value="all">{t('All Sources')}</option>
                {hub.sources.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            ) : null}
          </form>
          {searching ? <p className="meta">{t('Loading…')}</p> : null}
          {searchError ? (
            <div className="pset-row">
              <span className="error-text">{t("The search didn't finish")}</span>
              <button className="secondary" onClick={() => void search()}>
                {t('Try Again')}
              </button>
            </div>
          ) : null}
          {results ? (
            <section className="pset-section">
              <h2>{t('Results')}</h2>
              {results.timedOut.length ? <p className="meta">{t("{names} didn't answer in time.", { names: results.timedOut.join(', ') })}</p> : null}
              {results.results.length ? list(results.results) : <p className="meta">{t('No matching skills')}</p>}
            </section>
          ) : !hub ? (
            hubError ? (
              <div className="pset-row">
                <span className="error-text">{t("Couldn't reach the skill hub")}</span>
                <button className="secondary" onClick={() => void loadHub()}>
                  {t('Try Again')}
                </button>
              </div>
            ) : (
              <p className="meta">{t('Loading…')}</p>
            )
          ) : (
            <section className="pset-section">
              <h2>{t('Featured')}</h2>
              <p className="meta">
                {hub.featured.length
                  ? t('Popular skills from the Hermes Index. Hermes scans each skill before it installs.')
                  : t('Search skills.sh, GitHub, ClawHub and the other sources Hermes has.')}
              </p>
              {list(hub.featured)}
            </section>
          )}
          {!results && official?.length ? (
            <section className="pset-section">
              <div className="hub-head">
                <h2>{t('Available to install')}</h2>
                <span className="spacer" />
                <Select className="language-select" value={category} aria-label={t('Category')} onChange={picked => setCategory(picked)}>
                  <option value="">{t('All Categories')}</option>
                  {categories.map(group => (
                    <option key={group.category} value={group.category}>
                      {group.title}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="meta">{t("From Hermes' official skills catalog. Hermes scans each skill before it installs.")}</p>
              {shownGroups.map(group => (
                <div key={group.category}>
                  <h3 className="hub-category">{group.title}</h3>
                  {list(group.skills)}
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
