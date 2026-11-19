/**
 * Trust the computer's own certificate store as well as Node's bundled
 * roots, so a root certificate installed on this computer (your own
 * certificate authority, or a self-signed dashboard's) covers the
 * dashboard's REST calls and sockets, as installing one on the phone does
 * (the phone's ruling: getting a root onto the device is the supported
 * way). Nothing is overridden: every certificate is still checked.
 */
import tls from 'node:tls'

type CaTls = typeof tls & {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[]
  setDefaultCACertificates?: (certs: string[]) => void
}

/** Adds the system store's roots to Node's defaults; false when this Node can't, or the store can't be read. */
export function trustSystemRoots(api: CaTls = tls as CaTls): boolean {
  if (!api.getCACertificates || !api.setDefaultCACertificates) return false
  try {
    const system = api.getCACertificates('system')
    if (!system.length) return false
    const roots = [...new Set([...api.getCACertificates('default'), ...system])]
    api.setDefaultCACertificates(roots)
    return true
  } catch {
    return false
  }
}
