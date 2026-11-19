import { describe, expect, it } from 'vitest'
import {
  appTitle,
  asksApproval,
  connectionFrom,
  hasRequiredValues,
  opensPage,
  reissues,
  rowAnswer,
  type ConnectionCard
} from '../src/renderer/src/state/connections'
import { emptyTranscript, openConnection, showConnection, applyEvent } from '../src/renderer/src/state/transcript'

const frame = (over: Record<string, unknown> = {}) => ({
  op_id: 'op1',
  seq: 1,
  owner: { type: 'session', session_id: 'live1' },
  targets: [
    { name: 'google_drive', kind: 'connector', action: 'authorize', state: 'initiated', connect_url: 'https://portal.example/connect' },
    {
      name: 'weather',
      kind: 'mcp',
      action: 'install',
      state: 'pending',
      required_env: [
        { name: 'API_KEY', required: true, secret: true, default: 'leak' },
        { name: 'CITY', default: 'Lyon' }
      ]
    }
  ],
  ...over
})

describe('connection cards', () => {
  it("reads Hermes' snapshot, never starting a secret from a value Hermes sent", () => {
    const card = connectionFrom(frame(), 'other')!
    expect(card.sessionId).toBe('live1')
    expect(card.targets[0]!.connectUrl).toBe('https://portal.example/connect')
    expect(card.targets[1]!.fields).toEqual([
      { name: 'API_KEY', required: true, secret: true, defaultValue: '', prompt: undefined },
      { name: 'CITY', required: false, secret: false, defaultValue: 'Lyon', prompt: undefined }
    ])
    expect(connectionFrom({ ...frame(), owner: { type: 'cron' } }, 'x')).toBeNull()
    expect(connectionFrom({ seq: 1 }, 'x')).toBeNull()
    expect(connectionFrom({ ...frame(), targets: [{ name: 'x', connect_url: 'javascript:alert(1)' }] }, 'x')!.targets[0]!.connectUrl).toBeUndefined()
    expect(appTitle('google_drive')).toBe('Google Drive')
  })

  it('offers what each row needs', () => {
    const [app, server] = connectionFrom(frame(), 'x')!.targets
    expect(opensPage(app!)).toBe(true)
    expect(asksApproval(app!)).toBe(false)
    expect(asksApproval(server!)).toBe(true)
    expect(reissues({ ...app!, state: 'expired' })).toBe(true)
    expect(asksApproval({ ...server!, state: 'pending', action: 'authorize' })).toBe(false)
    expect(hasRequiredValues(server!.fields, { API_KEY: ' ', CITY: 'Lyon' })).toBe(false)
    expect(hasRequiredValues(server!.fields, { API_KEY: 'k' })).toBe(true)
    expect(rowAnswer('weather', true, { API_KEY: 'k', CITY: '' })).toEqual({ name: 'weather', status: 'approved', env: { API_KEY: 'k' } })
    expect(rowAnswer('weather', false, { API_KEY: 'k' })).toEqual({ name: 'weather', status: 'skipped' })
  })

  it('updates its own card, ignores an older frame, and keeps a page a later frame left out', () => {
    let state = applyEvent(emptyTranscript, { type: 'connection.request', payload: frame(), session_id: 'live1' })
    expect(state.items.length).toBe(1)
    const later = frame({ seq: 3, targets: [{ name: 'google_drive', kind: 'connector', state: 'initiated' }] })
    state = applyEvent(state, { type: 'connection.update', payload: later, session_id: 'live1' })
    const card = (state.items[0] as { card: ConnectionCard }).card
    expect(card.seq).toBe(3)
    expect(card.targets[0]!.connectUrl).toBe('https://portal.example/connect')
    expect(applyEvent(state, { type: 'connection.update', payload: frame({ seq: 2 }), session_id: 'live1' })).toBe(state)
    expect(openConnection(state)?.opId).toBe('op1')
    state = applyEvent(state, { type: 'connection.update', payload: frame({ seq: 4, settled: true, settled_by: 'continue' }), session_id: 'live1' })
    expect(openConnection(state)).toBeNull()
    // A settled operation this chat never showed opens no card.
    expect(showConnection(emptyTranscript, connectionFrom(frame({ op_id: 'op2', settled: true }), 'x')!).items.length).toBe(0)
  })

  it('keeps a directory card one when a later frame leaves out its picks', () => {
    let state = applyEvent(emptyTranscript, {
      type: 'connection.request',
      payload: { op_id: 'd', seq: 1, display: { suggested: ['notion', 'slack'] } },
      session_id: 's'
    })
    state = applyEvent(state, { type: 'connection.update', payload: { op_id: 'd', seq: 2 }, session_id: 's' })
    expect((state.items[0] as { card: ConnectionCard }).card.suggested).toEqual(['notion', 'slack'])
  })
})
