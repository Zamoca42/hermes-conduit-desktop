import { useEffect, useRef, useState } from 'react'
import { language, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { stopReading } from '../state/readAloud'
import type { TranscriptItem } from '../state/transcript'
import { MEMORY_PATH, NO_REPLY, PERSONALITY_PATH, memoryText, personaText, replyPrompt, withProfile } from '../state/gptLive'
import {
  ASK_THREAD,
  BAD_ARGUMENTS,
  END_CONVERSATION,
  NOTHING_TO_READ,
  NO_REQUEST,
  MEMORY_RECALL_PATH,
  READ_LAST_REPLY,
  RECALL_MEMORY,
  UNKNOWN_TOOL,
  canRecall,
  chatContext,
  recallAnswer,
  pcmSamples,
  readReply
} from '../state/liveCall'
import {
  DEFAULT_MODEL,
  INPUT_RATE,
  OUTPUT_RATE,
  START_TIMEOUT_MS,
  TOKEN_PATH,
  audioMessage,
  audioStreamEnd,
  closeReason,
  decode,
  geminiSendsMemory,
  geminiSendsPersona,
  geminiVoice,
  instructions,
  quotaExhausted,
  setupMessage,
  textTurn,
  toolResponse,
  type Search,
  type ServerEvent
} from '../state/geminiLive'
import {
  DEFAULT_MODEL as QWEN_MODEL,
  DEFAULT_VOICE as QWEN_VOICE,
  QwenAdapter,
  QwenLiveError,
  TOKEN_PATH as QWEN_TOKEN_PATH,
  WEB_SEARCH,
  qwenSendsMemory,
  qwenSendsPersona,
  qwenVoice,
  webSearch,
  webSearchAvailable
} from '../state/qwenLive'
import { newCallId, saveCall, type CallTurn } from '../state/voiceSave'
import type { PendingRequest } from '@shared/ipc'
import { ANSWER_APPROVAL, ANSWER_QUESTION, answerApproval, answerQuestion, requestUpdate } from '../state/liveRequests'
import { Icon } from './icons'

interface Props {
  profile?: string
  /** The chat's saved session, which keeps the call's transcript when it ends. */
  chatId?: string | null
  /** The chat's turns so far, which the call starts knowing. */
  items: TranscriptItem[]
  /** Sends a request as the chat's next message. */
  onSay: (text: string) => void
  /** A reply is running in the chat. */
  running: boolean
  /** Counts the chat's finished turns: the next one after a send is its reply. */
  turnsDone: number
  /** The chat's newest reply. */
  lastReply: string | null
  onEnd: () => void
  /** Ends this call and starts a Classic one in its place. */
  onClassic: () => void
  /** Gemini, or Qwen on the same shell through the phone's adapter. */
  provider?: 'gemini' | 'qwen'
  /** The approvals and questions the chat waits on, which the call can answer by voice. */
  requests?: PendingRequest[]
}

/** What the call says, by provider: each a literal key, so translations find it. */
const COPY = {
  gemini: {
    name: () => t('Gemini Live'),
    couldNot: () => t("Couldn't connect to Gemini Live."),
    couldNotBecause: (reason: string) => t("Couldn't connect to Gemini Live: {reason}", { reason }),
    refused: (reason: string) => t('Gemini Live refused the connection: {reason}', { reason })
  },
  qwen: {
    name: () => t('Qwen Live'),
    couldNot: () => t("Couldn't connect to Qwen Live."),
    couldNotBecause: (reason: string) => t("Couldn't connect to Qwen Live: {reason}", { reason }),
    refused: (reason: string) => t('Qwen Live refused the connection: {reason}', { reason })
  }
}

type Phase = 'starting' | 'listening' | 'speaking' | 'ending' | 'failed'
interface Line {
  id: number
  who: 'user' | 'assistant'
  text: string
  open: boolean
}

/** Saying goodbye: the call closes once the model's audio has played out, or after this at most. */
const END_GRACE_MS = 1000
const END_TIMEOUT_MS = 8000
/** A request Hermes never started on (the chat refused it) is let go after this. */
const SEND_STALL_MS = 20_000
/** Conduit's own messages wait this long after the user last spoke. */
const USER_QUIET_MS = 2000
/** The microphone stays closed this long after the model's audio ends, so its tail isn't heard back. */
const ECHO_TAIL_MS = 300

/**
 * A Gemini Live call in the open chat, after the phone's GeminiLiveConversationController:
 * you talk with Gemini, and what you ask it to do goes to Hermes as the chat's
 * next message. Its ask_thread call stays open (NON_BLOCKING) until Hermes
 * replies, and the reply is told once Gemini is idle.
 */
export function GeminiLiveCall({ profile, chatId, items, onSay, running, turnsDone, lastReply, onEnd, onClassic, provider = 'gemini', requests = [] }: Props) {
  const qwen = provider === 'qwen'
  const copy = COPY[provider]
  const [phase, setPhase] = useState<Phase>('starting')
  const [problem, setProblem] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [lines, setLines] = useState<Line[]>([])

  const socket = useRef<string | null>(null)
  // Qwen's events in and out of the Gemini frames this call speaks.
  const adapter = useRef<QwenAdapter | null>(null)
  const capture = useRef<AudioContext | null>(null)
  const speaker = useRef<AudioContext | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const processor = useRef<ScriptProcessorNode | null>(null)
  const sources = useRef(new Set<AudioBufferSourceNode>())
  const playUntil = useRef(0)
  const ended = useRef(false)
  const ending = useRef(false)
  const ready = useRef(false)
  const mutedRef = useRef(false)
  const lineId = useRef(0)
  const modelTurn = useRef(false)
  const userSpokeAt = useRef(0)
  const answered = useRef(new Set<string>())
  // This turn's words, kept as the call's turns when it completes.
  const heard = useRef('')
  const spoken = useRef('')
  // Messages for calls that are no longer open, sent once the conversation is quiet.
  const updates = useRef<string[]>([])
  // Requests for Hermes, one at a time in the chat, each with the ask_thread call it answers.
  const queue = useRef<{ request: string; call: string }[]>([])
  const active = useRef<{ from: number; at: number; started: boolean; call: string } | null>(null)
  const openCalls = useRef(new Set<string>())
  // The latest props, for the socket's handlers.
  const live = useRef({ running, turnsDone, lastReply, onSay, chatId, requests })
  live.current = { running, turnsDone, lastReply, onSay, chatId, requests }
  // Requests the model was told about, so each is told once.
  const told = useRef(new Set<string>())
  // The call's finished turns, kept with the chat when it ends.
  const record = useRef<CallTurn[]>([])
  const callId = useRef(newCallId())
  const saved = useRef(false)
  const keep = (role: CallTurn['role'], text: string) => text.trim() && record.current.push({ role, text: text.trim(), at: Date.now() / 1000 })
  const save = () => {
    if (saved.current) return
    saved.current = true
    void saveCall(profile, callId.current, qwen ? 'qwen-live' : 'gemini-live', record.current, live.current.chatId)
  }

  const send = (message: Record<string, unknown>) => {
    if (!socket.current) return
    if (adapter.current) adapter.current.send(message)
    else window.conduit.liveSend(socket.current, JSON.stringify(message))
  }

  const playing = () => (speaker.current ? speaker.current.currentTime < playUntil.current : false)

  const stopPlayback = () => {
    for (const source of sources.current) {
      try {
        source.stop()
      } catch {
        // Already ended.
      }
    }
    sources.current.clear()
    playUntil.current = 0
  }

  const play = (pcm: string) => {
    const ctx = speaker.current
    if (!ctx) return
    const samples = pcmSamples(pcm)
    if (!samples.length) return
    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE)
    buffer.copyToChannel(samples, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + 0.02, playUntil.current)
    source.start(at)
    playUntil.current = at + buffer.duration
    sources.current.add(source)
    source.onended = () => sources.current.delete(source)
  }

  const teardown = () => {
    save()
    if (socket.current) window.conduit.liveClose(socket.current)
    socket.current = null
    processor.current?.disconnect()
    processor.current = null
    mic.current?.getTracks().forEach(track => track.stop())
    mic.current = null
    stopPlayback()
    void capture.current?.close().catch(() => undefined)
    void speaker.current?.close().catch(() => undefined)
    capture.current = null
    speaker.current = null
  }

  const fail = (message: string) => {
    if (ended.current) return
    ended.current = true
    teardown()
    setProblem(message)
    setPhase('failed')
  }

  // Hangs up, also after a failure (whose screen stays until it's closed).
  const finish = () => {
    if (!ended.current) {
      ended.current = true
      teardown()
    }
    onEnd()
  }

  // Closes once the goodbye has played out, or at the timeout.
  const endCall = () => {
    if (ending.current) return
    ending.current = true
    setPhase('ending')
    const started = Date.now()
    const check = () => {
      if (ended.current) return
      if (Date.now() - started > END_TIMEOUT_MS || (!playing() && !modelTurn.current)) {
        window.setTimeout(() => !ended.current && finish(), END_GRACE_MS)
        return
      }
      window.setTimeout(check, 250)
    }
    window.setTimeout(check, 400)
  }

  const addLine = (who: Line['who'], text: string) =>
    setLines(current => {
      const last = current.at(-1)
      if (last && last.open && last.who === who) return [...current.slice(0, -1), { ...last, text: last.text + text }]
      const closed = current.map(line => (line.open ? { ...line, open: false } : line))
      return [...closed, { id: ++lineId.current, who, text, open: true }].slice(-8)
    })

  const closeLines = () => setLines(current => current.map(line => (line.open ? { ...line, open: false } : line)))

  // The next request goes once the chat is free.
  const pump = () => {
    if (active.current || live.current.running || ending.current) return
    const next = queue.current.shift()
    if (!next) return
    active.current = { from: live.current.turnsDone, at: Date.now(), started: false, call: next.call }
    live.current.onSay(next.request)
  }

  // A request's outcome: on its call while it's open, otherwise as a message once the conversation is quiet.
  const deliver = (call: string, text: string) => {
    if (openCalls.current.delete(call)) send(toolResponse(call, ASK_THREAD, { status: 'done', result: text }, 'WHEN_IDLE'))
    else updates.current.push(text)
  }

  const toolCall = (event: Extract<ServerEvent, { type: 'toolCall' }>) => {
    if (answered.current.has(event.id)) return
    answered.current.add(event.id)
    const answer = (result: Record<string, string>) => send(toolResponse(event.id, event.name, result, 'WHEN_IDLE'))
    if (event.args.invalid_arguments) return answer(BAD_ARGUMENTS)
    switch (event.name) {
      case ASK_THREAD: {
        const request = (event.args.request ?? '').trim()
        if (!request) return answer(NO_REQUEST)
        // Left open: answered with Hermes' reply.
        openCalls.current.add(event.id)
        queue.current.push({ request, call: event.id })
        pump()
        return
      }
      case READ_LAST_REPLY: {
        const reply = live.current.lastReply?.trim()
        return answer(reply ? readReply(reply) : NOTHING_TO_READ)
      }
      case ANSWER_APPROVAL:
        void answerApproval(live.current.requests, event.args.choice ?? '').then(result => !ended.current && answer(result))
        return
      case ANSWER_QUESTION:
        void answerQuestion(live.current.requests, event.args.answer ?? '').then(result => !ended.current && answer(result))
        return
      case WEB_SEARCH:
        void webSearch(profile, event.args.query ?? '').then(result => !ended.current && answer(result))
        return
      case RECALL_MEMORY: {
        const query = (event.args.query ?? '').trim()
        if (!query) return answer({ status: 'error', error: 'No query was given.' })
        void gateway
          .http('POST', withProfile(MEMORY_RECALL_PATH, profile), { query }, 15_000)
          .then(recallAnswer, (e: unknown) => ({ status: 'error', error: e instanceof Error ? e.message : String(e) }))
          .then(result => !ended.current && answer(result))
        return
      }
      case END_CONVERSATION:
        // Left unanswered: the call closes once the goodbye has played.
        return endCall()
      default:
        return answer(UNKNOWN_TOOL)
    }
  }

  const handle = (event: ServerEvent) => {
    switch (event.type) {
      case 'ready':
        if (!ready.current) {
          ready.current = true
          setPhase('listening')
        }
        return
      case 'audio':
        if (ended.current) return
        modelTurn.current = true
        play(event.pcm)
        return
      case 'input':
        userSpokeAt.current = Date.now()
        heard.current += event.text
        addLine('user', event.text)
        return
      case 'output':
        modelTurn.current = true
        if (heard.current.trim()) {
          keep('user', heard.current)
          heard.current = ''
        }
        spoken.current += event.text
        addLine('assistant', event.text)
        return
      case 'interrupted':
        // The user cut in: playback stops now.
        stopPlayback()
        userSpokeAt.current = Date.now()
        return
      case 'turnComplete':
        modelTurn.current = false
        keep('user', heard.current)
        keep('assistant', spoken.current)
        heard.current = ''
        spoken.current = ''
        closeLines()
        return
      case 'toolCall':
        toolCall(event)
        return
      case 'toolCancel':
        // Calls the model gave up on: their outcome goes as a message instead.
        for (const id of event.ids) openCalls.current.delete(id)
        return
      case 'goAway':
        return
    }
  }

  // Shows speaking while the model's audio plays; sends updates once the conversation is quiet.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (ended.current || !ready.current) return
      const speaking = playing()
      if (!ending.current) setPhase(current => (current === 'failed' ? current : speaking ? 'speaking' : 'listening'))
      const quiet = !modelTurn.current && !speaking && Date.now() - userSpokeAt.current > USER_QUIET_MS
      if (quiet && !ending.current && updates.current.length) send(textTurn(updates.current.shift()!))
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  // Connect once; hang up on leaving.
  useEffect(() => {
    stopReading()
    let startTimer = 0
    let told = ''
    let model = DEFAULT_MODEL
    let voice: string | null = null
    let recall = false
    let search: Search = qwen ? 'none' : 'google'
    const restartTimer = () => {
      window.clearTimeout(startTimer)
      startTimer = window.setTimeout(() => {
        if (!ready.current) fail(copy.couldNot())
      }, START_TIMEOUT_MS)
    }
    let toldWith: Parameters<typeof instructions>[0] = {}
    let startedOpen = false
    // A single-use credential per connection, minted by the host and kept in the main process.
    const open = async (): Promise<boolean> => {
      const opened = await window.conduit.liveOpenMinted(withProfile(qwen ? QWEN_TOKEN_PATH : TOKEN_PATH, profile))
      if (!opened.ok) {
        fail(
          opened.code === 404
            ? t('Install or update the Hermes notifier plugin on your Hermes server.')
            : opened.error === 'Invalid Qwen Live credential.'
              ? t('Invalid Qwen Live credential.')
              : copy.couldNotBecause(opened.error)
        )
        return false
      }
      if (ended.current) {
        window.conduit.liveClose(opened.id)
        return false
      }
      model = opened.model ?? (qwen ? QWEN_MODEL : DEFAULT_MODEL)
      // The voice picked here, else the host's.
      voice = (qwen ? qwenVoice() : geminiVoice()) || opened.voice
      if (qwen) {
        const id = opened.id
        adapter.current = new QwenAdapter(voice || QWEN_VOICE, event => window.conduit.liveSend(id, JSON.stringify(event)))
      }
      socket.current = opened.id
      if (startedOpen) restartTimer()
      startedOpen = true
      return true
    }
    const stopListening = window.conduit.onLive(event => {
      if (event.id !== socket.current) return
      if (event.type === 'open') send(setupMessage(model, told, voice, recall, search))
      else if (event.type === 'message') {
        let frame: string | null = event.data
        if (adapter.current) {
          try {
            frame = adapter.current.receive(event.data)
          } catch (e) {
            return fail(e instanceof QwenLiveError ? t('Qwen Live request failed. Check the model, workspace and quota.') : copy.couldNot())
          }
          if (frame === null) return
        }
        for (const decoded of decode(frame)) {
          handle(decoded)
          if (ended.current) return
        }
      } else if (event.type === 'close') {
        socket.current = null
        if (ending.current) return void (!ended.current && finish())
        if (!qwen && search === 'google' && quotaExhausted(event.reason)) {
          // As on the phone: most likely Search's own quota, so the call opens again without it.
          search = 'none'
          told = instructions({ ...toldWith, search })
          ready.current = false
          return void open()
        }
        const reason = closeReason(event.code, event.reason)
        if (!ready.current) fail(reason ? copy.couldNotBecause(reason) : copy.couldNot())
        else fail(reason ? copy.refused(reason) : copy.couldNot())
      }
    })
    const connect = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (ended.current) return stream.getTracks().forEach(track => track.stop())
        mic.current = stream
        const input = new AudioContext({ sampleRate: INPUT_RATE })
        capture.current = input
        speaker.current = new AudioContext({ sampleRate: OUTPUT_RATE })
        const turns = items.flatMap((item): { role: 'user' | 'assistant'; text: string }[] =>
          item.kind === 'user' || item.kind === 'assistant' ? [{ role: item.kind, text: item.text }] : []
        )
        // The persona and memory only when switched on; a host without them starts the call without.
        const sendsPersona = qwen ? qwenSendsPersona() : geminiSendsPersona()
        const sendsMemory = qwen ? qwenSendsMemory() : geminiSendsMemory()
        const [persona, memory, searches] = await Promise.all([
          sendsPersona ? gateway.http('GET', withProfile(PERSONALITY_PATH, profile)).then(personaText, () => '') : '',
          sendsMemory
            ? gateway.http('GET', withProfile(MEMORY_PATH, profile)).then(
                r => ({ text: memoryText(r), recall: canRecall(r) }),
                () => ({ text: '', recall: false })
              )
            : { text: '', recall: false },
          // The host's web search when it has one, as on the phone's automatic search: Qwen's native search can't run
          // beside function tools, and Gemini's Google Search is metered on a quota of its own.
          webSearchAvailable(profile)
        ])
        if (ended.current) return
        recall = memory.recall
        search = searches ? 'hermes' : qwen ? 'none' : 'google'
        toldWith = { language: language(), persona, memory: memory.text, recall, chat: chatContext(turns) }
        told = instructions({ ...toldWith, search })
        if (!(await open())) return
        // The microphone, as 16 kHz PCM, while the call listens.
        const source = input.createMediaStreamSource(stream)
        const node = input.createScriptProcessor(1024, 1, 1)
        processor.current = node
        node.onaudioprocess = event => {
          if (!ready.current || ended.current || ending.current || mutedRef.current) return
          // While the model talks on the speakers, its own voice isn't sent back.
          const out = speaker.current
          if (out && out.currentTime < playUntil.current + ECHO_TAIL_MS / 1000) return
          send(audioMessage(event.inputBuffer.getChannelData(0)))
        }
        source.connect(node)
        node.connect(input.destination)
        restartTimer()
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
          fail(t("Conduit can't use the microphone. Allow it for Conduit in your computer's privacy settings, then try again."))
        else if (e instanceof DOMException && e.name === 'NotFoundError') fail(t('No microphone found.'))
        else fail(message)
      }
    }
    void connect()
    return () => {
      window.clearTimeout(startTimer)
      stopListening()
      ended.current = true
      teardown()
    }
  }, [])

  // A request's reply: told on its call once its turn ends, then the next request goes.
  useEffect(() => {
    const current = active.current
    if (!current || ended.current) return
    if (running) {
      current.started = true
      return
    }
    if (turnsDone !== current.from) {
      active.current = null
      deliver(current.call, lastReply?.trim() ? replyPrompt(lastReply) : NO_REPLY)
      pump()
      return
    }
    // Never started (the chat refused it): let it go, so the call isn't stuck.
    const timer = window.setTimeout(() => {
      if (active.current === current && !current.started) {
        active.current = null
        deliver(current.call, NO_REPLY)
        pump()
      }
    }, SEND_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [running, turnsDone, lastReply])

  // What Hermes waits on in the chat: told once the conversation is quiet, and answered only with the user's words.
  useEffect(() => {
    for (const request of requests) {
      if (told.current.has(request.id)) continue
      told.current.add(request.id)
      const update = requestUpdate(request)
      if (!update) continue
      // The request Hermes stopped on answers its open call now (a call left open holds Qwen's replies);
      // Hermes' reply then comes as an update once the conversation is quiet.
      const call = active.current?.call
      if (call && openCalls.current.delete(call)) send(toolResponse(call, ASK_THREAD, { status: 'waiting_for_user', message: update }, 'WHEN_IDLE'))
      else updates.current.push(update)
    }
  }, [requests])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    // A muted microphone sends nothing: the server ends the user's turn now.
    if (next && ready.current) send(audioStreamEnd())
  }

  const status =
    phase === 'starting'
      ? t('Connecting…')
      : phase === 'listening'
        ? muted
          ? t('Muted')
          : t('Listening')
        : phase === 'speaking' || phase === 'ending'
          ? t('Speaking')
          : t('Interrupted')

  return (
    <div
      className={`voice-call live phase-${phase === 'starting' ? 'starting' : phase === 'failed' ? 'failed' : phase === 'speaking' ? 'speaking' : 'listening'}`}
      role="region"
      aria-label={t('Voice call')}
    >
      <div className="voice-call-status">
        <span className="voice-call-orb" />
        <div className="voice-call-words">
          <strong>{status}</strong>
          {problem ? <span className="voice-call-problem">{problem}</span> : <span className="meta">{copy.name()}</span>}
        </div>
      </div>
      {lines.length ? (
        <ol className="voice-call-lines" aria-live="polite">
          {lines.map(line => (
            <li key={line.id} className={line.who === 'user' ? 'voice-call-line said' : 'voice-call-line'}>
              {line.text}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="voice-call-buttons">
        {phase === 'failed' ? (
          <button className="secondary" onClick={onClassic}>
            {t('Classic voice')}
          </button>
        ) : null}
        <button
          className={`voice-call-round${muted ? ' on' : ''}`}
          aria-label={muted ? t('Unmute microphone') : t('Mute microphone')}
          title={muted ? t('Unmute microphone') : t('Mute microphone')}
          disabled={phase === 'failed'}
          onClick={toggleMute}
        >
          <Icon name={muted ? 'micOff' : 'mic'} />
        </button>
        <button className="voice-call-round end" aria-label={t('End call')} title={t('End call')} onClick={finish}>
          <Icon name="phoneDown" />
        </button>
      </div>
    </div>
  )
}
