/**
 * Settings > Passwords & logins, after the phone's CredentialVault: Hermes'
 * credential vault over the gateway's `vault.*` calls (Hermes 0.23+). Hermes
 * answers with metadata only; what the Add form and the Unlock field hold
 * goes once onto the socket and is never kept.
 */
import { t } from '../../../shared/i18n'

export const LOCAL = 'local'
export type VaultKind = 'login' | 'payment' | 'address'
export const KINDS: VaultKind[] = ['login', 'payment', 'address']

export interface VaultItem {
  id: string
  /** Hermes' own kind name; one this app doesn't know shows as is. */
  kind: string
  label: string
  origin: string | null
  identifier: string | null
  created: string | null
  hasOTP: boolean
  /** `local`, or the password manager's name. */
  source: string
}

export interface VaultSource {
  name: string
  displayName: string
  enabled: boolean
  needsUnlock: boolean
  unlocked: boolean
  installed: boolean
}

type Row = Record<string, unknown>
const rows = (v: unknown, key: string): Row[] => {
  const list = (v as Row | null)?.[key]
  return Array.isArray(list) ? list.filter((r): r is Row => !!r && typeof r === 'object') : []
}
const text = (v: unknown) => (typeof v === 'string' ? v : null)

export function vaultItems(answer: unknown): VaultItem[] {
  return rows(answer, 'items').flatMap(r => {
    const id = text(r.id)
    const kind = text(r.kind)
    if (!id || kind === null) return []
    const identifier = text(r.identifier)
    return [
      {
        id,
        kind,
        label: text(r.label) ?? '',
        origin: text(r.origin),
        identifier: identifier || null,
        created: text(r.created_at),
        hasOTP: r.has_otp === true,
        source: text(r.backend) ?? LOCAL
      }
    ]
  })
}

export function vaultSources(answer: unknown): VaultSource[] {
  return rows(answer, 'sources').flatMap(r => {
    const name = text(r.name)
    if (!name) return []
    return [
      {
        name,
        displayName: text(r.display_name) || name,
        enabled: r.enabled === true,
        needsUnlock: r.needs_unlock === true,
        unlocked: r.unlocked === true,
        installed: r.installed === true
      }
    ]
  })
}

export const kindTitle = (kind: string) =>
  kind === 'login' ? t('Login') : kind === 'payment' ? t('Payment card') : kind === 'address' ? t('Postal address') : kind

export function sourceStatus(source: VaultSource): string {
  if (!source.installed) return t('Not detected')
  if (!source.enabled) return t('Off')
  return source.unlocked ? t('Unlocked') : t('Locked')
}

export function sourceCaption(source: VaultSource): string {
  if (!source.installed)
    return t('Not detected. Install the {name} command-line tool on the Hermes computer and sign in to it; Hermes picks it up automatically.', {
      name: source.displayName
    })
  if (!source.enabled) return t('Detected but turned off for Hermes.')
  if (source.unlocked) return t('Unlocked for this session. Locks itself after 30 minutes idle or when Hermes closes.')
  return t('Detected. Hermes asks you to unlock it when it needs a login, or unlock it now.')
}

/** The origin without its scheme, or null when the label already says it. */
export function shownOrigin(item: VaultItem): string | null {
  if (!item.origin) return null
  const host = item.origin.replace(/^https?:\/\//, '')
  return host === item.label ? null : host
}

/** The kind, the login's identifier, the site, and where it lives or when it was added, as one line. */
export function itemDetails(item: VaultItem, sources: VaultSource[]): string {
  const parts = [kindTitle(item.kind)]
  if (item.identifier) parts.push(item.identifier)
  const origin = shownOrigin(item)
  if (origin) parts.push(origin)
  if (item.source !== LOCAL) parts.push(sources.find(s => s.name === item.source)?.displayName ?? item.source)
  else if (item.created) {
    // Python writes microseconds; Date takes milliseconds.
    const date = new Date(item.created.replace(/(\.\d{3})\d+/, '$1'))
    if (!Number.isNaN(date.getTime())) parts.push(t('Added {date}', { date: date.toLocaleDateString(undefined, { dateStyle: 'medium' }) }))
  }
  return parts.join(' · ')
}

/** The site as Hermes keys a login by it, `scheme://host[:port]`; null when there's no host. */
export function normalizedOrigin(typed: string): string | null {
  const value = typed.trim()
  if (!value || /\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    return null
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (!['http', 'https'].includes(scheme) || !url.hostname) return null
  return `${scheme}://${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
}

export interface VaultDraft {
  kind: VaultKind
  label: string
  origin: string
  identifierType: 'email' | 'phone' | 'username'
  identifier: string
  password: string
  otpSecret: string
  cardNumber: string
  cardholderName: string
  expMonth: string
  expYear: string
  cvc: string
  postalCode: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  country: string
}

export const emptyDraft = (): VaultDraft => ({
  kind: 'login',
  label: '',
  origin: '',
  identifierType: 'email',
  identifier: '',
  password: '',
  otpSecret: '',
  cardNumber: '',
  cardholderName: '',
  expMonth: '',
  expYear: '',
  cvc: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: ''
})

export interface VaultRequest {
  kind: VaultKind
  label: string
  origin: string | null
  secret: Record<string, string>
}

/** `vault.add`'s params, or what's missing in the words the form shows. */
export function draftRequest(draft: VaultDraft): { ok: true; request: VaultRequest } | { ok: false; problem: string } {
  const fail = (problem: string) => ({ ok: false as const, problem })
  const typedOrigin = draft.origin.trim()
  const origin = normalizedOrigin(typedOrigin)
  if ((typedOrigin && !origin) || (draft.kind === 'login' && !origin)) return fail(t("Enter the site's address, like github.com."))
  let label = draft.label.trim()
  // A login named for nothing is named for its site, as Hermes names one saved on a sign-in page.
  if (!label && origin) label = new URL(origin).hostname
  if (!label) return fail(t('Give it a label.'))
  const secret: Record<string, string> = {}
  const put = (key: string, value: string) => {
    if (value.trim()) secret[key] = value.trim()
  }
  if (draft.kind === 'login') {
    const id = draft.identifier.trim()
    if (!id || !draft.password.trim()) return fail(t("Enter the login's email or username and its password."))
    secret.identifier_type = draft.identifierType
    secret.identifier = id
    secret.password = draft.password
    const key = draft.otpSecret.trim()
    put('otp_secret', key.toLowerCase().startsWith('otpauth://') ? key : key.replace(/[\s-]/g, ''))
  } else if (draft.kind === 'payment') {
    const digits = draft.cardNumber.replace(/[\s-]/g, '')
    if (!digits || !/^\d+$/.test(digits)) return fail(t('Enter the card number.'))
    const month = Number(draft.expMonth.trim())
    const year = draft.expYear.trim()
    if (!Number.isInteger(month) || month < 1 || month > 12 || !/^(\d{2}|\d{4})$/.test(year)) return fail(t('Enter the expiry month (1 to 12) and year.'))
    if (!draft.cvc.trim()) return fail(t('Enter the security code.'))
    secret.card_number = digits
    secret.exp_month = String(month).padStart(2, '0')
    secret.exp_year = year
    put('cvc', draft.cvc)
    put('cardholder_name', draft.cardholderName)
    put('billing_postal_code', draft.postalCode)
  } else {
    put('address_line1', draft.addressLine1)
    put('address_line2', draft.addressLine2)
    put('city', draft.city)
    put('state', draft.state)
    put('postal_code', draft.postalCode)
    put('country', draft.country)
    if (!['address_line1', 'city', 'postal_code', 'country'].every(k => secret[k])) return fail(t('Enter the street, city, postal code and country.'))
  }
  return { ok: true, request: { kind: draft.kind, label, origin, secret } }
}
