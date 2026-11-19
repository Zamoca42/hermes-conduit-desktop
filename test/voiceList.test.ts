import { describe, expect, it } from 'vitest'
import { isArchivedVoiceChat, parseVoiceTags, underSource, withVoice, type VoiceList } from '../src/renderer/src/state/voiceList'
import { sourcesIn } from '../src/renderer/src/state/chatSources'
import { rowsFromResponse, type ChatRow } from '../src/renderer/src/state/chats'

const row = (id: string, extra: Partial<ChatRow> = {}): ChatRow => ({ id, title: id, pinned: false, sourceKind: 'chat', ...extra })

const parsed = parseVoiceTags({
  tags: {
    call1: { kind: 'call', engine: 'gemini-live' },
    classic1: { kind: 'classic' },
    job1: { kind: 'job', parent_id: 'call1', parent_title: 'Old title' },
    bad: { kind: 'nope' }
  },
  chat_calls: [{ chat_id: 'kept', call_id: 'c', started_at: 1 }]
})
const voice: VoiceList = { tags: new Map([['default', parsed.tags]]), callChats: new Map([['default', parsed.callChats]]) }

describe('voice in the chats list', () => {
  it('reads the plugin’s tags and the chats calls were kept with', () => {
    expect([...parsed.tags.keys()]).toEqual(['call1', 'classic1', 'job1'])
    expect(parsed.tags.get('job1')).toEqual({ kind: 'job', engine: null, parentId: 'call1', parentTitle: 'Old title' })
    expect([...parsed.callChats]).toEqual(['kept'])
    expect(parseVoiceTags(null).tags.size).toBe(0)
  })

  it('files tagged rows under Voice or Voice Jobs with the line voice says, and keeps a call’s chat its own source', () => {
    const rows = withVoice([row('call1', { title: 'Call' }), row('job1'), row('classic1'), row('kept', { sourceKind: 'telegram' }), row('plain')], [], voice)
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(by.call1!.sourceKind).toBe('voice')
    expect(by.call1!.preview).toBe('Gemini Live')
    expect(by.job1!.sourceKind).toBe('voice_job')
    expect(by.job1!.preview).toBe('From Call')
    expect(by.classic1!.sourceKind).toBe('voice')
    expect(by.kept!.sourceKind).toBe('telegram')
    expect(underSource(by.kept!, 'voice')).toBe(true)
    expect(underSource(by.kept!, 'telegram')).toBe(true)
    expect(underSource(by.plain!, 'voice')).toBe(false)
    expect(sourcesIn([by.kept!, by.plain!])).toEqual(['chat', 'voice', 'telegram'])
  })

  it('lists the rows the plugin archived for voice, by recency, and leaves the user’s archive alone', () => {
    const archived = [
      row('call1', { autoArchived: true, activeAt: 50 }),
      row('ended', { autoArchived: true, endReason: 'conduit_voice', activeAt: 30 }),
      row('classic1', { autoArchived: true, activeAt: 5 }),
      row('swept', { autoArchived: true, activeAt: 40 }),
      row('mine', { activeAt: 60, endReason: 'conduit_voice' })
    ]
    expect(isArchivedVoiceChat(archived[0]!, voice)).toBe(false)
    const listed = withVoice([row('a', { activeAt: 100 }), row('b', { activeAt: 10 })], archived, voice)
    expect(listed.map(r => r.id)).toEqual(['a', 'ended', 'b', 'classic1'])
  })

  it('reads the auto-archive stamp and end reason from Hermes’ rows', () => {
    const [r] = rowsFromResponse({ sessions: [{ id: 'x', title: 'X', auto_archived: 1, end_reason: 'conduit_voice' }] })
    expect(r!.autoArchived).toBe(true)
    expect(r!.endReason).toBe('conduit_voice')
  })
})
