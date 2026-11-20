/**
 * Voice rows nested under the row that started them, after the phone's
 * SessionNesting (#556): a call's background job under its call or the chat
 * it was kept with. Pure list shaping. A row nests only under a row in the
 * same list and profile, matched on its id or its lineage root; a row that
 * names itself, names no listed row, is pinned, or would close a cycle stays
 * at the top level, so a missing link leaves today's flat list. Children go
 * newest first. A search or a filter lists every row flat.
 */
import type { ChatRow } from './chats'
import { t } from '../../../shared/i18n'

const profileOf = (row: ChatRow) => (row.profile || 'default').toLowerCase()

export interface Nesting {
  /** A parent row's id: the rows nested directly under it, newest first. */
  children: Map<string, ChatRow[]>
  /** Every row drawn under another instead of on its own. */
  nested: Set<string>
}

export const EMPTY_NESTING: Nesting = { children: new Map(), nested: new Set() }

export function nestRows(rows: ChatRow[]): Nesting {
  if (!rows.some(r => r.nestUnder)) return EMPTY_NESTING
  // A row's own id beats another's lineage root that happens to match.
  const byKey = new Map<string, ChatRow>()
  for (const row of rows) if (row.lineageRoot && !byKey.has(`${profileOf(row)}\n${row.lineageRoot}`)) byKey.set(`${profileOf(row)}\n${row.lineageRoot}`, row)
  for (const row of rows) byKey.set(`${profileOf(row)}\n${row.id}`, row)
  const parentOf = new Map<string, ChatRow>()
  for (const row of rows) {
    if (!row.nestUnder || row.pinned) continue
    const parent = byKey.get(`${profileOf(row)}\n${row.nestUnder}`)
    if (parent && parent.id !== row.id) parentOf.set(row.id, parent)
  }
  // A cycle would hide its every member: the row where it closes stays on top.
  const done = new Set<string>()
  for (const row of rows) {
    const path = new Set<string>()
    let at: ChatRow | undefined = row
    while (at && !done.has(at.id)) {
      if (path.has(at.id)) {
        parentOf.delete(at.id)
        break
      }
      path.add(at.id)
      at = parentOf.get(at.id)
    }
    for (const id of path) done.add(id)
  }
  const children = new Map<string, ChatRow[]>()
  for (const row of rows) {
    const parent = parentOf.get(row.id)
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), row])
  }
  for (const list of children.values()) list.sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0))
  return { children, nested: new Set(parentOf.keys()) }
}

/** Every row under `row`, grandchildren included. */
export function descendants(nesting: Nesting, row: ChatRow): ChatRow[] {
  const below = nesting.children.get(row.id) ?? []
  return below.flatMap(child => [child, ...descendants(nesting, child)])
}

/** The parents to open so `id`'s row shows. */
export function ancestorsOf(nesting: Nesting, id: string | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!id || !nesting.nested.has(id)) return out
  const parentOf = new Map<string, string>()
  for (const [parent, list] of nesting.children) for (const child of list) parentOf.set(child.id, parent)
  let at = parentOf.get(id)
  while (at && !out.has(at)) {
    out.add(at)
    at = parentOf.get(at)
  }
  return out
}

/** The parent's line for what sits under it: "2 jobs · 1 running", in the phone's words. */
export function nestSummary(below: ChatRow[], running: (row: ChatRow) => boolean, waiting: (row: ChatRow) => boolean): string {
  const count = below.length
  const jobs = count > 0 && below.every(r => r.sourceKind === 'voice_job')
  const parts = [jobs ? (count === 1 ? t('1 job') : t('{count} jobs', { count })) : count === 1 ? t('1 session') : t('{count} sessions', { count })]
  const runs = below.filter(r => !waiting(r) && running(r)).length
  if (runs) parts.push(runs === 1 ? t('1 running') : t('{count} running', { count: runs }))
  const asks = below.filter(waiting).length
  if (asks) parts.push(asks === 1 ? t('1 to approve') : t('{count} to approve', { count: asks }))
  return parts.join(' · ')
}
