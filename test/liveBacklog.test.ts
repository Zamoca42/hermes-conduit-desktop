import { describe, expect, it } from 'vitest'
import { AUDIO_BACKLOG_BYTES, STALLED_BYTES, isAudioFrame, liveSendDecision } from '../src/main/liveBacklog'

const grokAudio = JSON.stringify({ type: 'input_audio_buffer.append', audio: 'AAAA' })
const geminiAudio = JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: 'AAAA' } } })
const turn = JSON.stringify({ type: 'conversation.item.create', item: { type: 'message' } })

describe('live-call sends on a slow connection', () => {
  it('knows every live mode’s microphone frames', () => {
    expect(isAudioFrame(grokAudio)).toBe(true)
    expect(isAudioFrame(geminiAudio)).toBe(true)
    expect(isAudioFrame(turn)).toBe(false)
    expect(isAudioFrame(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))).toBe(false)
  })

  it('drops audio past about two seconds held, and keeps sending it while the socket keeps up', () => {
    expect(liveSendDecision(0, grokAudio)).toBe('send')
    expect(liveSendDecision(AUDIO_BACKLOG_BYTES, geminiAudio)).toBe('send')
    expect(liveSendDecision(AUDIO_BACKLOG_BYTES + 1, grokAudio)).toBe('drop')
  })

  it('never drops a turn, a tool answer or a picture: one that finds the socket stopped ends it', () => {
    expect(liveSendDecision(AUDIO_BACKLOG_BYTES + 1, turn)).toBe('send')
    expect(liveSendDecision(STALLED_BYTES, turn)).toBe('send')
    expect(liveSendDecision(STALLED_BYTES + 1, turn)).toBe('stalled')
    expect(liveSendDecision(STALLED_BYTES + 1, new Uint8Array(4))).toBe('stalled')
  })
})
