/**
 * Settings > Models, after the phone's Models & providers: the model new
 * chats start on, and the helper models, the smaller jobs Hermes runs beside
 * a profile's chats (titles, compaction, image reading and the rest of
 * /api/model/auxiliary), each on the chat model unless it has one of its own.
 */
import { t } from '../../../shared/i18n'

export interface HelperSlot {
  task: string
  title: string
  caption: string
  provider: string
  model: string
  /** A slot that follows another while unpinned: that slot's title. */
  follows?: string
}

export interface ModelSettings {
  main: { provider: string; model: string }
  slots: HelperSlot[]
}

/** Slots set elsewhere in Conduit: Pulse's memory runs on the main profile, set in Settings > Pulse. */
const SET_ELSEWHERE = new Set(['pulse_memory'])

/** Hermes labels its own slots in its web page, not in the answer, so Conduit names them. */
function builtIn(task: string): { title: string; caption: string } | null {
  switch (task) {
    case 'vision':
      return { title: t('Image reading'), caption: t("Reads pictures and screenshots for a chat model that can't see them.") }
    case 'compression':
      return { title: t('Compaction'), caption: t("Summarizes a long chat so it still fits the model's context.") }
    case 'skills_hub':
      return { title: t('Skill search'), caption: t('Finds skills in the Skills Hub.') }
    case 'approval':
      return { title: t('Smart approvals'), caption: t('Decides which commands are safe to run without asking you, when smart approvals are on.') }
    case 'mcp':
      return { title: t('MCP tool routing'), caption: t('Picks which MCP tools a turn needs.') }
    case 'title_generation':
      return { title: t('Chat titles'), caption: t('Names new chats.') }
    case 'review':
      return { title: t('Code review'), caption: t("Runs the /review command's reviewer.") }
    case 'voice_chat':
      return {
        title: t('Voice replies'),
        caption: t(
          "The model Hermes answers you with in a voice conversation. Reasoning is off by default so replies start sooner; typed messages keep the chat's model. Hermes Desktop uses this setting too."
        )
      }
    case 'triage_specifier':
      return { title: t('Kanban task details'), caption: t("Fills in a new Kanban task's details.") }
    case 'kanban_decomposer':
      return { title: t('Kanban task splitting'), caption: t('Splits a Kanban task into smaller ones.') }
    case 'profile_describer':
      return { title: t('Profile descriptions'), caption: t("Writes a profile's description.") }
    case 'curator':
      return { title: t('Skill curator'), caption: t('Reviews how skills are used and suggests improvements.') }
    case 'conduit_predict':
      return { title: t('Conduit predictions'), caption: t('Suggested replies and draft guesses in Conduit, when Predictive uses the fast model.') }
    case 'conduit_work_watch':
      return {
        title: t('Conduit work watch'),
        caption: t('Reads what a bot’s workstreams report while they work and tells its Bot Chat when one may affect another.')
      }
    default:
      return null
  }
}

/** A slot a newer Hermes added: its label, else its key made readable. */
function slotTitle(task: string, label: string): string {
  const known = builtIn(task)
  if (known) return known.title
  if (label.trim()) return label.trim()
  const spaced = task.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function parseModelSettings(raw: unknown): ModelSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  const main = (o.main && typeof o.main === 'object' ? o.main : {}) as Row
  const rows = (Array.isArray(o.tasks) ? o.tasks : []).filter((r): r is Row => !!r && typeof r === 'object')
  const titles = new Map(rows.map(row => [str(row.task), slotTitle(str(row.task), str(row.label))]))
  const seen = new Set<string>()
  const slots: HelperSlot[] = []
  for (const row of rows) {
    const task = str(row.task).trim()
    if (!task || seen.has(task) || SET_ELSEWHERE.has(task)) continue
    seen.add(task)
    const inherits = str(row.inherit_from)
    slots.push({
      task,
      title: titles.get(task) ?? task,
      caption: builtIn(task)?.caption ?? str(row.hint),
      provider: str(row.provider),
      model: str(row.model),
      follows: inherits ? (titles.get(inherits) ?? inherits) : undefined
    })
  }
  return { main: { provider: str(main.provider), model: str(main.model) }, slots }
}

/** A slot with a model of its own; "auto" with no model is the chat model. */
export const hasOwnModel = (slot: HelperSlot) => !!slot.model && slot.provider !== 'auto'

/** "All use the chat model", or how many have one of their own. */
export function helperSummary(slots: HelperSlot[]): string {
  const own = slots.filter(hasOwnModel).length
  return own ? t('{own} of {all} have a model of their own', { own: String(own), all: String(slots.length) }) : t('All use the chat model')
}
