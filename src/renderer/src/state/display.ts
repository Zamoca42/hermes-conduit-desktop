/**
 * How chats show Hermes' thinking and tool cards, from the profile's
 * `display` block, as the phone reads it. Thinking: Show is Hermes' own
 * `display.show_reasoning` on; while it's off, Conduit's
 * `display.conduit_thinking_on_request` tells On request (Show thinking in
 * a reply's ⋯) from Off. Unset reads as On request.
 */
import { useEffect, useState } from 'react'
import { gateway } from '../gateway'

export type ThinkingMode = 'show' | 'on_request' | 'off'

export const THINKING_KEY = 'conduit.reasoning_display'

export interface ChatDisplay {
  thinking: ThinkingMode
  /** `display.tool_progress` other than "off". */
  toolCards: boolean
  /** `display.expand_tools`: finished tool cards open with their details. */
  expandTools: boolean
  /** `display.memory_notifications` other than off: self-improvement reviews show in chats. */
  showReviews: boolean
}

type Row = Record<string, unknown>
const object = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null)

export const DEFAULT_DISPLAY: ChatDisplay = { thinking: 'show', toolCards: true, expandTools: false, showReviews: true }

export function thinkingMode(config: unknown): ThinkingMode {
  const display = object(object(config)?.display) ?? {}
  if ((display.show_reasoning ?? true) === true) return 'show'
  return (display.conduit_thinking_on_request ?? true) === true ? 'on_request' : 'off'
}

/** As the phone reads it: a bool as it is, any text but "off" shows. */
export function showsReviews(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return typeof value === 'string' ? value.trim().toLowerCase() !== 'off' : true
}

export function chatDisplay(config: unknown): ChatDisplay {
  const display = object(object(config)?.display) ?? {}
  return {
    thinking: thinkingMode(config),
    toolCards: display.tool_progress !== 'off',
    expandTools: display.expand_tools === true,
    showReviews: showsReviews(display.memory_notifications)
  }
}

/** The config with the Thinking choice written; Show leaves Conduit's own key as it is. */
export function withThinking(config: Row, mode: ThinkingMode): Row {
  const display: Row = { ...(object(config.display) ?? {}) }
  display.show_reasoning = mode === 'show'
  if (mode !== 'show') display.conduit_thinking_on_request = mode === 'on_request'
  return { ...config, display }
}

/** The open chat's profile display settings, read again on each `refresh` change (a visit to Settings). */
export function useChatDisplay(profile: string | undefined, connected: boolean, refresh: unknown): ChatDisplay {
  const [display, setDisplay] = useState<ChatDisplay>(DEFAULT_DISPLAY)
  useEffect(() => {
    if (!connected) return
    let live = true
    const path = profile && profile !== 'default' ? `/api/config?profile=${encodeURIComponent(profile)}` : '/api/config'
    gateway
      .http('GET', path)
      .then(config => live && setDisplay(chatDisplay(config)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [profile, connected, refresh])
  return display
}
