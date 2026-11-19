/**
 * A chat's apps directory card opens Capabilities > Connectors' Browse Apps
 * with Hermes' picks first, after the phone's. The card asks here; the app
 * opens Settings on it.
 */
export interface AppsRequest {
  suggested: string[]
  /** The chat's profile: the apps connect for it. */
  profile?: string
  /** Each ask is a new one, even for the same picks. */
  n: number
}

let count = 0
const listeners = new Set<(request: AppsRequest) => void>()

export function openAppsDirectory(suggested: string[], profile?: string) {
  const request = { suggested, profile, n: ++count }
  listeners.forEach(listener => listener(request))
}

export function onAppsDirectory(listener: (request: AppsRequest) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
