/**
 * Routes the dashboard's own process must answer, after the phone's
 * conduitProfileParameter ("Voice on a profile the dashboard didn't start
 * with", #1336). Hermes 0.22.3+ sends a plugin request whose ?profile= names
 * another profile to that profile's plugin host, which carries no WebSockets
 * and none of the dashboard's state (its chats, Local Live's key and calls,
 * workstreams). Named as ?conduit_profile= instead, the request stays in the
 * dashboard and the plugin scopes it to that profile. The dashboard's own
 * profile goes with neither.
 */

export function dashboardProfilePath(path: string, profile?: string | null): string {
  if (!profile || profile === 'default') return path
  return `${path}${path.includes('?') ? '&' : '?'}conduit_profile=${encodeURIComponent(profile)}`
}

/** A socket's query for the same. */
export function dashboardProfileQuery(profile?: string | null): Record<string, string> {
  return profile && profile !== 'default' ? { conduit_profile: profile } : {}
}
