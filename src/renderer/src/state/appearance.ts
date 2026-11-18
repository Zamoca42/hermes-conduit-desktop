/**
 * Settings > Appearance, after the phone's: the theme (in the main process,
 * so Chromium's `prefers-color-scheme` follows it), the accent color of your
 * own messages and Conduit's highlights (ConduitAccentChoice), and the chat
 * text style (ChatFontStyle). The accent and the style stay on this computer.
 */
import { t } from '../../../shared/i18n'

export type AccentChoice = 'amber' | 'blue' | 'green' | 'teal' | 'purple' | 'pink'
/** A preset, or a color of your own as "#RRGGBB", stored under the same key as the phone stores it. */
export type Accent = AccentChoice | `#${string}`
export const ACCENTS: AccentChoice[] = ['amber', 'blue', 'green', 'teal', 'purple', 'pink']
export type ChatFontStyle = 'standard' | 'rounded' | 'serif' | 'mono'
export const CHAT_FONTS: ChatFontStyle[] = ['standard', 'rounded', 'serif', 'mono']

const ACCENT_KEY = 'conduit.accentChoice'
const FONT_KEY = 'conduit.chatFontStyle'
const STYLE_ID = 'conduit-accent'

type RGB = [number, number, number]
/** The phone's sRGB presets: [dark, light] for the accent and for its soft companion. */
const PRESETS: Record<AccentChoice, { color: [RGB, RGB]; soft: [RGB, RGB] }> = {
  amber: {
    color: [
      [0.88, 0.67, 0.28],
      [0.55, 0.37, 0.13]
    ],
    soft: [
      [0.98, 0.83, 0.48],
      [0.67, 0.49, 0.28]
    ]
  },
  blue: {
    color: [
      [0.33, 0.58, 0.98],
      [0.12, 0.36, 0.8]
    ],
    soft: [
      [0.58, 0.76, 1.0],
      [0.27, 0.48, 0.85]
    ]
  },
  green: {
    color: [
      [0.3, 0.72, 0.47],
      [0.09, 0.47, 0.27]
    ],
    soft: [
      [0.54, 0.86, 0.64],
      [0.21, 0.56, 0.37]
    ]
  },
  teal: {
    color: [
      [0.22, 0.7, 0.75],
      [0.04, 0.45, 0.51]
    ],
    soft: [
      [0.5, 0.86, 0.89],
      [0.16, 0.55, 0.6]
    ]
  },
  purple: {
    color: [
      [0.62, 0.48, 0.96],
      [0.43, 0.28, 0.8]
    ],
    soft: [
      [0.79, 0.7, 1.0],
      [0.54, 0.41, 0.85]
    ]
  },
  pink: {
    color: [
      [0.93, 0.42, 0.64],
      [0.76, 0.19, 0.44]
    ],
    soft: [
      [1.0, 0.65, 0.79],
      [0.83, 0.35, 0.56]
    ]
  }
}

export function accentTitle(choice: AccentChoice): string {
  switch (choice) {
    case 'amber':
      return t('Amber')
    case 'blue':
      return t('Blue')
    case 'green':
      return t('Green')
    case 'teal':
      return t('Teal')
    case 'purple':
      return t('Purple')
    default:
      return t('Pink')
  }
}

export function chatFontTitle(style: ChatFontStyle): string {
  switch (style) {
    case 'rounded':
      return t('Rounded')
    case 'serif':
      return t('Serif')
    case 'mono':
      return t('Mono')
    default:
      return t('Default')
  }
}

export const hex = (rgb: RGB) =>
  `#${rgb
    .map(c =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`

/** Black or white, whichever has the higher WCAG contrast on `fill`, as the phone's markColor. */
export function markColor(fill: RGB): '#000000' | '#ffffff' {
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear(fill[0]) + 0.7152 * linear(fill[1]) + 0.0722 * linear(fill[2])
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}

/** The swatch's color in the mode the window shows. */
export const swatchColor = (choice: AccentChoice, dark: boolean) => hex(PRESETS[choice].color[dark ? 0 : 1])

interface Shades {
  color: RGB
  soft: RGB
  /** Sent bubbles and the send button. */
  fill: RGB
}

function block(shades: Shades, dark: boolean): string {
  const accent = hex(shades.color)
  const fill = hex(shades.fill)
  const vars: Record<string, string> = {
    '--accent': accent,
    '--accent-strong': `color-mix(in srgb, ${accent} 86%, black)`,
    '--accent-hover': dark ? hex(shades.soft) : `color-mix(in srgb, ${accent} 78%, black)`,
    '--accent-fill': fill,
    '--accent-fill-2': `color-mix(in srgb, ${fill} 86%, black)`,
    '--accent-ink': markColor(shades.fill),
    '--accent-soft': `color-mix(in srgb, ${accent} ${dark ? 14 : 12}%, transparent)`,
    '--accent-line': `color-mix(in srgb, ${accent} ${dark ? 25 : 30}%, transparent)`,
    '--accent-time': `color-mix(in srgb, ${accent} ${dark ? 75 : 85}%, transparent)`,
    '--bubble-shadow': `0 6px 14px color-mix(in srgb, ${fill} ${dark ? 16 : 18}%, transparent)`
  }
  return Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}

// A color of your own, after the phone's CustomAccentColor: each shade keeps
// the pick's hue and saturation and moves its lightness just far enough to
// read (WCAG AA, 4.5:1). A pick that already reads is drawn as picked.
const DARK_BACKDROP: RGB = [0.045, 0.052, 0.072]
const LIGHT_BACKDROP: RGB = [0.94, 0.95, 0.98]
const WHITE: RGB = [1, 1, 1]
const MINIMUM_CONTRAST = 4.5

export function luminance([r, g, b]: RGB): number {
  const linear = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrast(a: RGB, b: RGB): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function hsl([r, g, b]: RGB): [number, number, number] {
  const high = Math.max(r, g, b)
  const low = Math.min(r, g, b)
  const lightness = (high + low) / 2
  const delta = high - low
  if (delta <= 0) return [0, 0, lightness]
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  hue *= 60
  if (hue < 0) hue += 360
  return [hue, Math.min(saturation, 1), lightness]
}

function fromHsl(hue: number, saturation: number, lightness: number): RGB {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second]
  const offset = lightness - chroma / 2
  const clamp = (v: number) => Math.min(Math.max(v + offset, 0), 1)
  return [clamp(r), clamp(g), clamp(b)]
}

/** `color` with its lightness stepped up or down until `reads` holds; white reads on dark and black on light, so it ends. */
function adjusted(color: RGB, lighter: boolean, reads: (c: RGB) => boolean): RGB {
  if (reads(color)) return color
  const [hue, saturation, start] = hsl(color)
  let lightness = start
  const step = lighter ? 0.005 : -0.005
  for (;;) {
    const next = Math.min(Math.max(lightness + step, 0), 1)
    const candidate = fromHsl(hue, saturation, next)
    if (reads(candidate) || next === lightness) return candidate
    lightness = next
  }
}

const towardsWhite = (c: RGB, amount: number): RGB => c.map(v => v + (1 - v) * amount) as RGB

export const isHex = (value: string): value is `#${string}` => /^#[0-9a-fA-F]{6}$/.test(value)
export const parseHex = (value: string): RGB => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255) as RGB

/** The pick's dark shade (lightened to read on the dark backdrop) and light shade (darkened to read on the light one and under white text). */
export function customShades(value: `#${string}`): { dark: RGB; light: RGB } {
  const picked = parseHex(value)
  return {
    dark: adjusted(picked, true, c => contrast(c, DARK_BACKDROP) >= MINIMUM_CONTRAST),
    light: adjusted(picked, false, c => contrast(c, LIGHT_BACKDROP) >= MINIMUM_CONTRAST && contrast(c, WHITE) >= MINIMUM_CONTRAST)
  }
}

function shades(accent: Accent, dark: boolean): Shades {
  if (isHex(accent)) {
    const { dark: darkShade, light: lightShade } = customShades(accent)
    // The light shade fills sent bubbles in both modes, as on the phone.
    return dark
      ? { color: darkShade, soft: towardsWhite(darkShade, 0.35), fill: lightShade }
      : { color: lightShade, soft: towardsWhite(lightShade, 0.2), fill: lightShade }
  }
  const preset = PRESETS[accent]
  const color = preset.color[dark ? 0 : 1]
  return { color, soft: preset.soft[dark ? 0 : 1], fill: color }
}

/** The stylesheet an accent adds over theme.css; amber is theme.css's own look, so none. */
export function accentStyle(accent: Accent): string {
  if (accent === 'amber') return ''
  return `:root { ${block(shades(accent, true), true)} }\n@media (prefers-color-scheme: light) { :root { ${block(shades(accent, false), false)} } }`
}

export function fontFamily(style: ChatFontStyle): string | null {
  switch (style) {
    case 'rounded':
      return "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', var(--font)"
    case 'serif':
      return "ui-serif, 'New York', Georgia, Cambria, 'Times New Roman', serif"
    case 'mono':
      return 'var(--mono)'
    default:
      return null
  }
}

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string, fallback: string): void {
  try {
    if (value === fallback) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // The default next time.
  }
}

export function readAccent(): Accent {
  try {
    const value = localStorage.getItem(ACCENT_KEY)
    if (value && isHex(value)) return value.toUpperCase() as Accent
  } catch {
    // The preset or the default below.
  }
  return stored(ACCENT_KEY, ACCENTS, 'amber')
}
export const readChatFont = () => stored(FONT_KEY, CHAT_FONTS, 'standard')

export function applyAccent(choice: Accent, save = true): void {
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = accentStyle(choice)
  if (save) store(ACCENT_KEY, choice, 'amber')
}

export function applyChatFont(style: ChatFontStyle, save = true): void {
  const family = fontFamily(style)
  if (family) document.documentElement.style.setProperty('--chat-font', family)
  else document.documentElement.style.removeProperty('--chat-font')
  if (save) store(FONT_KEY, style, 'standard')
}

/** At startup, before the first paint. */
export function applyStoredAppearance(): void {
  applyAccent(readAccent(), false)
  applyChatFont(readChatFont(), false)
}
