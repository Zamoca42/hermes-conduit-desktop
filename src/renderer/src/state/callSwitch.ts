/**
 * A dashboard picked while a call runs, after the phone's
 * CallEndingSwitchConfirmation (issue 2390): the switch tears the call down
 * (one connection to one dashboard), so the pick asks first rather than
 * ending the call without a word. End Call and Switch ends the call, then
 * switches; Cancel leaves both as they are. The desktop's profile strip only
 * filters what's listed, so no profile pick ends a call.
 */
import { t } from '../../../shared/i18n'

let endCall: (() => void) | null = null

/** The shell says whether a call runs, and how to end it. */
export function setRunningCall(end: (() => void) | null): void {
  endCall = end
}

export const callRunning = (): boolean => endCall !== null

/**
 * Whether a switch to `destination` (a dashboard's name; null for one not
 * signed in to yet) may go ahead: at once with no call, or once the user
 * said End Call and Switch, the call ended first.
 */
export function switchEndingCall(destination: string | null, confirm: (message: string) => boolean = message => window.confirm(message)): boolean {
  const end = endCall
  if (!end) return true
  const question = t('End the call and switch?')
  if (!confirm(destination ? `${question}\n\n${t("Switching to {destination} ends the call that's running.", { destination })}` : question)) return false
  end()
  endCall = null
  return true
}
