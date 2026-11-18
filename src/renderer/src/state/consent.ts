/**
 * The user's OK for a live voice mode to send their voice to the company that
 * runs it, after the phone's LiveVoiceProviderConsent: Gemini Live, Qwen Live,
 * GPT-Live and Grok Live send microphone audio, the transcript and what Hermes
 * adds to Google, Alibaba Cloud, OpenAI or xAI, so each asks once before its
 * first call. Kept per provider on this computer; Settings > Voice takes it back.
 */
import { t } from '../../../shared/i18n'
import type { VoiceMode } from './gptLive'

/** Local Live goes to the user's own speech server, through their Hermes host: nothing to ask. */
export type LiveMode = Exclude<VoiceMode, 'classic' | 'local'>

const PROVIDERS: Record<LiveMode, { id: string; company: string; name: () => string }> = {
  gemini: { id: 'gemini-live', company: 'Google', name: () => t('Gemini Live') },
  qwen: { id: 'qwen-live', company: 'Alibaba Cloud', name: () => t('Qwen Live') },
  gpt: { id: 'gpt-live', company: 'OpenAI', name: () => t('GPT-Live') },
  grok: { id: 'grok-live', company: 'xAI', name: () => t('Grok Live') }
}

export const isLive = (mode: VoiceMode): mode is LiveMode => mode !== 'classic' && mode !== 'local'
/** The company that receives the call (a name: never translated). */
export const company = (mode: LiveMode) => PROVIDERS[mode].company
export const modeName = (mode: LiveMode) => PROVIDERS[mode].name()
/** The phone's key, so the two read the same. */
export const consentKey = (mode: LiveMode) => `conduit.liveVoiceProviderConsent.${PROVIDERS[mode].id}`

export function consented(mode: VoiceMode): boolean {
  if (!isLive(mode)) return true
  try {
    return localStorage.getItem(consentKey(mode)) === 'true'
  } catch {
    return false
  }
}

export function setConsented(mode: LiveMode, granted: boolean): void {
  try {
    if (granted) localStorage.setItem(consentKey(mode), 'true')
    else localStorage.removeItem(consentKey(mode))
  } catch {
    // Asks again next time.
  }
}
