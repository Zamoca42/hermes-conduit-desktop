/**
 * A chat row's Pin, Rename and Delete, through the dashboard's
 * `/api/sessions/{id}` as the phone sends them: a PATCH (`pinned`, `title`)
 * or a DELETE, carrying the row's revision from its mutation snapshot so a
 * chat that moved on in between is refused rather than overwritten, with
 * one retry on a fresh snapshot.
 */
type Http = <T = unknown>(method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>

const UNRESERVED = /^[A-Za-z0-9\-._~]*$/

export function sessionPath(id: string, profile?: string, suffix = ''): string {
  const path = `/api/sessions/${encodeURIComponent(id)}${suffix}`
  return profile && profile !== 'default' ? `${path}?profile=${encodeURIComponent(profile)}` : path
}

/** The revision fields for a write, from a snapshot; null when the host gave none (older, or the read failed). */
export function identityFields(snapshot: unknown, requestId: string): Record<string, string | number> | null {
  const row = (snapshot ?? {}) as { runtime_revision?: unknown; runtime_generation?: unknown }
  const revision = row.runtime_revision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null
  const fields: Record<string, string | number> = { request_id: requestId, expected_revision: revision }
  const generation = row.runtime_generation
  if (typeof generation === 'number' && Number.isInteger(generation) && generation >= 0) fields.expected_generation = generation
  return fields
}

/** A DELETE carries the identity in its query. */
export function withQuery(path: string, fields: Record<string, string | number>): string {
  const query = Object.keys(fields)
    .sort()
    .map(key => [key, String(fields[key])] as const)
    .filter(([, value]) => UNRESERVED.test(value))
    .map(([key, value]) => `${key}=${value}`)
  return query.length ? `${path}${path.includes('?') ? '&' : '?'}${query.join('&')}` : path
}

/** A conflict worth one retry on a fresh snapshot: the chat moved on, or the write went without its identity. */
export function warrantsRetry(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  const text = error instanceof Error ? error.message : String(error)
  return (code === 409 || /\b409\b/.test(text)) && /revision_conflict|stale_generation|mutation_identity_required/i.test(text)
}

/** PATCHes `body` onto the chat, or deletes it when `body` is null. */
export async function mutateSession(http: Http, id: string, profile: string | undefined, body: Record<string, unknown> | null): Promise<void> {
  const attempt = async () => {
    let snapshot: unknown = null
    try {
      snapshot = await http('GET', sessionPath(id, profile, '/mutation-snapshot'))
    } catch {
      // A host without the snapshot, or a failed read: the bare write, which a refusal retries.
    }
    const identity = identityFields(snapshot, crypto.randomUUID().toLowerCase())
    if (body) {
      const sent: Record<string, unknown> = { ...body, ...(identity ?? {}) }
      if (profile && profile !== 'default') sent.profile = profile
      await http('PATCH', sessionPath(id, profile), sent)
    } else {
      const path = sessionPath(id, profile)
      await http('DELETE', identity ? withQuery(path, identity) : path)
    }
  }
  try {
    await attempt()
  } catch (e) {
    if (!warrantsRetry(e)) throw e
    await attempt()
  }
}
