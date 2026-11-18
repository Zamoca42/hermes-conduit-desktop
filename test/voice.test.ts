import { describe, expect, it } from 'vitest'
import { durationLabel, parseVoiceMessage, spokenText, transcriptionTimeout, voiceFileName, voicePromptText } from '../src/renderer/src/state/voice'

describe('voice', () => {
  it('words a voice message as the phone does, and reads it back', () => {
    expect(durationLabel(14.4)).toBe('0:14')
    expect(durationLabel(723)).toBe('12:03')
    expect(durationLabel(3723)).toBe('1:02:03')
    const sent = voicePromptText(14, ' Call Dana about Friday ')
    expect(sent).toBe('[Voice message, 0:14. Transcript:]\nCall Dana about Friday')
    expect(parseVoiceMessage(sent)).toEqual({ duration: '0:14', transcript: 'Call Dana about Friday' })
    const silent = voicePromptText(3, '')
    expect(silent).toBe('[Voice message, 0:03. No transcript: listen to the attached audio file if you can.]')
    expect(parseVoiceMessage(silent)).toEqual({ duration: '0:03', transcript: '' })
    expect(parseVoiceMessage('Just text')).toBeNull()
  })

  it('names the file so the chat knows it as a voice message', () => {
    expect(voiceFileName('webm', new Date(2026, 10, 18, 9, 5, 7))).toBe('voice-message-20261118-090507.webm')
  })

  it('waits for a long transcription, within limits', () => {
    expect(transcriptionTimeout(1000)).toBe(180_000)
    expect(transcriptionTimeout(3_000_000)).toBe(300_000)
    expect(transcriptionTimeout(100_000_000)).toBe(600_000)
  })

  it('speaks the words, not the Markdown', () => {
    expect(spokenText('## Plan\n\n- **Book** the [hotel](https://x.y)\n- Run `make`\n\n```sh\nrm -rf /\n```\nDone, see https://x.y')).toBe('Plan\n\nBook the hotel\nRun make\n\nDone, see')
  })
})
