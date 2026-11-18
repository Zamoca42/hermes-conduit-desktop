import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
  addNotice,
  addOutput,
  addPendingUser,
  applyEvent,
  emptyTranscript,
  failPendingUser,
  fromHistory,
  type HistoryRow,
  type TranscriptState
} from './transcript'
import { promptText, releaseHeldImages, titlePreview, uploadAttachments, type StagedAttachment } from './attachments'
import type { Attachment } from './text'
import { helpText, parseSlashCommand, parseSlashResult, wantsDispatch, type SlashCommand, type SlashResult } from './slash'
import { t } from '../../../shared/i18n'

type Action =
  | { type: 'reset'; state: TranscriptState }
  | { type: 'event'; event: { type: string; payload?: unknown } }
  | { type: 'pending'; text: string; attachments?: Attachment[] }
  | { type: 'failed'; error: string }
  | { type: 'output'; command?: string; text: string; format: 'plain' | 'markdown' }
  | { type: 'notice'; text: string; tone?: 'error' | 'info' }

function reducer(state: TranscriptState, action: Action): TranscriptState {
  switch (action.type) {
    case 'reset':
      return action.state
    case 'event':
      return applyEvent(state, action.event)
    case 'pending':
      return addPendingUser(state, action.text, action.attachments)
    case 'failed':
      return failPendingUser(state, action.error)
    case 'output':
      return addOutput(state, action)
    case 'notice':
      return addNotice(state, action.text, action.tone)
  }
}

interface ResumeResult {
  session_id: string
  stored_session_id?: string | null
  messages?: HistoryRow[]
  running?: boolean | null
  inflight?: { assistant?: string; streaming?: boolean } | null
  info?: { title?: string; model?: string; cwd?: string; profile_name?: string | null }
}

interface CreateResult {
  session_id: string
  stored_session_id?: string
  info?: ResumeResult['info']
}

export interface OpenChat {
  /** The stored id (the chat list's), once there is one. */
  storedId: string | null
  /** The live id the gateway's events carry. */
  liveId: string | null
  title?: string
  model?: string
  cwd?: string
}

const uuid = () => crypto.randomUUID()

/**
 * What a slash command leaves for the window: a new chat, words for the
 * composer, or the stored id of the chat it had to start.
 */
export type CommandOutcome = { kind: 'new' } | { kind: 'prefill'; text: string; created: string | null } | { kind: 'done'; created: string | null }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One open chat: resumes it, folds its live events into the transcript,
 * sends and stops. `storedId` null is a new chat, created on the first send.
 */
export function useChat(storedId: string | null, profile: string | undefined, sessionAuthority: boolean, connected: boolean) {
  const [transcript, dispatch] = useReducer(reducer, emptyTranscript)
  const [chat, setChat] = useState<OpenChat>({ storedId, liveId: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const liveId = useRef<string | null>(null)
  const request = useRef(0)
  /** A chat this hook just created: selecting it in the list mustn't resume it over its first turn. */
  const created = useRef<string | null>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat
  const runningRef = useRef(false)
  runningRef.current = transcript.running

  // Resume when the chat (or the connection) changes.
  useEffect(() => {
    if (storedId && storedId === created.current) return
    created.current = null
    const ticket = ++request.current
    liveId.current = null
    setChat({ storedId, liveId: null })
    setError(null)
    if (!storedId) {
      dispatch({ type: 'reset', state: emptyTranscript })
      return
    }
    if (!connected) return
    setLoading(true)
    const params: Record<string, unknown> = { session_id: storedId, cols: 96, source: 'desktop' }
    if (profile) params.profile = profile
    // The transcript without every stored picture's bytes; the session authority refuses the flag.
    if (!sessionAuthority) params.inline_images = false
    window.conduit
      .rpc<ResumeResult>('session.resume', params)
      .then(result => {
        if (ticket !== request.current) return
        liveId.current = result.session_id
        setChat({
          storedId: result.stored_session_id ?? storedId,
          liveId: result.session_id,
          title: result.info?.title,
          model: result.info?.model,
          cwd: result.info?.cwd
        })
        let state: TranscriptState = { items: fromHistory(result.messages ?? []), running: result.running === true }
        if (result.running && result.inflight?.assistant) {
          state = applyEvent(state, { type: 'message.delta', payload: { text: result.inflight.assistant } })
        }
        dispatch({ type: 'reset', state })
      })
      .catch(e => {
        if (ticket !== request.current) return
        dispatch({ type: 'reset', state: emptyTranscript })
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (ticket === request.current) setLoading(false)
      })
  }, [storedId, profile, sessionAuthority, connected])

  // Live events for this chat.
  useEffect(
    () =>
      window.conduit.onEvent(event => {
        if (!event.session_id || event.session_id !== liveId.current) return
        if (event.type === 'session.title') {
          const title = (event.payload as { title?: unknown } | undefined)?.title
          if (typeof title === 'string') setChat(c => ({ ...c, title }))
          return
        }
        dispatch({ type: 'event', event })
      }),
    []
  )

  /** A new chat's session, made on its first send or command. */
  const createSession = useCallback(async (): Promise<{ sid: string; storedId: string | null }> => {
    const params: Record<string, unknown> = sessionAuthority ? { source: 'gui' } : { cols: 96, source: 'desktop' }
    if (profile) params.profile = profile
    const made = await window.conduit.rpc<CreateResult>('session.create', params)
    const sid = made.session_id
    const storedId = made.stored_session_id ?? null
    liveId.current = sid
    created.current = storedId
    request.current++ // a resume still in flight is stale now
    setChat(c => ({ ...c, liveId: sid, storedId: storedId ?? c.storedId, model: made.info?.model, cwd: made.info?.cwd }))
    return { sid, storedId }
  }, [profile, sessionAuthority])

  /** The chat's history read again, after a command changed it (/undo, /retry, /compress). */
  const reloadHistory = useCallback(async () => {
    const stored = chatRef.current.storedId
    if (!stored) return
    const ticket = ++request.current
    const params: Record<string, unknown> = { session_id: stored, cols: 96, source: 'desktop' }
    if (profile) params.profile = profile
    if (!sessionAuthority) params.inline_images = false
    try {
      const result = await window.conduit.rpc<ResumeResult>('session.resume', params)
      if (ticket !== request.current) return
      liveId.current = result.session_id
      setChat(c => ({ ...c, liveId: result.session_id, title: result.info?.title ?? c.title }))
      dispatch({ type: 'reset', state: { items: fromHistory(result.messages ?? []), running: result.running === true } })
    } catch {
      // The chat as drawn stays; the next open reads it.
    }
  }, [profile, sessionAuthority])

  const send = useCallback(
    async (text: string, attachments: StagedAttachment[] = [], wire?: string): Promise<string | null> => {
      const trimmed = text.trim()
      if (!trimmed && !attachments.length) return null
      const shown: Attachment[] = attachments.map(a =>
        a.kind === 'image' ? { kind: 'image', value: a.name, preview: `data:${a.mime};base64,${a.base64}` } : { kind: 'file', value: a.name }
      )
      dispatch({ type: 'pending', text: trimmed, attachments: shown })
      let sid = liveId.current
      let held: string[] = []
      try {
        let createdStoredId: string | null = null
        if (!sid) {
          const made = await createSession()
          sid = made.sid
          createdStoredId = made.storedId
        }
        const uploaded = attachments.length
          ? await uploadAttachments((method, params) => window.conduit.rpc(method, params), sid, profile, sessionAuthority, attachments).catch(e => {
              throw new Error(t('Attachment failed: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
            })
          : null
        held = uploaded?.heldImagePaths ?? []
        const params: Record<string, unknown> = { session_id: sid, text: promptText(wire ?? trimmed, uploaded?.references ?? []) }
        if (profile) params.profile = profile
        if (sessionAuthority) params.submission_id = uuid()
        if (uploaded?.images.length) params.attachments = uploaded.images
        const preview = titlePreview(attachments)
        if (preview) params.title_preview = preview
        try {
          await window.conduit.rpc('prompt.submit', params)
        } catch (e) {
          // A Hermes that doesn't know the title preview gets the message without it.
          if (!preview || !String(e instanceof Error ? e.message : e).includes('title_preview')) throw e
          delete params.title_preview
          await window.conduit.rpc('prompt.submit', params)
        }
        return createdStoredId
      } catch (e) {
        // Pictures held for this message would ride on the next one.
        if (sid && held.length) await releaseHeldImages((method, params) => window.conduit.rpc(method, params), sid, profile, held)
        dispatch({ type: 'failed', error: e instanceof Error ? e.message : String(e) })
        return null
      }
    },
    [profile, sessionAuthority, createSession]
  )

  const stop = useCallback(async () => {
    const sid = liveId.current
    if (!sid) return
    const params: Record<string, unknown> = { session_id: sid }
    if (profile) params.profile = profile
    try {
      await window.conduit.rpc('session.interrupt', params)
    } catch (e) {
      dispatch({ type: 'event', event: { type: 'error', payload: { message: e instanceof Error ? e.message : String(e) } } })
    }
  }, [profile])

  /** Runs a typed `/command`: Conduit's own, else Hermes' `slash.exec` (`command.dispatch` when that turns it down). */
  const command = useCallback(
    async (text: string, commands: SlashCommand[] = []): Promise<CommandOutcome> => {
      const typed = text.trim()
      const { name, arg } = parseSlashCommand(typed)
      const output = (body: string, format: 'plain' | 'markdown' = 'plain') => dispatch({ type: 'output', command: typed, text: body, format })
      const failed = (e: unknown) => dispatch({ type: 'notice', text: t('Command failed: {reason}', { reason: message(e) }), tone: 'error' })
      switch (name) {
        case 'new':
        case 'reset':
        case 'clear':
          return { kind: 'new' }
        case 'help':
        case 'commands':
          output(helpText(commands), 'markdown')
          return { kind: 'done', created: null }
        case 'stop': {
          // The reply, then this chat's background processes: what Hermes' own /stop means.
          const sid = liveId.current
          if (!sid) {
            output(t('Nothing was running.'), 'markdown')
            return { kind: 'done', created: null }
          }
          const lines: string[] = []
          if (runningRef.current) {
            await stop()
            lines.push(t('Stopped the reply.'))
          }
          try {
            const result = await window.conduit.rpc<{ killed?: number }>('process.stop', profile ? { session_id: sid, profile } : { session_id: sid })
            if ((result.killed ?? 0) > 0) lines.push(t('Background processes stopped: {count}', { count: result.killed ?? 0 }))
          } catch (e) {
            if (!/method not found|unknown method|-32601/i.test(message(e))) lines.push(t('Command failed: {reason}', { reason: message(e) }))
          }
          output(lines.length ? lines.join('\n\n') : t('Nothing was running.'), 'markdown')
          return { kind: 'done', created: null }
        }
      }
      let sid = liveId.current
      let created: string | null = null
      const done: CommandOutcome = { kind: 'done', created: null }
      try {
        if (!sid) {
          const made = await createSession()
          sid = made.sid
          created = made.storedId
          done.created = created
        }
      } catch (e) {
        failed(e)
        return done
      }
      const scoped = (params: Record<string, unknown>) => (profile ? { ...params, profile } : params)

      // Side agents answer on the chat as an event; through slash.exec the answer would be lost.
      if ((name === 'btw' || name === 'background' || name === 'bg') && arg) {
        try {
          await window.conduit.rpc(name === 'btw' ? 'prompt.btw' : 'prompt.background', scoped({ session_id: sid, text: arg }))
          output(name === 'btw' ? t('Answering from a snapshot of this chat. The answer will appear here.') : t('Started in the background. The answer will appear here.'), 'markdown')
          return done
        } catch (e) {
          if (!/method not found|unknown method|-32601/i.test(message(e))) {
            failed(e)
            return done
          }
        }
      }

      let result: SlashResult | null
      let current = typed
      for (let hops = 0; ; hops++) {
        try {
          const parsed = parseSlashCommand(current)
          let raw: unknown
          try {
            raw = await window.conduit.rpc('slash.exec', scoped({ session_id: sid, command: current }))
          } catch (e) {
            if (!wantsDispatch(e)) throw e
            raw = await window.conduit.rpc('command.dispatch', scoped({ session_id: sid, name: parsed.name, arg: parsed.arg }))
          }
          result = parseSlashResult(raw)
        } catch (e) {
          failed(e)
          return done
        }
        if (result?.type !== 'alias' || hops >= 2) break
        current = `/${result.target.replace(/^\/+/, '')}${parseSlashCommand(current).arg ? ` ${parseSlashCommand(current).arg}` : ''}`
      }
      if (!result) return done
      // /undo, /retry and /compress change the history Hermes keeps: read it again.
      const rewrites = ['undo', 'retry', 'compress', 'compact'].includes(name)
      switch (result.type) {
        case 'alias':
          return done
        case 'output':
          if (rewrites) await reloadHistory()
          if (result.output) output(result.output)
          return done
        case 'prefill':
          await reloadHistory()
          if (result.notice) dispatch({ type: 'notice', text: result.notice })
          return { kind: 'prefill', text: result.message, created }
        case 'send':
          if (rewrites) await reloadHistory()
          if (result.notice) dispatch({ type: 'notice', text: result.notice })
          await send(result.display ?? result.message, [], result.message)
          return done
      }
    },
    [profile, createSession, reloadHistory, send, stop]
  )

  return { transcript, chat, loading, error, send, stop, command }
}
