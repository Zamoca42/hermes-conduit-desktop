/**
 * A dashboard picked while a call runs, after the phone's
 * CallEndingSwitchConfirmation (issue 2390): the switch tears the call down
 * (one connection to one dashboard), so the pick asks first rather than
 * ending the call without a word. End Call and Switch ends the call, then
 * switches; Cancel leaves both as they are. The desktop's profile strip only
 * filters what's listed, so no profile pick ends a call.
 */
import { t } from '../../../shared/i18n'
import { ask } from './dialogs'

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
export async function switchEndingCall(
  destination: string | null,
  confirm: (message: string) => boolean | Promise<boolean> = message => ask(message, { confirm: t('End Call and Switch'), destructive: true })
): Promise<boolean> {
  const end = endCall
  if (!end) return true
  const question = t('End the call and switch?')
  if (!(await confirm(destination ? `${question}\n\n${t("Switching to {destination} ends the call that's running.", { destination })}` : question))) return false
  // The call may have ended while the question was up.
  if (endCall !== end) return true
  end()
  endCall = null
  return true
}
