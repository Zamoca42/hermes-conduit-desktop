/**
 * Filter › Projects, after the phone's (V2ChatsView projectsFilterMenu,
 * HiddenChatProjects): every project ticked to start, and the ones the
 * person unticks leave the Chats list. Home stands for the chats in no
 * project ("Not in a project" without a Home). Kept on this computer per
 * dashboard and profile, since two hosts' "default" aren't one profile.
 */
import type { Project } from './projects'

/** The chats in no project, Home's. */
export const NO_PROJECT = '__no_project__'
const KEY = 'conduit.hiddenChatProjects'

type Stored = Record<string, string[]>
const slot = (host: string, profile: string) => `${host}\t${profile.toLowerCase()}`

function readAll(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Stored) : {}
  } catch {
    return {}
  }
}

/** The projects hidden on a dashboard's profile, as kept. */
export function readHiddenProjects(host: string, profile: string): string[] {
  const ids = readAll()[slot(host, profile)]
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []
}

export function writeHiddenProjects(host: string, profile: string, ids: readonly string[]): void {
  try {
    const all = readAll()
    if (ids.length) all[slot(host, profile)] = [...ids]
    else delete all[slot(host, profile)]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Kept for this window only.
  }
}

/** The projects the menu lists: Home stands for the chats in no project, so it isn't one of them. */
export const filterProjects = (projects: readonly Project[] | null | undefined): Project[] => (projects ?? []).filter(p => !p.isHome)

/**
 * What's hidden now: only the projects listed count, so a deleted project's
 * leftover id hides nothing, and until the projects load (or with Home alone,
 * where the menu isn't offered) nothing is hidden, since every chat would
 * read as one in no project.
 */
export function hiddenNow(kept: readonly string[], projects: readonly Project[] | null | undefined): Set<string> {
  const listed = filterProjects(projects)
  if (!listed.length || !kept.length) return new Set()
  const ids = new Set([NO_PROJECT, ...listed.map(p => p.id)])
  return new Set(kept.filter(id => ids.has(id)))
}

/** Each chat the project tree previews, to its project: the first listed project holding it (the phone's knownProjectID). */
export function projectIndex(projects: readonly Project[] | null | undefined): Map<string, string> {
  const index = new Map<string, string>()
  for (const project of filterProjects(projects)) for (const chat of project.previews) if (!index.has(chat.id)) index.set(chat.id, project.id)
  return index
}

/** A chat's project, by any id it answers to; none is Home's. */
export function projectOf(index: ReadonlyMap<string, string>, row: { id: string; lineageRoot?: string }): string {
  return index.get(row.id) ?? (row.lineageRoot ? index.get(row.lineageRoot) : undefined) ?? NO_PROJECT
}

/**
 * Whether a chat leaves the list: a pinned chat stays, and so does a wait
 * while Needs approval is chosen, since that lists every wait the amber dot counts.
 */
export function hidesChat(project: string, pinned: boolean, listedWait: boolean, hidden: ReadonlySet<string>): boolean {
  return !pinned && !listedWait && hidden.has(project)
}
