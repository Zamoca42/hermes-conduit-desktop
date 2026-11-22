/**
 * Settings > Voice > Live call style > "What Conduit sends", after the phone's
 * liveVoiceInstructionsPreview: the instructions the next call in the chosen
 * live mode would get, built by the same code the call uses, with
 * placeholders for what is read from the host when a call starts (memory,
 * personality, the chat and its waiting questions), and the greeting turn.
 */
import { language, t } from '../../../shared/i18n'
import { briefing, sendsMemory, sendsPersona, type VoiceMode } from './gptLive'
import { geminiSendsMemory, geminiSendsPersona, instructions as geminiInstructions, resolvedSearch, searchMode } from './geminiLive'
import { qwenSendsMemory, qwenSendsPersona } from './qwenLive'
import { grokSendsMemory, grokSendsPersona, instructions as grokInstructions } from './grokLive'
import { AGENT_INSTRUCTIONS, AGENT_LOOKUPS, localLiveAgent, localLivePersona } from './localLive'
import { clockInstructions, liveInstructions } from './liveCall'
import { openingTurn } from './liveGreeting'

export interface LivePreview {
  /** The mode's name, as the call screen titles it. */
  mode: string
  instructions: string
  /** The call's first turn, when the greeting is on. */
  openingTurn: string | null
  /** Local Live's fast model gets these as all its instructions. */
  isLocalLive: boolean
}

/** What the next call in `mode` would be told; null for Classic, and for Local Live with Hermes answering each turn. */
export function livePreview(mode: VoiceMode, now = new Date()): LivePreview | null {
  const memory = t('(What your Hermes agent remembers about you, read when the call starts.)')
  const persona = t("(This profile's SOUL.md, read when the call starts.)")
  const lang = language()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const preview = (name: string, text: string, isLocalLive = false): LivePreview => ({
    mode: name,
    instructions: text,
    openingTurn: openingTurn(),
    isLocalLive
  })
  switch (mode) {
    case 'gpt':
      return preview('GPT-Live', briefing(lang, sendsPersona() ? persona : '', sendsMemory() ? memory : ''))
    case 'gemini':
    case 'qwen': {
      const qwen = mode === 'qwen'
      // The host's web search is read when a call starts; the preview shows the search chosen without it.
      const search = resolvedSearch(searchMode(mode), false, mode)
      return preview(
        qwen ? 'Qwen Live' : 'Gemini Live',
        geminiInstructions({
          language: lang,
          persona: (qwen ? qwenSendsPersona() : geminiSendsPersona()) ? persona : '',
          memory: (qwen ? qwenSendsMemory() : geminiSendsMemory()) ? memory : '',
          search
        })
      )
    }
    case 'grok':
      return preview(
        'Grok Live',
        grokInstructions({ language: lang, persona: grokSendsPersona() ? persona : '', memory: grokSendsMemory() ? memory : '', now, timeZone })
      )
    case 'local':
      if (!localLiveAgent()) return null
      return preview(
        'Local Live',
        liveInstructions({
          lookups: AGENT_LOOKUPS,
          announces: false,
          extra: AGENT_INSTRUCTIONS + clockInstructions(now, timeZone),
          language: lang,
          persona: localLivePersona() ? persona : ''
        }),
        true
      )
    default:
      return null
  }
}
