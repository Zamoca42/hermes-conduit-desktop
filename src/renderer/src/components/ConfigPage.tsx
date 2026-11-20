import { answerKeeper, keptAnswer } from '../state/keptAnswers'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import {
  resolveTimeZone,
  fieldValue,
  listLines,
  readConfig,
  schemaKeys,
  shownFields,
  updateConfig,
  withValue,
  type Field,
  type Http,
  type Section
} from '../state/profileConfig'
import { Icon } from './icons'
import { useMouseBack } from '../state/mouseBack'

const http: Http = (method, path, body) => gateway.http(method, path, body)
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const withProfile = (path: string, profile: string) => (profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path)

/** The config and its schema's keys, kept together so a row never comes or goes when Hermes answers. */
const keptConfigKey = (profile: string) => withProfile('/api/config', profile)

interface Props {
  title: string
  subtitle: string
  sections: (config: Record<string, unknown>) => Section[]
  bots: { name: string; title: string }[]
  profile: string
  onBack: () => void
  /** Sections kept on this computer, under the profile's. */
  children?: React.ReactNode
}

/**
 * A page of a profile's config rows, after the phone's ProfileConfigSettingsPage
 * (Workspace & safety, Advanced): each row saves as it changes, in turn with
 * every other config save, and a row Hermes' schema doesn't list isn't shown.
 */
export function ConfigPage({ title, subtitle, sections, bots, profile: initialProfile, onBack, children }: Props) {
  useMouseBack(onBack)
  const [profile, setProfile] = useState(initialProfile)
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [schema, setSchema] = useState<Set<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    setError(null)
    const keep = answerKeeper(keptConfigKey(profile))
    try {
      const [read, keys] = await Promise.all([
        readConfig(http, profile),
        gateway.http('GET', withProfile('/api/config/schema', profile)).then(schemaKeys, () => null)
      ])
      if (generation.current !== mine) return
      setConfig(read)
      setSchema(keys)
      keep({ config: read, schema: keys ? [...keys] : null })
    } catch (e) {
      if (generation.current === mine) setError(message(e))
    }
  }, [profile])

  useEffect(() => {
    // The profile's rows as Hermes last gave them (credentials left out), until it answers again.
    const kept = keptAnswer(keptConfigKey(profile)) as { config?: unknown; schema?: unknown } | undefined
    const config = kept?.config && typeof kept.config === 'object' && !Array.isArray(kept.config) ? (kept.config as Record<string, unknown>) : null
    setConfig(config)
    setSchema(config && Array.isArray(kept?.schema) ? new Set(kept.schema.filter((k): k is string => typeof k === 'string')) : null)
    void load()
  }, [load])

  const save = async (key: string, value: unknown) => {
    setSaving(true)
    setSaveError(null)
    const mine = generation.current
    try {
      const saved = await updateConfig(http, profile, current => withValue(current, key, value))
      if (generation.current === mine) setConfig(saved)
    } catch (e) {
      setSaveError(t('Couldn’t save that change: {error}', { error: message(e) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pset">
      <div className="pulse-head">
        <button className="staged-remove" aria-label={t('Back')} title={t('Back')} onClick={onBack}>
          <Icon name="back" />
        </button>
        <h1>{title}</h1>
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
      <p className="meta">{subtitle}</p>
      {saveError ? <p className="error-text">{saveError}</p> : null}
      {!config ? (
        error ? (
          <div className="pset-row">
            <span className="error-text">{t('Could not load profile settings: {error}', { error })}</span>
            <button className="secondary" onClick={() => void load()}>
              {t('Try Again')}
            </button>
          </div>
        ) : (
          <p className="meta">{t('Loading…')}</p>
        )
      ) : (
        sections(config).map(section => {
          const fields = shownFields(section, schema)
          if (!fields.length) return null
          return (
            <section key={section.title} className="pset-section">
              <h2>{section.title}</h2>
              {fields.map(field => (
                <FieldRow key={`${profile}:${field.key}`} field={field} value={fieldValue(config, field)} busy={saving} onSave={v => void save(field.key, v)} />
              ))}
            </section>
          )
        })
      )}
      {children}
    </div>
  )
}

/** One config row: a switch, a number, a choice, a line of text, or a list one per line. */
export function FieldRow({ field, value, busy, onSave }: { field: Field; value: boolean | number | string; busy: boolean; onSave: (value: unknown) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const control = field.control
  const commitNumber = () => {
    const n = Number(draft.trim())
    if (!draft.trim() || !Number.isFinite(n)) return setDraft(String(value))
    if (n !== value) onSave(n)
  }
  const commitText = () => {
    const next = draft.trim()
    if (next !== String(value)) onSave(next)
  }
  const [zoneError, setZoneError] = useState(false)
  const commitZone = (typed: string) => {
    const zone = resolveTimeZone(typed)
    setZoneError(zone === null)
    if (zone === null) return
    setDraft(zone)
    if (zone !== String(value)) onSave(zone)
  }
  const commitList = () => {
    const lines = listLines(draft)
    if (lines.join('\n') !== String(value)) onSave(lines)
  }
  const wide = control.kind === 'text' || control.kind === 'list' || control.kind === 'timezone'
  return (
    <div className={`mem-row${wide ? ' wide' : ''}`}>
      <div className="mem-text">
        <span>{field.label}</span>
        <span className="meta">{field.help}</span>
      </div>
      {control.kind === 'toggle' || control.kind === 'textToggle' ? (
        <label className="switch-inline">
          <input
            type="checkbox"
            checked={value === true}
            disabled={busy}
            aria-label={field.label}
            onChange={e => onSave(control.kind === 'textToggle' ? (e.target.checked ? control.on : control.off) : e.target.checked)}
          />
        </label>
      ) : control.kind === 'number' ? (
        <input
          className="mem-number"
          type="number"
          inputMode="decimal"
          value={draft}
          disabled={busy}
          aria-label={field.label}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitNumber}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      ) : control.kind === 'text' ? (
        <input
          className="pset-note mem-text-input"
          value={draft}
          disabled={busy}
          spellCheck={false}
          aria-label={field.label}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      ) : control.kind === 'timezone' ? (
        <div className="mem-zone">
          <input
            className="pset-note mem-text-input"
            value={draft}
            disabled={busy}
            spellCheck={false}
            placeholder={t("Server's local time")}
            aria-label={field.label}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => commitZone(draft)}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          {String(value) ? (
            <button className="link" disabled={busy} onClick={() => commitZone('')}>
              {t("Use the server's local time")}
            </button>
          ) : null}
          {zoneError ? (
            <p className="error-text">
              {t("That isn't a time zone name. Use one like America/Toronto or Europe/Paris, or leave it blank for the server's local time.")}
            </p>
          ) : null}
        </div>
      ) : control.kind === 'list' ? (
        <textarea
          className="pset-note mem-text-input"
          rows={Math.min(8, Math.max(2, draft.split('\n').length + 1))}
          value={draft}
          disabled={busy}
          spellCheck={false}
          aria-label={field.label}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitList}
        />
      ) : (
        <select className="language-select" value={String(value)} disabled={busy} aria-label={field.label} onChange={e => onSave(e.target.value)}>
          {control.options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
