/**
 * Hermes' `MEDIA:<path>` delivery tags in a reply, after the phone's
 * GatewayMediaTags: a tag alone on its line (any path), a Markdown image or
 * link around one, or a tag mid-sentence whose path ends in a known
 * extension. Each becomes a file card; the words around it stay Markdown.
 * Tags inside code or a blockquote are examples, not files.
 */

export type ReplyBlock = { kind: 'markdown'; text: string } | { kind: 'media'; path: string; alt?: string }

export const KNOWN_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'svg',
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp',
  'mp3', 'm2a', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'caf', 'aiff', 'aif',
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'epub',
  'xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml',
  'kmz', 'kml', 'geojson', 'gpx',
  'pptx', 'ppt', 'odp', 'key', 'pages', 'numbers',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'apk', 'ipa',
  'html', 'htm'
]

const DIRECTIVES = ['[[audio_as_voice]]', '[[as_document]]']

const ROOT = String.raw`(?:~\/|\/|[A-Za-z]:[\\/])`
const EXT = [...KNOWN_EXTENSIONS].sort((a, b) => b.length - a.length).join('|')

const WHOLE_LINE = new RegExp(String.raw`^[\x60"'*_]{0,3}MEDIA:[^\S\n]*[\x60"']?(${ROOT}.*?)[\x60"']?[\x60"'*_]{0,3}\.?$`, 'i')
const MARKDOWN_LINK = new RegExp(String.raw`^!?\[([^\]]*)\]\([^\S\n]*MEDIA:[^\S\n]*[\x60"']?(${ROOT}[^)]*?)[\x60"']?[^\S\n]*\)$`, 'i')
const MID_LINE = new RegExp(
  String.raw`(?:!?\[([^\]]*)\]\()?[\x60"'*_]{0,3}MEDIA:[^\S\n]*[\x60"']?(${ROOT}\S+?\.(?:${EXT}))[\x60"']?(?=[\s\x60"'*_,;:)\]}]|$|\.(?:\s|$))[\x60"'*_]{0,3}\)?`,
  'gi'
)

export type MediaKind = 'image' | 'audio' | 'video' | 'file'

export function mediaKind(path: string): MediaKind {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'm2a', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'caf', 'aiff', 'aif'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'].includes(ext)) return 'video'
  return 'file'
}

/** Splits a reply into Markdown runs and the files it delivers. */
export function splitReply(text: string): ReplyBlock[] {
  if (!/MEDIA:/i.test(text) && !DIRECTIVES.some(d => text.includes(d))) return [{ kind: 'markdown', text }]
  const blocks: ReplyBlock[] = []
  let run: string[] = []
  const flush = () => {
    const joined = run.join('\n')
    if (joined.trim()) blocks.push({ kind: 'markdown', text: joined })
    run = []
  }
  let fence: string | null = null
  for (const rawLine of text.split('\n')) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(rawLine)
    if (fence) {
      run.push(rawLine)
      if (fenceMatch && fenceMatch[1]!.startsWith(fence)) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]!
      run.push(rawLine)
      continue
    }
    let line = rawLine
    const hadDirective = DIRECTIVES.some(d => line.includes(d))
    for (const directive of DIRECTIVES) line = line.split(directive).join('')
    const trimmed = line.trim()
    if (hadDirective && !trimmed) continue
    if (!/MEDIA:/i.test(trimmed) || trimmed.startsWith('>')) {
      run.push(hadDirective ? line : rawLine)
      continue
    }
    const link = MARKDOWN_LINK.exec(trimmed)
    if (link) {
      flush()
      blocks.push({ kind: 'media', path: link[2]!.trim(), alt: link[1]?.trim() || undefined })
      continue
    }
    const mid = [...trimmed.matchAll(MID_LINE)].filter(m => !insideCode(trimmed, m.index ?? 0))
    if (mid.length) {
      const files: ReplyBlock[] = []
      let rest = ''
      let cursor = 0
      for (const match of mid) {
        rest += trimmed.slice(cursor, match.index)
        cursor = (match.index ?? 0) + match[0].length
        files.push({ kind: 'media', path: match[2]!, alt: match[1]?.trim() || undefined })
      }
      rest += trimmed.slice(cursor)
      if (rest.trim()) run.push(rest.replace(/[^\S\n]{2,}/g, ' ').trimEnd())
      flush()
      blocks.push(...files)
      continue
    }
    const whole = WHOLE_LINE.exec(trimmed)
    if (whole) {
      flush()
      blocks.push({ kind: 'media', path: whole[1]!.trim() })
      continue
    }
    run.push(rawLine)
  }
  flush()
  return blocks
}

/** Whether the `MEDIA:` keyword of a match starting at `index` sits inside a `code span`. */
function insideCode(line: string, index: number): boolean {
  const keyword = line.toUpperCase().indexOf('MEDIA:', index)
  let ticks = 0
  for (let i = 0; i < keyword; i++) if (line[i] === '`') ticks++
  return ticks % 2 === 1 && line.indexOf('`', keyword) >= 0
}
