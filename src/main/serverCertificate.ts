/**
 * Install this server's certificate, after the phone's
 * ServerCertificateSection: for a dashboard this computer doesn't trust
 * (its own certificate authority, or a self-signed certificate), reads the
 * root certificate the server sends, shows its SHA-256 fingerprint to check
 * against the server's, and saves it to a file the person installs and
 * trusts in Keychain Access or Windows' certificate store. Conduit itself
 * never trusts it: the connection stays refused until the computer does.
 */
import { connect, type PeerCertificate, type DetailedPeerCertificate } from 'node:tls'
import { isIP } from 'node:net'

export type CertificateCheck =
  | { ok: true; fingerprint: string; name: string; pem: string }
  | { ok: false; reason: 'noRoot' | 'unreachable' | 'notHttps'; error?: string }

const TIMEOUT_MS = 10_000

/** DER bytes as a PEM certificate. */
export function pemFromDer(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? []
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}

const selfIssued = (cert: DetailedPeerCertificate) =>
  cert.issuerCertificate === cert || (!!cert.issuerCertificate && cert.issuerCertificate.fingerprint256 === cert.fingerprint256)

/** The chain's root, when the server sends one: the last certificate, issued by itself. */
export function chainRoot(leaf: DetailedPeerCertificate): DetailedPeerCertificate | null {
  let cert = leaf
  for (let depth = 0; depth < 10; depth++) {
    if (selfIssued(cert)) return cert
    const next = cert.issuerCertificate
    if (!next || !next.raw || next.fingerprint256 === cert.fingerprint256) return null
    cert = next
  }
  return null
}

const commonName = (cert: PeerCertificate): string => {
  const cn = (cert.subject as unknown as Record<string, unknown> | undefined)?.CN
  return Array.isArray(cn) ? String(cn[0] ?? '') : typeof cn === 'string' ? cn : ''
}

/** Reads the root certificate `url`'s server sends, without trusting it for anything. */
export function readServerCertificate(url: string): Promise<CertificateCheck> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return Promise.resolve({ ok: false, reason: 'notHttps' })
  }
  if (target.protocol !== 'https:') return Promise.resolve({ ok: false, reason: 'notHttps' })
  const host = target.hostname.replace(/^\[|\]$/g, '')
  const port = Number(target.port || 443)
  return new Promise(resolve => {
    let done = false
    const finish = (result: CertificateCheck) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(result)
    }
    // Only read: nothing is sent over this connection, and it's closed at once.
    const socket = connect({ host, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false }, () => {
      const leaf = socket.getPeerCertificate(true)
      if (!leaf || !leaf.raw) return finish({ ok: false, reason: 'unreachable' })
      const root = chainRoot(leaf)
      if (!root) return finish({ ok: false, reason: 'noRoot' })
      finish({ ok: true, fingerprint: root.fingerprint256, name: commonName(root) || host, pem: pemFromDer(root.raw) })
    })
    socket.setTimeout(TIMEOUT_MS, () => finish({ ok: false, reason: 'unreachable' }))
    socket.on('error', error => finish({ ok: false, reason: 'unreachable', error: error.message }))
  })
}
