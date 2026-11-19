/**
 * The backdrop's warm glow takes a profile's color, after the phone's
 * Profile glow color (ProfileGlowColors.swift): the one picked for it on
 * this computer, else the main color of its picture, else its bot's color
 * in Hermes, else its starter face's, else the gold accent. Two profiles
 * whose pictures share a main color would glow alike, so the later one in
 * the roster's order falls back to its picture's second, then third color.
 */
import { botColor, type Bot } from './bots'

export interface RGB {
  r: number
  g: number
  b: number
}

export const GOLD = '#e0ab47'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function rgbFromHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

export const hexFromRgb = ({ r, g, b }: RGB) =>
  `#${[r, g, b]
    .map(v =>
      Math.round(clamp01(v) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

/** Hue in degrees, saturation and brightness in 0...1. */
export function hsb({ r, g, b }: RGB): { h: number; s: number; v: number } {
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const delta = high - low
  if (delta <= 0) return { h: 0, s: 0, v: high }
  let h = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s: delta / high, v: high }
}

export function fromHsb(h: number, s: number, v: number): RGB {
  const hh = ((((h % 360) + 360) % 360) / 60) as number
  const chroma = v * s
  const x = chroma * (1 - Math.abs((hh % 2) - 1))
  const [r, g, b] =
    hh < 1 ? [chroma, x, 0] : hh < 2 ? [x, chroma, 0] : hh < 3 ? [0, chroma, x] : hh < 4 ? [0, x, chroma] : hh < 5 ? [x, 0, chroma] : [chroma, 0, x]
  const m = v - chroma
  return { r: clamp01(r + m), g: clamp01(g + m), b: clamp01(b + m) }
}

const DISTINCT_HUE = 30

/** Two glows that would read as one color: hues closer than 30°, or two greys of about the same lightness. */
export function looksLike(a: RGB, b: RGB): boolean {
  const x = hsb(a)
  const y = hsb(b)
  const xGrey = x.s < 0.15
  const yGrey = y.s < 0.15
  if (xGrey || yGrey) return xGrey && yGrey && Math.abs(x.v - y.v) < 0.2
  const distance = Math.abs(x.h - y.h)
  return Math.min(distance, 360 - distance) < DISTINCT_HUE
}

/** A picture's colors are often dark or muted: keep the hue, lift it to a glow's strength. */
export function glowable(color: RGB): RGB {
  const { h, s, v } = hsb(color)
  return fromHsb(h, Math.max(s, 0.45), Math.max(v, 0.75))
}

/** The side a picture is scaled to before counting. */
export const SAMPLE_SIDE = 32

/** A picture's main colors, most prominent first, from its RGBA pixels (not premultiplied, as a canvas gives them). */
export function paletteFrom(pixels: ArrayLike<number>): RGB[] {
  const bins = 24
  const weights = new Array<number>(bins).fill(0)
  const sums = Array.from({ length: bins }, () => ({ r: 0, g: 0, b: 0 }))
  let total = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! / 255 < 0.5) continue
    const pixel = { r: pixels[i]! / 255, g: pixels[i + 1]! / 255, b: pixels[i + 2]! / 255 }
    const { h, s, v } = hsb(pixel)
    if (s < 0.2 || v < 0.2) continue
    // Vivid pixels count for more than washed-out ones of the same hue.
    const weight = s * v
    const bin = Math.min(Math.floor(h / (360 / bins)), bins - 1)
    weights[bin]! += weight
    sums[bin]!.r += pixel.r * weight
    sums[bin]!.g += pixel.g * weight
    sums[bin]!.b += pixel.b * weight
    total += weight
  }
  if (total <= 0) return []
  const picked: RGB[] = []
  for (const bin of weights.map((_, i) => i).sort((a, b) => weights[b]! - weights[a]!)) {
    // A few stray pixels never become a profile's glow.
    if (picked.length >= 3 || weights[bin]! / total < 0.04) break
    const w = weights[bin]!
    const glow = glowable({ r: sums[bin]!.r / w, g: sums[bin]!.g / w, b: sums[bin]!.b / w })
    if (picked.some(color => looksLike(color, glow))) continue
    picked.push(glow)
  }
  return picked
}

/**
 * Each profile's glow from its pick or picture. Picks are claimed first;
 * then, in order, each picture's main color unless an earlier profile
 * already glows like it, then its second and third, else the main one
 * anyway. A pick for a profile no longer listed is left out.
 */
export function assignGlows(order: string[], palettes: Record<string, RGB[]>, picked: Record<string, RGB>): Record<string, RGB> {
  const result: Record<string, RGB> = {}
  for (const name of order) if (picked[name]) result[name] = picked[name]!
  const taken = order.flatMap(name => (result[name] ? [result[name]!] : []))
  for (const name of order) {
    if (result[name]) continue
    const palette = palettes[name]
    const main = palette?.[0]
    if (!palette || !main) continue
    const choice = palette.find(candidate => !taken.some(color => looksLike(color, candidate))) ?? main
    result[name] = choice
    taken.push(choice)
  }
  return result
}

/** A profile's glow as CSS: its pick or picture's, else its bot's color (Hermes', else its starter face's), else gold. */
export function glowFor(name: string | null | undefined, assigned: Record<string, RGB>, bots: Pick<Bot, 'name' | 'isDefault' | 'color' | 'face'>[]): string {
  const bot = bots.find(b => (name ? b.name === name : b.isDefault)) ?? (name ? undefined : bots[0])
  if (!bot) return GOLD
  const own = assigned[bot.name]
  return own ? hexFromRgb(own) : botColor(bot)
}

/** Picks are kept on this computer, for each host. */
const picksKey = (host: string) => `conduit.glowPicks.${host}`
const PICKS_CHANGED = 'conduit-glow-picks-changed'

export function readPicks(host: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(picksKey(host)) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!rgbFromHex(entry[1])))
      : {}
  } catch {
    return {}
  }
}

/** Picks a color for a profile's glow on this computer, or (null) goes back to Automatic. */
export function savePick(host: string, profile: string, hex: string | null) {
  const picks = readPicks(host)
  if (hex && rgbFromHex(hex)) picks[profile] = hex.toLowerCase()
  else delete picks[profile]
  try {
    localStorage.setItem(picksKey(host), JSON.stringify(picks))
  } catch {
    // Kept for this window only.
  }
  window.dispatchEvent(new CustomEvent(PICKS_CHANGED, { detail: { host, picks } }))
}

export function subscribePicks(listener: (host: string, picks: Record<string, string>) => void): () => void {
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<{ host: string; picks: Record<string, string> }>).detail
    listener(detail.host, detail.picks)
  }
  window.addEventListener(PICKS_CHANGED, changed)
  return () => window.removeEventListener(PICKS_CHANGED, changed)
}
