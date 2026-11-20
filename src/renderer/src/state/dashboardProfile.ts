/**
 * Routes the dashboard's own process must answer, after the phone's
 * conduitProfileParameter ("Voice on a profile the dashboard didn't start
 * with", #1336). Hermes 0.22.3+ sends a plugin request whose ?profile= names
 * another profile to that profile's plugin host, which carries no WebSockets
 * and none of the dashboard's state (its chats, Local Live's key and calls,
 * workstreams). Named as ?conduit_profile= instead, the request stays in the
 * dashboard and the plugin scopes it to that profile. The dashboard's own
 * profile goes with neither. Only a plugin that lists `dashboard-profiles`
 * reads ?conduit_profile=; an older one keeps ?profile=, so it acts for the
 * profile named rather than the dashboard's own (#1336).
 */

export const DASHBOARD_PROFILES_CAPABILITY = 'dashboard-profiles'

let host = ''
/** Whether this dashboard's plugin reads ?conduit_profile=; null until its capabilities answer. */
let served: boolean | null = null

/** The dashboard signed in to; another one's plugin is asked again. */
export function setDashboardProfilesHost(next: string): void {
  if (next === host) return
  host = next
  served = null
}

/** What `forHost`'s plugin listed, or null when the route isn't there (a plugin too old to say). */
export function noteDashboardProfiles(forHost: string, capabilities: string[] | null): void {
  if (forHost !== host) return
  served = capabilities ? capabilities.includes(DASHBOARD_PROFILES_CAPABILITY) : false
}

/** The query name for a profile the dashboard didn't start with. */
const parameter = () => (served === false ? 'profile' : 'conduit_profile')

export function dashboardProfilePath(path: string, profile?: string | null): string {
  if (!profile || profile === 'default') return path
  return `${path}${path.includes('?') ? '&' : '?'}${parameter()}=${encodeURIComponent(profile)}`
}

/** A socket's query for the same. */
export function dashboardProfileQuery(profile?: string | null): Record<string, string> {
  return profile && profile !== 'default' ? { [parameter()]: profile } : {}
}
