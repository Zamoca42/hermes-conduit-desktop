/**
 * What Hermes stores around a person's words, taken off before the window
 * shows them, the way the phone does (HermesClient's `removingContextFooter`,
 * `splitLeadingFileReferences`, and the voice background-job brief).
 */

/** The brief a Conduit voice conversation puts before a background job's instructions. */
// A list preview can end inside it, before its closing bracket.
const VOICE_JOB_PREFIX = /^\s*\[Background job started from a Conduit voice conversation\.(?:[^\]]*\]\s*|[^\]]*$)/

/** Where a voice conversation's delegation appends the recent conversation, for context (GPTLive's `delegationContextMarker`). */
const VOICE_CONTEXT = /\s*\[Recent voice conversation, for context only\b[\s\S]*$/

/** An `@kind:value` context reference, as Hermes expands them. */
const CONTEXT_REFERENCE = /(?<![\w/])@(?:diff\b|staged\b|[A-Za-z][A-Za-z0-9_-]*:\S)/

/** Where Hermes appends the expanded references to the message it stores. */
const CONTEXT_FOOTER = /(?:^|\n)--- (?:Context Warnings|Attached Context) ---[ \t]*(?:\r?\n|$)/

/** A leading attachment line: `@file:path`, with the path bare, backticked or quoted. */
const LEADING_REFERENCE = /^@(file|url|folder|image):(?:`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s`"']\S*))$/

export interface Attachment {
  kind: 'file' | 'url' | 'folder' | 'image'
  value: string
}

export function removeVoiceJobPrefix(text: string): string {
  return text.replace(VOICE_JOB_PREFIX, '').replace(VOICE_CONTEXT, '')
}

/** A reference inside the words: the quoted value, or one cut off at the end of a preview. */
const INLINE_REFERENCE = /(?<![\w/])@(file|url|folder|image):(?:`([^`\n]*)(?:`|$)|"([^"\n]*)(?:"|$)|'([^'\n]*)(?:'|$)|([^\s`"']+))/g

/** `@url:\`https://x\`` in a sentence reads as `https://x` (or, `short`, as `x` and a file's name). */
export function plainReferences(text: string, short = false): string {
  return text.replace(INLINE_REFERENCE, (_all, kind: string, a?: string, b?: string, c?: string, d?: string) => {
    const value = (a ?? b ?? c ?? d ?? '').trim()
    if (!short) return value
    return kind === 'url' ? value.replace(/^https?:\/\/(www\.)?/, '') : baseName(value)
  })
}

/** Cuts the expanded context Hermes stores after a message that named `@file:` and the like. */
export function removeContextFooter(text: string): string {
  if (!CONTEXT_REFERENCE.test(text)) return text
  const match = CONTEXT_FOOTER.exec(text)
  return match ? text.slice(0, match.index).trimEnd() : text
}

/** The attachment lines a message starts with, and the words after them. */
export function splitLeadingReferences(text: string): { attachments: Attachment[]; text: string } {
  const lines = text.split(/\r?\n/)
  const attachments: Attachment[] = []
  let index = 0
  for (; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line) {
      if (attachments.length) continue
      break
    }
    const match = LEADING_REFERENCE.exec(line)
    if (!match) break
    const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    attachments.push({ kind: match[1] as Attachment['kind'], value })
  }
  if (!attachments.length) return { attachments, text }
  return { attachments, text: lines.slice(index).join('\n').trim() }
}

/** A person's message as the transcript shows it: their words, with its attachments apart. */
export function cleanUserText(raw: string): { text: string; attachments: Attachment[] } {
  const { attachments, text } = stripStored(raw)
  return { text: plainReferences(text).trim(), attachments }
}

/** What Hermes stored around the words, taken off; references inside the words are left as written. */
function stripStored(raw: string): { text: string; attachments: Attachment[] } {
  const withoutFooter = removeContextFooter(removeVoiceJobPrefix(raw))
  const { attachments, text } = splitLeadingReferences(withoutFooter.trim())
  return { text: text.trim(), attachments }
}

/** The last path component, for a chip or card. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

/** The same references at the start of a preview the dashboard already folded onto one line. */
const FOLDED_REFERENCE = /^@(file|url|folder|image):(?:`([^`\r\n]*)(?:`|$)|"([^"\r\n]*)(?:"|$)|'([^'\r\n]*)(?:'|$)|([^\s`"']+))(?:\s+|$)/

/** One line for the chat list: the words, else the first attachment's name. */
export function previewText(raw: string): string {
  const cleaned = stripStored(raw)
  const attachments = [...cleaned.attachments]
  let text = cleaned.text
  for (let match = FOLDED_REFERENCE.exec(text); match; match = FOLDED_REFERENCE.exec(text)) {
    attachments.push({ kind: match[1] as Attachment['kind'], value: match[2] ?? match[3] ?? match[4] ?? match[5] ?? '' })
    text = text.slice(match[0].length)
  }
  // A folded preview has the stored context on the same line as the words.
  // It can be cut off anywhere, even inside the marker.
  if (attachments.length || CONTEXT_REFERENCE.test(raw)) text = text.replace(/\s*---(?:\s[\s\S]*)?$/, '')
  const words = plainReferences(text, true).replace(/\s+/g, ' ').trim()
  if (words) return words
  const first = attachments[0]
  return first ? (first.kind === 'url' ? first.value.replace(/^https?:\/\/(www\.)?/, '') : baseName(first.value)) : ''
}

/** A title Hermes made from a voice delegation's first message, without the conversation it carried (cut off anywhere). */
export function cleanTitle(title: string): string {
  return title.replace(/\s*\[Recent voice conv[\s\S]*$/i, '').replace(VOICE_JOB_PREFIX, '').trim()
}
