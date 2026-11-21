import { gateway } from '../gateway'
import { askedQuestionsBlock, waitingFromResponse, waitingPath } from './needsYou'

/**
 * The questions `profile`'s bot asked that wait past their turn, as a live
 * call's instructions block (askedQuestionsBlock), read from the plugin's
 * waiting list as the call starts. Empty when none waits or the list can't be read.
 */
export async function askedQuestionsForCall(profile?: string): Promise<string> {
  try {
    const name = profile && profile !== 'default' ? profile : undefined
    return askedQuestionsBlock(waitingFromResponse(await gateway.http('GET', waitingPath(name)), name))
  } catch {
    return ''
  }
}
