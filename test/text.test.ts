import { describe, expect, it } from 'vitest'
import { cleanUserText, previewText } from '../src/renderer/src/state/text'
import { applyEvent, emptyTranscript, fromHistory } from '../src/renderer/src/state/transcript'

const VOICE_BRIEF =
  '[Background job started from a Conduit voice conversation. Nobody is watching this chat live, so work on it on your own. When you are done, end your final message with a plain-language summary that can be read aloud: what you found or did, with the key details.]'

describe('cleanUserText', () => {
  it('takes off the voice background-job brief', () => {
    expect(cleanUserText(`${VOICE_BRIEF}\n\nFind me a flight to Tokyo`)).toEqual({ text: 'Find me a flight to Tokyo', attachments: [] })
  })

  it('splits leading @file: lines into attachments, in every quoting', () => {
    const raw = '@file:`/home/me/My Docs/report.pdf`\n@file:"/tmp/a b.png"\n@file:/tmp/c.txt\n\nSummarize these'
    expect(cleanUserText(raw)).toEqual({
      text: 'Summarize these',
      attachments: [
        { kind: 'file', value: '/home/me/My Docs/report.pdf' },
        { kind: 'file', value: '/tmp/a b.png' },
        { kind: 'file', value: '/tmp/c.txt' }
      ]
    })
  })

  it('cuts the attached context Hermes stores after a reference', () => {
    const raw = '@url:https://example.com\nWhat does this say?\n\n--- Attached Context ---\n\n# Example Domain\nlots of page text'
    expect(cleanUserText(raw)).toEqual({ text: 'What does this say?', attachments: [{ kind: 'url', value: 'https://example.com' }] })
  })

  it('leaves a footer-looking line alone when the message names no reference', () => {
    const raw = 'Please keep this:\n--- Attached Context ---\nas is'
    expect(cleanUserText(raw).text).toBe(raw)
  })

  it('keeps an @ mid-message as words', () => {
    expect(cleanUserText('email me at a@b.com').text).toBe('email me at a@b.com')
  })
})

describe('previewText', () => {
  it('drops a voice brief cut off before its closing bracket', () => {
    expect(previewText(VOICE_BRIEF.slice(0, 80))).toBe('')
  })

  it('falls back to the first attachment’s name', () => {
    expect(previewText('@file:/Users/me/Desktop/notes.md')).toBe('notes.md')
  })

  it('folds lines', () => {
    expect(previewText('one\ntwo\n\nthree')).toBe('one two three')
  })
})

describe('user messages in the transcript', () => {
  it('cleans stored rows', () => {
    const items = fromHistory([{ role: 'user', text: `${VOICE_BRIEF}\n\n@file:/tmp/x.pdf\nRead it`, row_id: 1 }])
    expect(items).toEqual([
      { kind: 'user', key: 'row-1', text: 'Read it', at: undefined, attachments: [{ kind: 'file', value: '/tmp/x.pdf' }] }
    ])
  })

  it('cleans a message sent from the phone', () => {
    const state = applyEvent(emptyTranscript, { type: 'user.message', payload: { text: '@file:/tmp/y.png' } })
    expect(state.items[0]).toMatchObject({ kind: 'user', text: '', attachments: [{ kind: 'file', value: '/tmp/y.png' }] })
  })
})

describe('folded previews', () => {
  it('takes references off a preview the dashboard put on one line', () => {
    expect(previewText('@file:/tmp/notes/plan.md @url:https://x.dev Send the media please')).toBe('Send the media please')
    expect(previewText('@file:/tmp/notes/plan.md Send it --- Context Warnings --- ⚠️ @file:/tmp/notes/plan.md: not found')).toBe('Send it')
  })

  it('shows a pending message cleaned', async () => {
    const { addPendingUser } = await import('../src/renderer/src/state/transcript')
    const state = addPendingUser(emptyTranscript, '@file:/tmp/a.md\nhello')
    expect(state.items[0]).toMatchObject({ text: 'hello', pending: true, attachments: [{ kind: 'file', value: '/tmp/a.md' }] })
  })
})

describe('the second Asuka round', () => {
  it('reads a reference mid-sentence as its value', () => {
    expect(cleanUserText('can we update the plugin with main + @url:`https://github.com/a/b/pull/1`?').text).toBe(
      'can we update the plugin with main + https://github.com/a/b/pull/1?'
    )
    expect(previewText('how can we adapt this skill? @url:`https://github.com/Leonxl/skills/tree/main/x')).toBe(
      'how can we adapt this skill? github.com/Leonxl/skills/tree/main/x'
    )
  })

  it('leaves no footer stub in a preview cut inside the marker', () => {
    expect(previewText('@url:`https://example.com/a` --- Attached Co')).toBe('example.com/a')
    expect(previewText('Relay update @url:`https://x.dev/y` --- Attached Context --- lots')).toBe('Relay update x.dev/y')
  })

  it('takes a reference cut off inside its quotes as the whole preview', () => {
    expect(previewText('@url:`https://github.com/kaishi00/hermes-conduit-notifier/pull/86')).toBe(
      'github.com/kaishi00/hermes-conduit-notifier/pull/86'
    )
  })

  it('cuts the recent voice conversation a delegation appends', () => {
    const raw =
      'Where am I\n\n[Recent voice conversation, for context only. Do just the request above: earlier requests marked "handled separately" were passed on before.]\nAssistant: Hi\nUser: Where am I'
    expect(cleanUserText(raw).text).toBe('Where am I')
    expect(previewText(raw.replace(/\n+/g, ' ').slice(0, 60))).toBe('Where am I')
  })
})

describe('cleanTitle', () => {
  it('cuts a voice delegation’s conversation from a title', async () => {
    const { cleanTitle } = await import('../src/renderer/src/state/text')
    expect(cleanTitle('Where am I [Recent voice conv')).toBe('Where am I')
    expect(cleanTitle('Relay/Plugin Update')).toBe('Relay/Plugin Update')
  })
})
