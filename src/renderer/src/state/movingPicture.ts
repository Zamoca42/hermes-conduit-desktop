/**
 * A moving picture for a bot, after the phone's AnimatedAvatar: a GIF, an
 * animated WebP or PNG, or a short video becomes a looping animated PNG from
 * its first 3 seconds, at most 36 frames, 256 px, then smaller and fewer
 * frames until it fits 1.5 MB (Hermes' cap is 2 MB, and every fetch sends it
 * whole). A still gives null, for the photo path.
 */
import { encodeApng, isAnimatedPng } from './apng'

export const MAX_BYTES = 1_500_000
export const MAX_SECONDS = 3
export const MAX_FRAMES = 36
export const VIDEO_FPS = 10
/** The phone's: a smaller face before fewer frames, so it stays smooth. */
export const ATTEMPTS: readonly { edge: number; frames: number }[] = [
  { edge: 256, frames: MAX_FRAMES },
  { edge: 192, frames: MAX_FRAMES },
  { edge: 160, frames: MAX_FRAMES },
  { edge: 192, frames: MAX_FRAMES / 2 },
  { edge: 160, frames: MAX_FRAMES / 2 },
  { edge: 128, frames: MAX_FRAMES / 2 }
]

export class TooLargeError extends Error {}

/** A source frame and how long it shows, in ms. */
interface Frame {
  image: CanvasImageSource & { width?: number; height?: number }
  width: number
  height: number
  ms: number
}

/** `count` of `frames` picked evenly, each showing for its share of the whole. */
export function thinned<T extends { ms: number }>(frames: readonly T[], count: number): { frames: T[]; delay: number } {
  const total = frames.reduce((n, f) => n + f.ms, 0)
  if (frames.length <= count) return { frames: [...frames], delay: total / Math.max(1, frames.length) }
  const picked: T[] = []
  for (let i = 0; i < count; i++) {
    // The frame showing at this point of the loop.
    const at = (i * total) / count
    let elapsed = 0
    let chosen = frames[frames.length - 1]!
    for (const frame of frames) {
      if (at < elapsed + frame.ms) {
        chosen = frame
        break
      }
      elapsed += frame.ms
    }
    picked.push(chosen)
  }
  return { frames: picked, delay: total / count }
}

const isVideo = (file: Blob) => file.type.startsWith('video/')

/** Whether the picked file could move: a video, or a picture of a kind that animates. */
export const mayMove = (file: Blob) => isVideo(file) || ['image/gif', 'image/webp', 'image/png', 'image/apng'].includes(file.type)

async function videoFrames(file: Blob): Promise<Frame[]> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('unreadable video'))
    })
    const span = Math.min(MAX_SECONDS, Number.isFinite(video.duration) ? video.duration : MAX_SECONDS)
    const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(span * VIDEO_FPS)))
    const frames: Frame[] = []
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve()
        video.onerror = () => reject(new Error('unreadable video'))
        video.currentTime = (i * span) / count
      })
      frames.push({ image: await createImageBitmap(video), width: video.videoWidth, height: video.videoHeight, ms: (span * 1000) / count })
    }
    return frames
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/** An animated picture's frames up to 3 s, through the browser's decoder; one frame for a still. */
async function pictureFrames(file: Blob): Promise<Frame[]> {
  const Decoder = (globalThis as { ImageDecoder?: new (init: { data: ReadableStream; type: string }) => ImageDecoderLike }).ImageDecoder
  if (!Decoder) return []
  const decoder = new Decoder({ data: file.stream(), type: file.type || 'image/gif' })
  try {
    await decoder.tracks.ready
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1
    const frames: Frame[] = []
    let elapsed = 0
    for (let i = 0; i < count && elapsed < MAX_SECONDS * 1000; i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      // A frame with no delay of its own shows for 0.1 s, as browsers and the phone play it.
      const ms = image.duration ? Math.max(20, image.duration / 1000) : 100
      frames.push({ image: await createImageBitmap(image), width: image.displayWidth, height: image.displayHeight, ms })
      image.close()
      elapsed += ms
    }
    return frames
  } finally {
    decoder.close()
  }
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack?: { frameCount: number } }
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>
  close(): void
}

function pixels(frame: Frame, edge: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = edge
  canvas.height = edge
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('no canvas')
  const side = Math.min(frame.width, frame.height)
  context.drawImage(frame.image, (frame.width - side) / 2, (frame.height - side) / 2, side, side, 0, 0, edge, edge)
  return context.getImageData(0, 0, edge, edge).data
}

const dataUrl = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * The picked file as a moving picture's PNG data URL, or null when it's a
 * still (or this computer can't decode its frames). Throws TooLargeError
 * when even the smallest try is over 1.5 MB.
 */
export async function movingPicture(file: Blob): Promise<string | null> {
  const frames = isVideo(file) ? await videoFrames(file) : await pictureFrames(file)
  try {
    if (frames.length < 2) return null
    for (const attempt of ATTEMPTS) {
      const { frames: picked, delay } = thinned(frames, attempt.frames)
      const bytes = await encodeApng(
        picked.map(frame => pixels(frame, attempt.edge)),
        attempt.edge,
        attempt.edge,
        delay
      )
      if (bytes.length <= MAX_BYTES) return dataUrl(bytes)
    }
    throw new TooLargeError('too large')
  } finally {
    for (const frame of frames) (frame.image as ImageBitmap).close?.()
  }
}

/** Whether a picture's data URL moves: an animated PNG, or a GIF. */
export function isMovingDataUrl(url: string): boolean {
  if (url.startsWith('data:image/gif')) return true
  const match = /^data:image\/(?:a?png);base64,(.*)$/.exec(url)
  if (!match) return false
  try {
    // The chunks before the first frame's data are near the start.
    const head = atob(match[1]!.slice(0, 4096).replace(/[^A-Za-z0-9+/]/g, '').slice(0, 4096 - (4096 % 4)))
    return isAnimatedPng(Uint8Array.from(head, c => c.charCodeAt(0)))
  } catch {
    return false
  }
}

const stills = new Map<string, Promise<string>>()
const ready = new Map<string, string>()

/** A first frame already made, so a face drawn again shows it at once. */
export const stillReady = (url: string): string | undefined => ready.get(url)

/** A moving picture's first frame, for the faces that keep still (rows, the transcript, menus). */
export function stillOf(url: string): Promise<string> {
  let still = stills.get(url)
  if (!still) {
    still = (async () => {
      const match = /^data:([^;,]+);base64,(.*)$/.exec(url)
      if (!match) return url
      const binary = atob(match[2]!)
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(binary, c => c.charCodeAt(0))], { type: match[1] }))
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
        return canvas.toDataURL('image/png')
      } finally {
        bitmap.close()
      }
    })()
      .catch(() => url)
      .then(frame => {
        ready.set(url, frame)
        return frame
      })
    stills.set(url, still)
    // A few faces are enough to keep; an old one is read again if it shows.
    if (stills.size > 32) {
      const oldest = stills.keys().next().value!
      stills.delete(oldest)
      ready.delete(oldest)
    }
  }
  return still
}
