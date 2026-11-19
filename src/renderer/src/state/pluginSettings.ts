/**
 * A plugin's own settings, after the phone's PluginSettings.swift: the
 * fields its manifest's `config_schema` declares, which Hermes lists with
 * each plugin (`plugins.manage` `list`, the row's `settings_schema`) and
 * writes with `plugins.manage` `settings`. A secret field carries only
 * where it lives (`env`) and whether it's set: its value goes to the
 * profile's `.env` and is never read back.
 */
import { t } from '../../../shared/i18n'

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'secret'

export interface PluginSettingField {
  key: string
  kind: FieldKind
  label: string
  description: string
  required: boolean
  /** The value as the form starts it: text for every kind, `true` or `false` for a switch, empty for a secret. */
  initial: string
  choices: string[]
  /** A secret's `.env` variable. */
  env?: string
  /** A secret that already has a value. */
  hasValue: boolean
}

type Row = Record<string, unknown>
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const KINDS: FieldKind[] = ['string', 'number', 'boolean', 'enum', 'json', 'secret']

export function initialText(kind: FieldKind, value: unknown, choices: string[]): string {
  switch (kind) {
    case 'secret':
      return ''
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'enum':
      return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : (choices[0] ?? '')
    case 'json':
      return value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : ''
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : ''
    case 'string':
      return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  }
}

function field(raw: unknown): PluginSettingField | null {
  const r = (raw ?? {}) as Row
  const key = text(r.key)
  if (!key) return null
  const kind = KINDS.find(k => k === text(r.type)) ?? 'string'
  // A secret goes only to `.env`: one that names no variable can't be saved.
  const env = text(r.env)
  if (kind === 'secret' && !env) return null
  const choices = Array.isArray(r.choices) ? r.choices.map(text).filter(Boolean) : []
  return {
    key,
    kind,
    label: text(r.label) || key,
    description: text(r.description),
    required: r.required === true,
    initial: initialText(kind, r.value !== undefined ? r.value : r.default, choices),
    choices,
    env: kind === 'secret' ? env : undefined,
    hasValue: kind === 'secret' && r.has_value === true
  }
}

/** The fields one plugin's row declares (`settings_schema`), each key once. */
export function parseFields(row: unknown): PluginSettingField[] {
  const list = ((row ?? {}) as Row).settings_schema
  const seen = new Set<string>()
  return (Array.isArray(list) ? list : []).flatMap(raw => {
    const f = field(raw)
    if (!f || seen.has(f.key)) return []
    seen.add(f.key)
    return [f]
  })
}

/** The row Hermes lists for a plugin, by its key, then its name. */
export function settingsRow(response: unknown, ...names: string[]): Row | undefined {
  const rows = (((response ?? {}) as Row).plugins ?? []) as unknown
  const list = Array.isArray(rows) ? rows.filter((r): r is Row => !!r && typeof r === 'object') : []
  for (const name of names) {
    const row = list.find(r => text(r.key) === name) ?? list.find(r => text(r.name) === name)
    if (row) return row
  }
  return undefined
}

/** The form's text as Hermes takes it; throws a message for the field when the text doesn't fit. */
export function wireValue(f: PluginSettingField, raw: string): unknown {
  const trimmed = raw.trim()
  switch (f.kind) {
    case 'boolean':
      return trimmed === 'true'
    case 'enum':
      if (!f.choices.includes(trimmed)) throw new Error(t('{label}: pick one of the choices.', { label: f.label }))
      return trimmed
    case 'number': {
      // A lone comma is a decimal too.
      const normal = !trimmed.includes('.') && trimmed.split(',').length === 2 ? trimmed.replace(',', '.') : trimmed
      const n = normal ? Number(normal) : NaN
      if (!Number.isFinite(n)) throw new Error(t('{label}: enter a number.', { label: f.label }))
      return n
    }
    case 'json': {
      // Hermes takes only a list or an object here, never null.
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        parsed = null
      }
      if (parsed === null || typeof parsed !== 'object') throw new Error(t('{label}: enter a JSON list or object.', { label: f.label }))
      return parsed
    }
    case 'string':
      return raw
    case 'secret':
      return trimmed
  }
}

export interface SettingsSave {
  values: Record<string, unknown>
  /** `.env` variable to its new value. */
  secrets: Record<string, string>
}

/** The changed fields of a form, ready to send. A secret left blank stays as it is; an unchanged value isn't sent. */
export function planSave(fields: PluginSettingField[], draft: Record<string, string>): SettingsSave {
  const values: Record<string, unknown> = {}
  const secrets: Record<string, string> = {}
  for (const f of fields) {
    const raw = draft[f.key]
    if (raw === undefined) continue
    if (f.kind === 'secret') {
      if (raw.trim() && f.env) secrets[f.env] = raw.trim()
      continue
    }
    if (raw === f.initial) continue
    if (f.required && f.kind !== 'boolean' && !raw.trim()) throw new Error(t('{label} is required.', { label: f.label }))
    values[f.key] = wireValue(f, raw)
  }
  return { values, secrets }
}

export const isDirty = (fields: PluginSettingField[], draft: Record<string, string>) =>
  fields.some(f => {
    const raw = draft[f.key]
    return raw !== undefined && (f.kind === 'secret' ? !!raw.trim() : raw !== f.initial)
  })
