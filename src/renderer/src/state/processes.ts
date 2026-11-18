/**
 * The processes Hermes started in the background for a chat (a dev server,
 * a watcher, a long build): `process.list` rows, shown with the delegate
 * agents as the phone's Agents sheet does, each with Stop (`process.kill`).
 */
type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export interface BackgroundProcess {
  /** Hermes' process id (the row's `session_id`), what `process.kill` takes. */
  id: string
  command: string
  cwd?: string
  pid?: number
  /** running, or exited. */
  status: string
  uptimeS?: number
  /** The newest output, at most four lines. */
  output: string
}

export const isRunningProcess = (p: BackgroundProcess) => p.status !== 'exited'

export function lastLines(text: string, count: number): string {
  return text
    .split(/\r?\n|\r/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join('\n')
}

/** `process.list`'s answer; null when it isn't one, so the list stays as it was. */
export function parseProcesses(raw: unknown): BackgroundProcess[] | null {
  const rows = (raw && typeof raw === 'object' ? (raw as Row).processes : undefined) as unknown
  if (!Array.isArray(rows)) return null
  const out: BackgroundProcess[] = []
  for (const r of rows) {
    const row = r && typeof r === 'object' ? (r as Row) : null
    const id = str(row?.session_id)
    if (!row || !id) continue
    out.push({
      id,
      command: str(row.command),
      cwd: str(row.cwd) || undefined,
      pid: num(row.pid),
      status: str(row.status) || 'running',
      uptimeS: num(row.uptime_seconds),
      output: lastLines(typeof row.output_tail === 'string' ? row.output_tail : typeof row.output_preview === 'string' ? row.output_preview : '', 4)
    })
  }
  return out
}

/** `process.kill`'s answer: nothing when it went, else Hermes' reason. */
export function killFailure(raw: unknown): string | null {
  const row = raw && typeof raw === 'object' ? (raw as Row) : null
  const status = str(row?.status)
  if (!status || status === 'killed' || status === 'already_exited' || status === 'not_found') return null
  return str(row?.error) || status
}
