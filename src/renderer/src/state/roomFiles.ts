/**
 * Files in a group room through the Conduit plugin (the phone's
 * GroupRoomFiles.swift). Hermes' own room attachments can't go into a room
 * with other people's agents: its peer route carries no files. There the
 * plugin stores each file (`POST /room-files`) and hands back the `@file:`
 * line that goes above the message, and Linked Rooms carry it to the other
 * people's hosts, up to 16 MB a file. A stored file reads back as a data URL
 * (`GET /room-files/data-url`), from your own host's copy for a room someone
 * else hosts (room-files-linked).
 */

import { t } from '../../../shared/i18n'
import { displayName, formatReferenceValue, type StagedAttachment } from './attachments'
import { baseName } from './text'

export const ROOM_FILES_CAPABILITY = 'room-files'
export const ROOM_FILE_READS_CAPABILITY = 'room-file-reads'
export const ROOM_FILE_PICTURES_CAPABILITY = 'room-file-pictures'
export const ROOM_FILES_LINKED_CAPABILITY = 'room-files-linked'
export const ROOM_FILES_PATH = '/api/plugins/conduit_push/room-files'
export const ROOM_FILE_READ_PATH = '/api/plugins/conduit_push/room-files/data-url'
/** The largest file Linked Rooms carry to the other people's hosts (room_files_link.MAX_FILE_BYTES). */
export const LINKED_MAX_MEGABYTES = 16
export const LINKED_MAX_BYTES = LINKED_MAX_MEGABYTES * 1024 * 1024
/** Base64 of a file near the cap takes a while to send. */
const MIN_TIMEOUT_MS = 180_000

type Post = (path: string, body: Record<string, unknown>, timeoutMs: number) => Promise<unknown>

/** Why these files can't go into a room with other people's agents, or null. */
export function linkedRoomFilesProblem(attachments: StagedAttachment[]): string | null {
  const over = attachments.filter(a => a.size > LINKED_MAX_BYTES).map(a => displayName(a.name))
  if (!over.length) return null
  if (over.length === 1) return t("{name} is larger than the {limit} MB a room with other people's agents can share with them.", { name: over[0]!, limit: LINKED_MAX_MEGABYTES })
  return t("These files are larger than the {limit} MB a room with other people's agents can share with them: {names}.", {
    limit: LINKED_MAX_MEGABYTES,
    names: over.join(', ')
  })
}

/** The host's `ref_text`, else one built from the stored path; null for an answer that isn't one. */
export function storedReference(response: unknown): string | null {
  const row = response && typeof response === 'object' ? (response as Record<string, unknown>) : null
  if (row?.ok !== true) return null
  const ref = typeof row.ref_text === 'string' ? row.ref_text.trim() : ''
  if (ref.startsWith('@file:') && ref.length > '@file:'.length) return ref
  const path = typeof row.path === 'string' ? row.path.trim() : ''
  return path ? `@file:${formatReferenceValue(path)}` : null
}

/** Stores each file with the plugin, in order, and gives the text the room gets: their lines, a blank line, then what was typed. */
export async function roomFilesText(post: Post, text: string, attachments: StagedAttachment[]): Promise<string> {
  const problem = linkedRoomFilesProblem(attachments)
  if (problem) throw new Error(problem)
  const lines: string[] = []
  for (const a of attachments) {
    if (!a.base64) throw new Error(t('Could not prepare {name} for upload.', { name: a.name }))
    const timeout = Math.max(MIN_TIMEOUT_MS, Math.round(a.base64.length / 64))
    const ref = storedReference(await post(ROOM_FILES_PATH, { name: a.name, data_base64: a.base64 }, timeout))
    if (!ref) throw new Error(t("The host's answer couldn't be read. Update the Conduit plugin and try again."))
    lines.push(ref)
  }
  return text ? `${lines.join('\n')}\n\n${text}` : lines.join('\n')
}

const STORED = /[/\\]conduit[/\\]room-files[/\\][^/\\]+[/\\][^/\\]+$/
const PICTURE = /\.(png|jpe?g|gif|webp|heic|heif|avif)$/i

/** A file `/room-files` stored, the only kind its route reads back. */
export const isStoredRoomFile = (path: string) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? STORED.test(path) : false

/** A room message's `@file:` line as a file to show: a picture by its name. */
export function referencedFile(path: string): { kind: string; name: string; path: string } {
  return { kind: PICTURE.test(path) ? 'image' : 'file', name: baseName(path), path }
}

/** A stored room file's picture as a data URL, or null when it's gone or isn't one. */
export function pictureFromRead(response: unknown): string | null {
  const url = (response as { dataUrl?: unknown } | null)?.dataUrl
  return typeof url === 'string' && /^data:image\/(png|jpeg|gif|webp|heic|avif);base64,/.test(url) ? url : null
}
