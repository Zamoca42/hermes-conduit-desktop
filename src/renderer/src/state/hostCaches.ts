import { keptRosters } from './bots'
import { keptOwnRooms } from './useGroups'
import { keptCopies } from './useRoomCopies'
import { keptCapabilities, keptInvites } from './useRoomInvites'
import { keptRoomsByHost } from './keptHosts'
import { forgetAvatarHosts } from './useBots'
import { forgetTranscriptHosts } from './transcriptCache'

/** What each dashboard's window last read, kept for a switch to draw at once: a dashboard no longer saved takes its own with it. */
export function forgetHostCaches(hosts: readonly string[]): void {
  for (const map of [keptRosters, keptOwnRooms, keptCopies, keptCapabilities, keptInvites, keptRoomsByHost] as Map<string, unknown>[]) {
    for (const host of [...map.keys()]) if (!hosts.includes(host)) map.delete(host)
  }
  forgetAvatarHosts(hosts)
  forgetTranscriptHosts(hosts)
}
