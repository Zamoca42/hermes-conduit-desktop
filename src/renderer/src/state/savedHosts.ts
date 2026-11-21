/**
 * The dashboards saved on this computer, as App last heard: a read that lands
 * after a dashboard was removed keeps nothing for it, so re-adding the same
 * address never draws what the removed one held. Null until App says.
 */
let saved: ReadonlySet<string> | null = null

export function setSavedHosts(hosts: readonly string[]): void {
  saved = new Set(hosts)
}

/** Whether what's read for `host` may be kept for a switch to draw. */
export const keepsFor = (host: string): boolean => saved === null || saved.has(host)
