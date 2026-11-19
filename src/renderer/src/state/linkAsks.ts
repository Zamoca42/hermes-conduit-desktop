/**
 * Asks between linked agents (the phone's LinkAsks.swift): what each linked
 * person's Hermes may ask yours, and how it's answered. Nothing a linked
 * person's Hermes sends reaches a model on this side: these rules answer, or
 * you do (an ask waits for you, as What Hermes waits on shows it). The
 * plugin keeps them per Link (`/links/rules`).
 */

import { t } from '../../../shared/i18n'
import type { Http } from './roomLinks'

export const LINK_ASKS_CAPABILITY = 'link-asks'
export const LINK_RULES_PATH = '/api/plugins/conduit_push/links/rules'
export const FREE_ON_CHOICES = ['yes_no', 'times', 'ask', 'off']
export const QUESTION_CHOICES = ['ask', 'off']

export interface LinkAskRules {
  freeOn: string
  questions: string
  /** The profile whose phone and calendar answer. */
  profile: string
}

export interface LinkAskRulesEntry {
  id: string
  name: string
  status: string
  rules: LinkAskRules
}

type Row = Record<string, unknown>
const obj = (value: unknown): Row | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null)

export function parseRules(value: unknown): LinkAskRules | null {
  const rules = obj(value)
  if (!rules || typeof rules.free_on !== 'string' || typeof rules.questions !== 'string' || typeof rules.profile !== 'string' || !rules.profile) return null
  return { freeOn: rules.free_on, questions: rules.questions, profile: rules.profile }
}

export function parseRulesList(value: unknown): LinkAskRulesEntry[] | null {
  const row = obj(value)
  if (row?.ok !== true || !Array.isArray(row.links)) return null
  return row.links.flatMap((raw): LinkAskRulesEntry[] => {
    const link = obj(raw)
    const name = typeof link?.name === 'string' ? link.name.trim() : ''
    const rules = parseRules(link?.rules)
    if (!link || typeof link.id !== 'string' || !link.id || !name || typeof link.status !== 'string' || !rules) return []
    return [{ id: link.id, name, status: link.status, rules }]
  })
}

const unexpected = () => new Error(t('The Conduit notifier plugin gave an unexpected answer. Update it on your Hermes host and try again.'))

export function linkAsksClient(http: Http) {
  return {
    rules: async (): Promise<LinkAskRulesEntry[]> => {
      const list = parseRulesList(await http('GET', LINK_RULES_PATH))
      if (!list) throw unexpected()
      return list
    },
    /** One rule changed (`free_on`, `questions` or `profile`): the Link's rules as they now are. */
    set: async (linkId: string, changes: Record<string, string>): Promise<LinkAskRules> => {
      const row = obj(await http('PUT', LINK_RULES_PATH, { ...changes, link_id: linkId }))
      const rules = row?.ok === true && row.id === linkId ? parseRules(row.rules) : null
      if (!rules) throw unexpected()
      return rules
    }
  }
}

export function freeOnTitle(choice: string): string {
  switch (choice) {
    case 'yes_no':
      return t("Say if you're free")
    case 'times':
      return t("Say when you're busy")
    case 'ask':
      return t('Ask me first')
    case 'off':
      return t("Don't answer")
    default:
      return choice
  }
}

export function questionsTitle(choice: string): string {
  switch (choice) {
    case 'ask':
      return t('Ask me')
    case 'off':
      return t("Don't answer")
    default:
      return choice
  }
}

export function rulesCaption(rules: LinkAskRules, name: string, profileName: string): string {
  let freeOn: string
  switch (rules.freeOn) {
    case 'yes_no':
      freeOn = t("Asked whether you're free on a date, your Hermes says free or busy from the calendar your phone shares with {name}, without asking you.", { name: profileName })
      break
    case 'times':
      freeOn = t(
        "Asked whether you're free on a date, your Hermes says so from the calendar your phone shares with {name}, and when you're busy then (the times only), without asking you.",
        { name: profileName }
      )
      break
    case 'off':
      freeOn = t("Your Hermes doesn't say whether you're free.")
      break
    default:
      freeOn = t(
        "Asked whether you're free on a date, you see what your Hermes would answer from the calendar your phone shares with {name}, and Share it, say something else, or don't.",
        { name: profileName }
      )
  }
  const questions =
    rules.questions === 'off'
      ? t("Your Hermes turns {name}'s questions away.", { name })
      : t("Questions from {name}'s Hermes wait for you: only you answer them, never an agent.", { name })
  return `${freeOn} ${questions}`
}
