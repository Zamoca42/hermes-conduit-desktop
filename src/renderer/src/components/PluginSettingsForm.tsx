import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import { gateway } from '../gateway'
import { isDirty, parseFields, planSave, type PluginSettingField } from '../state/pluginSettings'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * A plugin's own settings in its Plugins row, after the phone's: the fields
 * its manifest declares, saved together. A secret is asked for, written to
 * the profile's `.env`, and never shown or kept here.
 */
export function PluginSettingsForm({
  pluginKey,
  row,
  profile,
  canManage,
  onSaved
}: {
  pluginKey: string
  row: unknown
  profile: string
  canManage: boolean
  onSaved: () => void
}) {
  const [fields, setFields] = useState<PluginSettingField[]>(() => parseFields(row))
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => setFields(parseFields(row)), [row])
  if (!fields.length) return null

  const value = (f: PluginSettingField) => draft[f.key] ?? f.initial
  const set = (f: PluginSettingField, raw: string) => {
    setDraft(d => ({ ...d, [f.key]: raw }))
    setNote(null)
  }

  async function save() {
    let plan
    try {
      plan = planSave(fields, draft)
    } catch (e) {
      return setNote({ text: message(e), ok: false })
    }
    if (!Object.keys(plan.values).length && !Object.keys(plan.secrets).length) return
    setSaving(true)
    setNote(null)
    const written: string[] = []
    try {
      for (const [key, v] of Object.entries(plan.secrets).sort(([a], [b]) => a.localeCompare(b))) {
        await gateway.http('PUT', '/api/env', { key, value: v })
        written.push(key)
      }
      if (Object.keys(plan.values).length) {
        const answer = (await gateway.rpc('plugins.manage', { action: 'settings', key: pluginKey, values: plan.values, profile })) as Record<string, unknown>
        if (answer?.ok !== true) throw new Error(typeof answer?.error === 'string' && answer.error ? answer.error : t('Hermes refused the settings.'))
        if (answer.plugin) setFields(parseFields(answer.plugin))
      }
      setDraft({})
      setNote({ text: t('Saved. The plugin reads its new settings.'), ok: true })
      onSaved()
    } catch (e) {
      // Keys already in `.env` stay there: their fields empty and show as set.
      if (written.length) {
        setFields(list => list.map(f => (f.env && written.includes(f.env) ? { ...f, hasValue: true } : f)))
        setDraft(d => Object.fromEntries(Object.entries(d).filter(([k]) => !fields.some(f => f.key === k && f.env && written.includes(f.env)))))
        setNote({ text: t("The keys were saved, but the other settings weren't: {reason}", { reason: message(e) }), ok: false })
      } else setNote({ text: message(e), ok: false })
    } finally {
      setSaving(false)
    }
  }

  const disabled = !canManage || saving
  return (
    <div className="plugin-settings">
      <h3>{t('Settings')}</h3>
      {fields.map(f => (
        <div key={f.key} className="plugin-setting">
          {f.kind === 'boolean' ? (
            <label className="plugin-setting-check">
              <input type="checkbox" checked={value(f) === 'true'} disabled={disabled} onChange={e => set(f, e.target.checked ? 'true' : 'false')} />
              <FieldTitle field={f} />
            </label>
          ) : (
            <label className="plugin-setting-label">
              <FieldTitle field={f} />
              {f.kind === 'enum' ? (
                <select value={value(f)} disabled={disabled} onChange={e => set(f, e.target.value)}>
                  {f.choices.map(c => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : f.kind === 'json' ? (
                <textarea className="mono" rows={4} spellCheck={false} value={value(f)} disabled={disabled} onChange={e => set(f, e.target.value)} />
              ) : (
                <input
                  type={f.kind === 'secret' ? 'password' : 'text'}
                  inputMode={f.kind === 'number' ? 'decimal' : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={f.kind === 'secret' ? (f.hasValue ? t('Saved. Enter a new one to replace it.') : t('Not set')) : undefined}
                  value={value(f)}
                  disabled={disabled}
                  onChange={e => set(f, e.target.value)}
                />
              )}
            </label>
          )}
          {f.description ? <span className="meta">{f.description}</span> : null}
        </div>
      ))}
      {note ? <p className={note.ok ? 'meta' : 'error-text'}>{note.text}</p> : null}
      {canManage ? (
        <div className="pset-actions">
          <button className="secondary" disabled={saving || !isDirty(fields, draft)} onClick={() => void save()}>
            {saving ? t('Saving…') : t('Save Settings')}
          </button>
        </div>
      ) : (
        <p className="meta">{t("Hermes keeps plugin settings for the host's default profile. Switch to it to change them.")}</p>
      )}
    </div>
  )
}

function FieldTitle({ field }: { field: PluginSettingField }) {
  return (
    <span className="plugin-setting-title">
      {field.label}
      {field.required ? (
        <span className="plugin-setting-required" aria-label={t('Required')}>
          *
        </span>
      ) : null}
    </span>
  )
}
