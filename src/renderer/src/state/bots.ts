/**
 * Bots: every Hermes profile, as the gateway's `profiles.list` lists them,
 * with the look Hermes Desktop and the phone keep in `ui_meta['hermes-bots']`
 * (title, color, pinned, hidden) and the picture in the profile's asset store
 * (`profiles.get_asset`, asset `avatar`).
 */
import { cleanTitle, plainLine, previewText } from './text'
import { toMillis } from './chats'
import { assignFaces, faceColor, starterFace } from './starterFaces'

export const BOTS_META_KEY = 'hermes-bots'

export interface Bot {
  name: string
  title: string
  description?: string
  model?: string
  color?: string
  pinned: boolean
  hidden: boolean
  isDefault: boolean
  hasAvatar: boolean
  /** The starter face it wears while it has no picture (the phone's StarterFaces). */
  face: number
  /** The profile's Bot Chat, its one long-running chat, when it has one. */
  botChatId?: string
  /** Its newest chat's last line and time. */
  lastLine?: string
  lastActive?: number
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** The name a bot goes by: its own, else the profile's; the default profile with no name is Hermes. */
export function botTitle(given: string | undefined, name: string, isDefault: boolean): string {
  const title = given ? cleanTitle(given) : ''
  if (title) return title
  return isDefault ? 'Hermes' : name
}

export function botsFromProfiles(body: unknown): Bot[] {
  const list = body && typeof body === 'object' ? (body as { profiles?: unknown }).profiles : undefined
  if (!Array.isArray(list)) return []
  const bots: Bot[] = []
  const candidates: { name: string; isDefault: boolean; storedFace?: number; created?: number }[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const name = str(row.name)
    if (!name) continue
    const uiMeta = row.ui_meta && typeof row.ui_meta === 'object' ? (row.ui_meta as Record<string, unknown>) : {}
    const meta = uiMeta[BOTS_META_KEY] && typeof uiMeta[BOTS_META_KEY] === 'object' ? (uiMeta[BOTS_META_KEY] as Record<string, unknown>) : {}
    const canonical = row.canonical_session && typeof row.canonical_session === 'object' ? (row.canonical_session as Record<string, unknown>) : null
    const last = row.last_session && typeof row.last_session === 'object' ? (row.last_session as Record<string, unknown>) : null
    const source = canonical ?? last
    const preview = str(source?.preview)
    const isDefault = row.is_default === true || name.toLowerCase() === 'default'
    const storedFace = typeof meta.face === 'number' && Number.isInteger(meta.face) && meta.face >= 0 ? meta.face : undefined
    const created = typeof meta.created === 'number' ? meta.created : undefined
    candidates.push({ name, isDefault, storedFace, created })
    bots.push({
      name,
      title: botTitle(str(meta.title) ?? str(row.display_name), name, isDefault),
      description: str(row.description),
      model: str(row.model),
      color: str(meta.color),
      pinned: meta.pinned === true,
      hidden: meta.hidden === true,
      isDefault,
      hasAvatar: row.has_avatar === true,
      face: 0,
      botChatId: str(canonical?.resolved_id) ?? str(canonical?.id),
      lastLine: preview ? plainLine(previewText(preview), 240) || undefined : undefined,
      lastActive: toMillis(source?.last_active) ?? toMillis(last?.last_active)
    })
  }
  // Faces go round every bot, hidden ones too, as the phone hands them out.
  const faces = assignFaces(candidates)
  for (const bot of bots) bot.face = faces.get(bot.name) ?? 0
  return displayOrder(bots.filter(b => !b.hidden))
}

/** Pinned first, then the most recently active, as the phone orders them. */
export function displayOrder(bots: Bot[]): Bot[] {
  return [...bots].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const activity = (b.lastActive ?? 0) - (a.lastActive ?? 0)
    if (activity) return activity
    return a.name.localeCompare(b.name)
  })
}

/** Bots home's layout for how many bots there are (the phone's C, A and grid). */
export function homeLayout(count: number): 'one' | 'two' | 'grid' {
  return count <= 1 ? 'one' : count === 2 ? 'two' : 'grid'
}

/** A `profiles.get_asset` answer as an image URL, or null when there's no picture. */
export function avatarUrl(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as { found?: unknown; mime?: unknown; data?: unknown }
  if (r.found !== true || typeof r.data !== 'string' || !r.data) return null
  if (r.data.startsWith('data:')) return r.data
  const mime = typeof r.mime === 'string' && r.mime.startsWith('image/') ? r.mime : 'image/png'
  return `data:${mime};base64,${r.data}`
}

const NAMED_COLORS = new Set(['blue', 'brown', 'cyan', 'green', 'indigo', 'mint', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow'])
const MINT = '#00c7be'

/** The color Hermes keeps for the bot as CSS (hex, hsl(), rgb() or a named color), or undefined when it has none. */
export function keptColor(color: string | undefined): string | undefined {
  const value = color?.trim()
  if (!value) return undefined
  if (/^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value.startsWith('#') ? value : `#${value}`
  if (/^(?:hsla?|rgba?)\([\d.\s,%/deg+-]+\)$/i.test(value)) return value
  const named = value.toLowerCase()
  if (NAMED_COLORS.has(named)) return named === 'mint' ? MINT : named
  return undefined
}

/** The bot's color: the one Hermes keeps for it, else its starter face's. */
export function botColor(bot: Pick<Bot, 'color' | 'face'>): string {
  return keptColor(bot.color) ?? faceColor(starterFace(bot.face))
}
