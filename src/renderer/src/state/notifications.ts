/**
 * System notifications: a turn that finished, and something that needs the
 * user, in a chat they aren't looking at (or with the window away). A click
 * brings the window back on that chat.
 */
import type { PendingRequest } from '../../../shared/ipc'
import { approvalView, clarifyQuestions } from './needsYou'
import { plainLine } from './text'
import { t } from '../../../shared/i18n'

export { plainLine }

export interface ChatRef {
  storedId: string | null
  profile?: string
  title?: string
}

export interface NotificationSpec {
  title: string
  body: string
  /** One notification per chat and kind: a newer one replaces it. */
  tag: string
}

const SETTING_KEY = 'conduit.notifications'

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setNotificationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(SETTING_KEY, on ? 'on' : 'off')
  } catch {
    // Private storage: the default (on) stands.
  }
}


/** A finished turn's notification, or none (a stop needs no telling). */
export function turnNotification(sessionId: string, payload: unknown, chat: ChatRef | undefined): NotificationSpec | null {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  if (p.status === 'interrupted') return null
  const title = chat?.title || 'Hermes'
  const tag = `turn-${sessionId}`
  if (p.status === 'error') {
    const reason = typeof p.error === 'string' ? p.error : t('The turn failed.')
    return { title, body: plainLine(reason), tag }
  }
  const text = typeof p.text === 'string' ? p.text : typeof p.rendered === 'string' ? p.rendered : ''
  return { title, body: plainLine(text) || t('Replied.'), tag }
}

export function requestNotification(request: PendingRequest, chat: ChatRef | undefined): NotificationSpec {
  const where = chat?.title ? ` · ${chat.title}` : ''
  if (request.method === 'approval') {
    const view = approvalView(request.params)
    return { title: `${t('Needs your OK')}${where}`, body: plainLine(view.command ? `${view.description}: ${view.command}` : view.description), tag: `ask-${request.id}` }
  }
  const questions = clarifyQuestions(request.params)
  const first = questions[0]?.question ?? t('Hermes has a question.')
  return {
    title: `${questions.length > 1 ? t('{count} questions', { count: questions.length }) : t('A question')}${where}`,
    body: plainLine(first),
    tag: `ask-${request.id}`
  }
}

/** Whether the user is looking at this chat right now, so a notification would only repeat the screen. */
export function isWatching(sessionId: string, openLiveId: string | null, onChats: boolean): boolean {
  return onChats && sessionId === openLiveId && !document.hidden && document.hasFocus()
}
