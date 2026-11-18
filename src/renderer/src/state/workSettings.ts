/**
 * Edit Bot > Work, after the phone's: whether the Bot Chat hands longer
 * tasks to workstreams, what it does itself, how many run at once, how it
 * keeps them in step, the model they start on, and their safety. Read and
 * saved through the plugin's /workstreams/settings, a change at a time.
 */
import { t } from '../../../shared/i18n'

export type Policy = 'off' | 'strict' | 'lookups' | 'open'
export type Coordination = 'off' | 'ask' | 'auto'
export type Approvals = 'chats' | 'ask' | 'off'

export interface WorkModel {
  model: string
  provider?: string
  reasoningEffort?: string
}

export interface WorkSettings {
  policy: Policy
  policies: Policy[]
  quickSteps?: number
  quickStepsChoices: number[]
  coordination?: Coordination
  maxRunning: number
  maxRunningLimit: number
  afterRestart: 'continue' | 'ask'
  approvals: Approvals
  chatApprovals: string
  model: WorkModel | null
  unavailable: string
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const POLICIES: Policy[] = ['off', 'strict', 'lookups', 'open']

export function parseWorkSettings(raw: unknown): WorkSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Row
  const policies = (Array.isArray(o.policies) ? o.policies : []).filter((p): p is Policy => POLICIES.includes(p as Policy))
  const model = o.workstream_model && typeof o.workstream_model === 'object' ? (o.workstream_model as Row) : null
  const coordination = str(o.coordination)
  return {
    policy: POLICIES.includes(o.policy as Policy) ? (o.policy as Policy) : 'lookups',
    policies,
    quickSteps: int(o.quick_steps),
    quickStepsChoices: (Array.isArray(o.quick_steps_choices) ? o.quick_steps_choices : []).filter((n): n is number => Number.isInteger(n) && (n as number) > 0),
    coordination: ['off', 'ask', 'auto'].includes(coordination) ? (coordination as Coordination) : undefined,
    maxRunning: Math.max(1, int(o.max_running) ?? 3),
    maxRunningLimit: Math.max(1, int(o.max_running_limit) ?? 8),
    afterRestart: o.after_restart === 'ask' ? 'ask' : 'continue',
    approvals: o.workstream_approvals === 'ask' || o.workstream_approvals === 'off' ? (o.workstream_approvals as Approvals) : 'chats',
    chatApprovals: str(o.chat_approvals),
    model:
      model && str(model.model)
        ? { model: str(model.model), provider: str(model.provider) || undefined, reasoningEffort: str(model.reasoning_effort) || undefined }
        : null,
    unavailable: str(o.unavailable)
  }
}

/** What the Bot Chat may do itself, by what the user notices; Everything Here only where the plugin takes it. */
export function policyChoices(settings: WorkSettings): { id: Policy; title: string }[] {
  const choices: { id: Policy; title: string }[] = [{ id: 'lookups', title: t('Quick Things Here') }]
  if (settings.policies.includes('open') || settings.policy === 'open') choices.push({ id: 'open', title: t('Everything Here') })
  choices.push({ id: 'strict', title: t('Only Coordinates') })
  return choices
}

/** The step counts the plugin takes, with the bot's own when it isn't one of them. */
export function quickStepsChoices(settings: WorkSettings): number[] {
  const counts = [...settings.quickStepsChoices]
  if (settings.quickSteps !== undefined && !counts.includes(settings.quickSteps)) counts.push(settings.quickSteps)
  return counts.sort((a, b) => a - b)
}

export function policyCaption(policy: Policy, bot: string): string {
  switch (policy) {
    case 'open':
      return t(
        '{bot} does everything in its Bot Chat, and runs work in the background only when you ask or it’s clearly long. The chat is busy while it works.',
        { bot }
      )
    case 'strict':
      return t('Everything but cards, maps, notifications, memories and its questions to you runs in the background, so its Bot Chat is always free to talk.')
    default:
      return t(
        '{bot} answers and does quick things in its Bot Chat. Anything that takes longer runs in the background, and you’re told there when it’s done.',
        { bot }
      )
  }
}

export function coordinationCaption(coordination: Coordination, bot: string): string {
  switch (coordination) {
    case 'ask':
      return t(
        '{bot} follows what each workstream finds and changes. When one affects another, it tells you what it recommends and asks before it starts, stops or redirects work.',
        { bot }
      )
    case 'auto':
      return t(
        '{bot} keeps its workstreams in step on its own. When one affects another, it can start, stop or redirect work, and tells you in a line when it did.',
        { bot }
      )
    default:
      return t('{bot} only passes on what its workstreams report.', { bot })
  }
}

export function approvalsCaption(settings: WorkSettings, bot: string): string {
  const off = settings.chatApprovals === 'off'
  switch (settings.approvals) {
    case 'chats':
      return off
        ? t('Approvals are off for this bot in Hermes, so its chats and workstreams run without asking.')
        : t('Workstreams ask for approval as this bot’s chats do in Hermes.')
    case 'ask':
      return off
        ? t(
            'Approvals are off for this bot in Hermes, so no approval card comes. Its workstreams are told to wait for your own go-ahead before a step that can’t be undone.'
          )
        : t('Before a step that can’t be undone, workstreams wait for your own go-ahead, never {bot}’s alone.', { bot })
    default:
      return t('Workstreams run commands without asking for approval. Commands Hermes never runs stay blocked.')
  }
}

/** The body that saves a workstream model pick: null for the Bot Chat's own. */
export function modelBody(pick: WorkModel | null): Row | null {
  if (!pick) return null
  return {
    model: pick.model,
    ...(pick.provider ? { provider: pick.provider } : {}),
    ...(pick.reasoningEffort ? { reasoning_effort: pick.reasoningEffort } : {})
  }
}
