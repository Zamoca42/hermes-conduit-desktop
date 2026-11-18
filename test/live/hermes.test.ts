/**
 * Runs the connection against a real Hermes dashboard, signed in the way
 * CONDUIT_LIVE_* says, and plays one turn through the transcript reducer.
 * Skipped unless CONDUIT_LIVE_URL is set:
 *
 *   CONDUIT_LIVE_URL=http://127.0.0.1:9119 pnpm test test/live
 *   (CONDUIT_LIVE_USER + CONDUIT_LIVE_PASSWORD, or CONDUIT_LIVE_TOKEN, for a gated one)
 *
 * The prompt asks for a tool step; any model answers it somehow.
 */
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { Connection, type SavedConnection } from '../../src/main/connection'
import { probeHost } from '../../src/main/auth'
import type { ConnectionStatus, GatewayEventMessage } from '../../src/shared/ipc'
import { applyEvent, emptyTranscript, fromHistory, type TranscriptState } from '../../src/renderer/src/state/transcript'
import { rowsFromResponse, CHAT_LIST_PATH } from '../../src/renderer/src/state/chats'
import type { WebSocketLike } from '../../src/vendor/hermes-shared/json-rpc-gateway'

const url = process.env.CONDUIT_LIVE_URL

describe.skipIf(!url)('a live Hermes dashboard', () => {
  it('signs in, lists chats, runs a turn and resumes it', async () => {
    const probe = await probeHost(url!, fetch)
    expect(probe.ok).toBe(true)
    if (!probe.ok) return
    const method = process.env.CONDUIT_LIVE_TOKEN ? 'token' : process.env.CONDUIT_LIVE_USER ? 'password' : 'open'
    expect(probe.methods).toContain(method)

    const statuses: ConnectionStatus[] = []
    const events: GatewayEventMessage[] = []
    let saved: SavedConnection | null = null
    const connection = new Connection({
      fetch,
      store: { load: () => saved, save: s => (saved = s), clear: () => (saved = null) },
      createSocket: (u, headers) => new WebSocket(u, { headers }) as unknown as WebSocketLike,
      onStatus: s => statuses.push(s),
      onEvent: e => events.push(e)
    })
    const signedIn = await connection.signIn({
      url: probe.url,
      method,
      username: process.env.CONDUIT_LIVE_USER,
      password: process.env.CONDUIT_LIVE_PASSWORD,
      token: process.env.CONDUIT_LIVE_TOKEN
    })
    expect(signedIn).toEqual({ ok: true })
    expect(connection.current().phase).toBe('open')

    const list = rowsFromResponse(await connection.http('GET', CHAT_LIST_PATH))
    expect(Array.isArray(list)).toBe(true)

    const authority = connection.current().sessionAuthority === true
    const created = await connection.rpc<{ session_id: string; stored_session_id: string }>(
      'session.create',
      authority ? { source: 'gui' } : { cols: 96, source: 'desktop' }
    )
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message.complete in 60 s')), 60_000)
      const poll = setInterval(() => {
        if (events.some(e => e.type === 'message.complete' && e.session_id === created.session_id)) {
          clearTimeout(timer)
          clearInterval(poll)
          resolve()
        }
      }, 100)
    })
    await connection.rpc('prompt.submit', {
      session_id: created.session_id,
      text: 'Use a tool: run `echo hello from the tool`, then answer with a small table.',
      ...(authority ? { submission_id: crypto.randomUUID() } : {})
    })
    await done

    let state: TranscriptState = emptyTranscript
    for (const event of events.filter(e => e.session_id === created.session_id)) state = applyEvent(state, event)
    console.log(JSON.stringify(state.items.map(i => ({ kind: i.kind, text: 'text' in i ? i.text.slice(0, 80) : undefined, name: 'name' in i ? i.name : undefined }))))
    expect(state.running).toBe(false)
    expect(state.items.some(i => i.kind === 'assistant')).toBe(true)

    const resumed = await connection.rpc<{ messages: Parameters<typeof fromHistory>[0] }>('session.resume', {
      session_id: created.stored_session_id,
      cols: 96,
      source: 'desktop'
    })
    const history = fromHistory(resumed.messages)
    console.log(JSON.stringify(history.map(i => i.kind)))
    expect(history.some(i => i.kind === 'user')).toBe(true)
    expect(history.some(i => i.kind === 'assistant')).toBe(true)

    connection.signOut()
  }, 90_000)
})
