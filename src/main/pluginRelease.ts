import { net } from 'electron'
import type { PluginRelease } from '../shared/ipc'

/**
 * The Conduit plugin's newest version (plugin.yaml) and its CHANGELOG.md, from
 * main of hermes-conduit-notifier, as the phone reads them
 * (NotifierPluginLatestVersion). Read at most hourly; a failed read keeps the
 * last answer.
 */
const MAIN = 'https://raw.githubusercontent.com/kaishi00/hermes-conduit-notifier/main/'
const FRESH_MS = 60 * 60 * 1000

let cached: { at: number; release: PluginRelease } | null = null
let pending: Promise<PluginRelease> | null = null

async function text(name: string): Promise<string | null> {
  try {
    const response = await net.fetch(MAIN + name, { cache: 'no-store' })
    return response.ok ? await response.text() : null
  } catch {
    return null
  }
}

/** `version: 0.177.39` from plugin.yaml. */
export function versionFromManifest(yaml: string | null): string | null {
  const match = yaml?.match(/^version:\s*["']?([0-9][0-9A-Za-z.\-+]*)["']?\s*$/m)
  return match ? match[1] : null
}

export function pluginRelease(): Promise<PluginRelease> {
  if (cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.release)
  pending ??= (async () => {
    const [manifest, changelog] = await Promise.all([text('plugin.yaml'), text('CHANGELOG.md')])
    const release = { version: versionFromManifest(manifest) ?? cached?.release.version ?? null, changelog: changelog ?? cached?.release.changelog ?? null }
    if (release.version) cached = { at: Date.now(), release }
    return release
  })().finally(() => {
    pending = null
  })
  return pending
}
