/**
 * What went wrong reaching a dashboard, in the phone's words
 * (Conduit/Services/ConnectionFailure.swift): a network or TLS failure is
 * named by the check that failed, rather than shown as Node's own error.
 * No TLS check is ever overridden: a certificate this computer refuses
 * stays refused, and the message says what to fix.
 */
import { t } from '../shared/i18n'

export type ConnectionFailureKind = 'timedOut' | 'hostNotFound' | 'unreachable' | 'tlsUntrusted' | 'tlsBadDate' | 'tlsHostnameMismatch' | 'tlsFailure'

const UNTRUSTED = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_REJECTED'
])

/** The error codes along `error`'s cause chain (fetch wraps the socket's in `cause`). */
function codes(error: unknown): { codes: string[]; names: string[] } {
  const found: string[] = []
  const names: string[] = []
  let current: unknown = error
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const row = current as { code?: unknown; name?: unknown; cause?: unknown; errors?: unknown }
    if (typeof row.code === 'string') found.push(row.code)
    if (typeof row.name === 'string') names.push(row.name)
    // A host with several addresses fails each: an AggregateError holds them.
    if (Array.isArray(row.errors)) for (const inner of row.errors) if (inner && typeof (inner as { code?: unknown }).code === 'string') found.push((inner as { code: string }).code)
    current = row.cause
  }
  return { codes: found, names }
}

/** Which failure `error` is, or null when it isn't one of these (the caller keeps its own words). */
export function connectionFailureKind(error: unknown): ConnectionFailureKind | null {
  const { codes: found, names } = codes(error)
  const has = (...wanted: string[]) => found.some(code => wanted.includes(code))
  if (has('CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID')) return 'tlsBadDate'
  if (has('ERR_TLS_CERT_ALTNAME_INVALID')) return 'tlsHostnameMismatch'
  if (found.some(code => UNTRUSTED.has(code))) return 'tlsUntrusted'
  if (found.some(code => code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_')) || has('EPROTO')) return 'tlsFailure'
  if (names.includes('TimeoutError') || has('ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT')) return 'timedOut'
  if (has('ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME')) return 'hostNotFound'
  if (has('ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EHOSTDOWN', 'ENETDOWN', 'UND_ERR_SOCKET')) return 'unreachable'
  return null
}

export function connectionFailureMessage(kind: ConnectionFailureKind): string {
  switch (kind) {
    case 'timedOut':
      return t('The dashboard did not respond in time. Check the address, the network connection, and whether the Hermes dashboard is running.')
    case 'hostNotFound':
      return t('Conduit could not find that host. Check the dashboard address and try again.')
    case 'unreachable':
      return t('Conduit could not connect to the dashboard at this address. Make sure the dashboard is running and that this device can reach it.')
    case 'tlsUntrusted':
      return t(
        'Conduit reached the server, but this computer doesn’t trust its TLS certificate. If you use your own certificate authority, install its root certificate in this computer’s trusted certificates, then try again.'
      )
    case 'tlsBadDate':
      return t('The dashboard certificate is expired or not yet valid. Check the certificate dates and this device’s date and time.')
    case 'tlsHostnameMismatch':
      return t(
        'Conduit reached the server, but its TLS certificate isn’t issued for this address. Connect with a name or IP address the certificate lists, or add this address to the certificate.'
      )
    case 'tlsFailure':
      return t('Conduit could not establish a secure connection to the dashboard. The server’s TLS certificate may be misconfigured.')
  }
}

/** `error` in the phone's words when it's a network or TLS failure, else null. */
export function describeConnectionFailure(error: unknown): string | null {
  const kind = connectionFailureKind(error)
  return kind ? connectionFailureMessage(kind) : null
}

/**
 * A 401 or 403 where no credentials were sent (the dashboard's status, read
 * before any sign-in): something in front of the dashboard, such as a
 * proxy's IP allowlist, refused this computer. Never bad credentials.
 */
export function accessDeniedMessage(): string {
  return t(
    'Conduit reached the server, but it refused this device. If a proxy, firewall or access list only lets in some networks, connect from one it allows, such as your VPN, Tailscale or home Wi-Fi.'
  )
}
