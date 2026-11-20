/**
 * Hermes' own markers for "nothing to send" (gateway/response_filters.py,
 * `LIVE_GATEWAY_SILENT_MARKERS`), after the phone's SilenceMarkers: a reply
 * that is only a marker shows nothing, on every surface, and a marker that
 * closes a real reply on its own line is left off (issue 2700).
 */
const MARKERS = new Set(['[SILENT]', 'SILENT', 'NO_REPLY', 'NO REPLY', '[静默]', '静默', '[沉默]', '沉默'])
/** Longer than any marker could be, even with stray punctuation. */
const LENGTH_CAP = 64

/** Square brackets stay, so a malformed `[SILENT` can't become `SILENT`. */
const edge = /^[^\p{L}\p{N}\s[\]]+|[^\p{L}\p{N}\s[\]]+$/gu
const canonical = (text: string) => text.toUpperCase().split(/\s+/).filter(Boolean).join(' ')

function candidates(text: string): string[] {
  const stripped = text.trim()
  const length = [...stripped].length
  if (!length || length > LENGTH_CAP) return []
  const bare = stripped.replace(edge, '').trim()
  return (bare === stripped ? [stripped] : [stripped, bare]).map(canonical)
}

/** Whether `text` is exactly a silence marker (`is_intentional_silence_response`). */
export function isSilenceMarker(text: string): boolean {
  return candidates(text).some(c => MARKERS.has(c))
}

/** Whether streamed `text` could still become a marker; stray punctuation alone is held too, as a marker could follow it. */
export function couldBecomeMarker(text: string): boolean {
  const stripped = text.trim()
  if (stripped && [...stripped].length <= LENGTH_CAP && !stripped.replace(edge, '').trim()) return true
  return candidates(text).some(c => !!c && [...MARKERS].some(m => m.startsWith(c)))
}

/** `(head, last line)`, trailing blank space ignored; head is '' for one line. */
function splitLastLine(text: string): [string, string] {
  const trimmed = text.replace(/\s+$/, '')
  const newline = trimmed.lastIndexOf('\n')
  return newline < 0 ? ['', trimmed] : [trimmed.slice(0, newline).replace(/\s+$/, ''), trimmed.slice(newline + 1)]
}

/** What a finished reply shows: nothing for a bare marker, else the reply without a closing one. */
export function silenceShown(text: string): string {
  if (isSilenceMarker(text)) return ''
  const [head, tail] = splitLastLine(text)
  return head.trim() && isSilenceMarker(tail) ? head : text
}

/** What a reply still streaming shows: held back while it, or its last line after real words, could still become a marker. */
export function streamShown(text: string): string {
  if (couldBecomeMarker(text)) return ''
  const [head, tail] = splitLastLine(text)
  return head.trim() && couldBecomeMarker(tail) ? head : text
}
