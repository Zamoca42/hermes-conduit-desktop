/**
 * Passwords, logins and codes Hermes asks for, after the phone's
 * InputPromptActivity and InputPromptCard (#1301): a sudo password, a secret
 * (an env var a skill or setup needs), a password manager's master password,
 * a website's login (Hermes is on its sign-in page and has none saved) or its
 * one-time code. Each is a server request answered `{value}`; an empty value
 * skips. What the user types lives only in the card and goes once to the
 * request: never into the chat, a log, storage or a notification.
 */
import type { PendingRequest } from '../../../shared/ipc'
import { t } from '../../../shared/i18n'

export type InputKind = 'sudo' | 'secret' | 'vault.unlock_prompt' | 'vault.save_login' | 'vault.code'

export interface InputPromptView {
  kind: InputKind
  title: string
  /** A line under the title: the command for sudo, the env var for a secret, the origin a login is saved for. */
  detail: string
  /** Why it's asked, for a login or a code. */
  note: string
  placeholder: string
  send: string
  skip: string
  /** A login's identifier field. */
  login: boolean
  /** A code shows as typed; the rest are masked. */
  masked: boolean
}

const text = (params: Record<string, unknown>, key: string) => (typeof params[key] === 'string' ? (params[key] as string).trim() : '')

/** A login's site: its origin's own host, never a separately sent name; the origin itself without one. */
export function loginSite(origin: string): string {
  try {
    return new URL(origin).host || origin
  } catch {
    return origin
  }
}

/** The card for a request, or null when it isn't one (a login with no origin can't say which site gets it). */
export function inputPromptView(request: Pick<PendingRequest, 'method' | 'params'>): InputPromptView | null {
  const p = request.params ?? {}
  const base = { detail: '', note: '', send: t('Send'), skip: t('Skip'), login: false, masked: true }
  switch (request.method) {
    case 'sudo':
      return { ...base, kind: 'sudo', title: t('Hermes needs your sudo password'), detail: text(p, 'command'), placeholder: t('sudo password') }
    case 'secret': {
      const prompt = text(p, 'prompt')
      return { ...base, kind: 'secret', title: prompt || t('Hermes needs a secret value'), detail: text(p, 'env_var'), placeholder: t('Secret value') }
    }
    case 'vault.unlock_prompt': {
      const name = text(p, 'display_name') || text(p, 'backend')
      return {
        ...base,
        kind: 'vault.unlock_prompt',
        title: name ? t('Unlock {name}', { name }) : t('Unlock your password manager'),
        placeholder: t('Master password')
      }
    }
    case 'vault.save_login': {
      const origin = text(p, 'origin')
      if (!origin) return null
      return {
        ...base,
        kind: 'vault.save_login',
        title: t('Save your {site} login?', { site: loginSite(origin) }),
        detail: origin,
        note: t(
          "Hermes reached this sign-in page and has no login for it. It's saved encrypted where Hermes runs and filled into the page; the model never sees the password."
        ),
        placeholder: t('Password'),
        send: t('Save & sign in'),
        skip: t("Don't save"),
        login: true
      }
    }
    case 'vault.code': {
      const site = text(p, 'site')
      return {
        ...base,
        kind: 'vault.code',
        title: site ? t('Verification code for {site}', { site }) : t('Verification code'),
        note: t(
          'The site is asking for a one-time code from a text message, email or authenticator app. Hermes types it into the page; the model never sees it.'
        ),
        placeholder: t('Verification code'),
        send: t('Enter code'),
        masked: false
      }
    }
    default:
      return null
  }
}

/** A login's answer: JSON {identifier, password}, the identifier trimmed, the password as typed; null while either is missing (spaces alone are no password). */
export function loginAnswer(identifier: string, password: string): string | null {
  const id = identifier.trim()
  if (!id || !password.trim()) return null
  return JSON.stringify({ identifier: id, password })
}

/** A code without the spaces and dashes a site groups it with ("123 456"), as Hermes types it. */
export const codeAnswer = (typed: string) => typed.replace(/[\s-]/g, '')

/** What Send gives the request, or null while there's nothing to send. */
export function inputAnswer(kind: InputKind, value: string, identifier = ''): string | null {
  if (kind === 'vault.save_login') return loginAnswer(identifier, value)
  if (kind === 'vault.code') return codeAnswer(value) || null
  return value.trim() ? value : null
}
