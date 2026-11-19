/**
 * Showing a voice call a picture, after the phone's Camera on the call
 * screen and Ask Hermes About Screen's screenshot: the picture waits on the
 * call's chat, so Hermes sees it with the call's next request, and Gemini
 * and Qwen Live are also sent it. GPT-Live, Grok Live and Local Live take no
 * images, so they hear that Hermes has it and must not guess what it shows.
 * The notes are the phone's (VoiceBackgroundJobs), a picture chosen here
 * worded as one.
 */
import type { StagedAttachment } from './attachments'

export type PictureKind = 'picture' | 'screenshot'

export interface CallPicture {
  /** New for each picture shown. */
  id: number
  kind: PictureKind
  /** What goes with the call's next request to Hermes. */
  attachment: StagedAttachment
  /** The model's copy (JPEG, base64), for the modes that see pictures. */
  frame: string | null
}

/** What a call hears about the picture waiting on its chat. */
export interface PictureNote {
  id: number
  kind: PictureKind
  /** shown: a new picture; removed: taken off before a request carried it. */
  change: 'shown' | 'removed'
  frame: string | null
}

export const SCREENSHOT_SHARED =
  "[Background only. The user just shared a screenshot to the chat this call is attached to. You can't see it, but Hermes can. When the user asks about their screen, send their question to the chat as they asked it, and the screenshot goes with it. Don't guess what the screen shows, and don't respond to this note now.]"
export const SCREENSHOT_SEEN =
  "[Background only. The user just shared a screenshot of their screen and showed it to you; it's also in the chat this call is attached to. Answer what they ask about it from what you see. When they want Hermes to work on it, send their request to the chat as they asked it, and the screenshot goes with it. Don't respond to this note now.]"
export const PICTURE_SHARED =
  "[Background only. The user just added a picture to the chat this call is attached to. You can't see it, but Hermes can. When the user asks about it, send their question to the chat as they asked it, and the picture goes with it. Don't guess what the picture shows, and don't respond to this note now.]"
export const PICTURE_SEEN =
  "[Background only. The user just showed you a picture; it's also in the chat this call is attached to. Answer what they ask about it from what you see. When they want Hermes to work on it, send their request to the chat as they asked it, and the picture goes with it. Don't respond to this note now.]"
export const SCREENSHOT_REMOVED =
  "[Background only. The user removed the screenshot they shared: the chat's next turn won't carry one. Don't respond to this note now.]"
export const PICTURE_REMOVED =
  "[Background only. The user removed the picture they shared: the chat's next turn won't carry it, and it's no longer there to talk about. Don't respond to this note now.]"

/** The note for a change, as the call hears it: `seen` when its model was sent the picture itself. */
export function pictureNoteText(note: PictureNote, seen: boolean): string {
  if (note.change === 'removed') return note.kind === 'screenshot' ? SCREENSHOT_REMOVED : PICTURE_REMOVED
  if (note.kind === 'screenshot') return seen ? SCREENSHOT_SEEN : SCREENSHOT_SHARED
  return seen ? PICTURE_SEEN : PICTURE_SHARED
}

/** Gemini Live's frame for a picture: a video frame, which interrupts no reply; the model sees it with the user's next words. */
export const imageFrame = (base64: string) => ({ realtimeInput: { video: { mimeType: 'image/jpeg', data: base64 } } })

/** A data URL as a blob, without fetch (the page's CSP refuses data: for it). */
export function dataUrlBlob(url: string): Blob {
  const [head = '', data = ''] = url.split(',', 2)
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream'
  const bytes = head.endsWith(';base64') ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(data))
  return new Blob([bytes], { type })
}
