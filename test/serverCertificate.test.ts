import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { createServer, type Server } from 'node:tls'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pemFromDer, readServerCertificate } from '../src/main/serverCertificate'

/** Test certificates made here with openssl, so no key is kept in the repository. */
function makeCertificates(dir: string) {
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' })
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes']
  ssl('req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=Test Root')
  ssl('req', ...ec, '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1')
  writeFileSync(join(dir, 'ext'), 'subjectAltName=IP:127.0.0.1')
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.crt', '-days', '2', '-extfile', 'ext')
  ssl('req', '-x509', ...ec, '-keyout', 'self.key', '-out', 'self.crt', '-days', '2', '-subj', '/CN=Self Signed')
  const read = (name: string) => readFileSync(join(dir, name), 'utf8')
  return { ca: read('ca.crt'), leaf: read('leaf.crt'), leafKey: read('leaf.key'), self: read('self.crt'), selfKey: read('self.key') }
}

let hasOpenssl = true
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' })
} catch {
  hasOpenssl = false
}

describe.skipIf(!hasOpenssl)('Install this server’s certificate', () => {
  let dir = ''
  let certs: ReturnType<typeof makeCertificates>
  const servers: Server[] = []
  const serve = async (cert: string, key: string): Promise<string> => {
    const server = createServer({ cert, key }, socket => socket.end())
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return `https://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'conduit-cert-'))
    certs = makeCertificates(dir)
  })
  afterAll(() => {
    for (const server of servers) server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a self-signed certificate as its own root', async () => {
    const url = await serve(certs.self, certs.selfKey)
    const check = await readServerCertificate(url)
    expect(check).toMatchObject({ ok: true, name: 'Self Signed', fingerprint: new X509Certificate(certs.self).fingerprint256 })
    if (check.ok) expect(new X509Certificate(check.pem).fingerprint256).toBe(new X509Certificate(certs.self).fingerprint256)
  })

  it('reads the root a server sends after its own certificate', async () => {
    const url = await serve(certs.leaf + certs.ca, certs.leafKey)
    expect(await readServerCertificate(url)).toMatchObject({ ok: true, name: 'Test Root', fingerprint: new X509Certificate(certs.ca).fingerprint256 })
  })

  it('says so when the server sends no root', async () => {
    const url = await serve(certs.leaf, certs.leafKey)
    expect(await readServerCertificate(url)).toEqual({ ok: false, reason: 'noRoot' })
  })

  it('reads only https addresses, and says when the server is out of reach', async () => {
    expect(await readServerCertificate('http://127.0.0.1:9')).toEqual({ ok: false, reason: 'notHttps' })
    expect(await readServerCertificate('https://127.0.0.1:9')).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('writes PEM in 64-character lines', () => {
    const pem = pemFromDer(Buffer.alloc(100, 1))
    expect(pem.startsWith('-----BEGIN CERTIFICATE-----\n')).toBe(true)
    expect(pem.split('\n').slice(1, -2).every(line => line.length <= 64)).toBe(true)
  })
})
