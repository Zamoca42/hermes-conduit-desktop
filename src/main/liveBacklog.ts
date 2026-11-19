/**
 * Live-call sends on a slow connection, after the phone's ("Live-call sends
 * on a slow connection", #1231): when the socket stops taking frames,
 * microphone audio past about two seconds' worth is dropped as it arrives,
 * since the model can't use audio that late, and a text turn, a tool answer
 * or a picture that finds the socket holding far more than that means it
 * stopped: the socket is closed, so the call says so or connects again,
 * rather than holding them without end.
 */

/** About two seconds of a call's microphone frames (24 kHz PCM16 as base64 JSON). */
export const AUDIO_BACKLOG_BYTES = 192 * 1024
/** Past this, a frame that isn't audio finds a socket that stopped taking them. */
export const STALLED_BYTES = 2 * 1024 * 1024
export const STALLED_CLOSE_CODE = 4000
export const STALLED_REASON = 'The connection stopped taking what the call sends.'

const AUDIO_PREFIXES = ['{"type":"input_audio_buffer.append"', '{"realtimeInput":{"audio":']

/** A microphone frame, in every live mode's shape. */
export const isAudioFrame = (data: string) => AUDIO_PREFIXES.some(prefix => data.startsWith(prefix))

/** Send it, drop it (late audio), or close the socket (it stopped taking frames). */
export function liveSendDecision(buffered: number, data: string | Uint8Array): 'send' | 'drop' | 'stalled' {
  if (typeof data === 'string' && isAudioFrame(data)) return buffered > AUDIO_BACKLOG_BYTES ? 'drop' : 'send'
  return buffered > STALLED_BYTES ? 'stalled' : 'send'
}
