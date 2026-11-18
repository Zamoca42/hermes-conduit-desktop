import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import {
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
import { t } from '../../../shared/i18n'

type Action =
  | { type: 'reset'; state: TranscriptState }
  | { type: 'event'; event: { type: string; payload?: unknown } }
  | { type: 'pending'; text: string; attachments?: Attachment[] }
  | { type: 'failed'; error: string }

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

  const send = useCallback(
    async (text: string, attachments: StagedAttachment[] = []): Promise<string | null> => {
      const trimmed = text.trim()
      if (!trimmed && !attachments.length) return null
      const shown: Attachment[] = attachments.map(a => ({ kind: a.kind === 'image' ? 'image' : 'file', value: a.name }))
      dispatch({ type: 'pending', text: trimmed, attachments: shown })
      let sid = liveId.current
      let held: string[] = []
      try {
        let createdStoredId: string | null = null
        if (!sid) {
          const params: Record<string, unknown> = sessionAuthority ? { source: 'gui' } : { cols: 96, source: 'desktop' }
          if (profile) params.profile = profile
          const made = await window.conduit.rpc<CreateResult>('session.create', params)
          sid = made.session_id
          createdStoredId = made.stored_session_id ?? null
          liveId.current = sid
          created.current = createdStoredId
          request.current++ // a resume still in flight is stale now
          setChat(c => ({ ...c, liveId: sid, storedId: createdStoredId ?? c.storedId, model: made.info?.model, cwd: made.info?.cwd }))
        }
        const uploaded = attachments.length
          ? await uploadAttachments((method, params) => window.conduit.rpc(method, params), sid, profile, sessionAuthority, attachments).catch(e => {
              throw new Error(t('Attachment failed: {reason}', { reason: e instanceof Error ? e.message : String(e) }))
            })
          : null
        held = uploaded?.heldImagePaths ?? []
        const params: Record<string, unknown> = { session_id: sid, text: promptText(trimmed, uploaded?.references ?? []) }
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
    [profile, sessionAuthority]
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

  return { transcript, chat, loading, error, send, stop }
}
