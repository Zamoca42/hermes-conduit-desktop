import { useEffect, useRef, useState } from 'react'
import { t } from '@shared/i18n'
import type { PendingRequest } from '@shared/ipc'
import { stopReading } from '../state/readAloud'
import type { TranscriptItem } from '../state/transcript'
import { audioAppend, decode, pcmSamples } from '../state/grokLive'
import {
  ANSWERED_WITHOUT_HERMES,
  BUSY_LINE,
  FAILURE_LINE,
  KEEPALIVE,
  KEEPALIVE_MS,
  NEEDS_INPUT_LINE,
  ON_SCREEN_LINE,
  PLUGIN_MISSING,
  READY_TIMED_OUT,
  READY_TIMEOUT_MS,
  SAMPLE_RATE,
  SOCKET_PATH,
  SpokenSplitter,
  approvalLine,
  deltaChunks,
  plainDecision,
  readinessCheck,
  readinessMarker,
  refusedLine,
  sessionUpdate,
  spokenChoice,
  spokenQuestion,
  stopsPlayback,
  turnDelta,
  turnDone,
  turnFrame
} from '../state/localLive'
import { answerApproval, answerQuestion, openQuestion } from '../state/liveRequests'
import { approvalView, clarifyQuestions } from '../state/needsYou'
import { newCallId, saveCall, type CallTurn } from '../state/voiceSave'
import { Icon } from './icons'

interface Props {
  profile?: string
  /** The chat's saved session, which keeps the call's transcript when it ends. */
  chatId?: string | null
  /** The chat's turns, whose newest reply is spoken as it is written. */
  items: TranscriptItem[]
  /** Sends a turn as the chat's next message. */
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
  /** The approvals and questions the chat waits on, which a spoken yes, no or answer takes. */
  requests?: PendingRequest[]
}

type Phase = 'starting' | 'listening' | 'speaking' | 'failed'
interface Line {
  id: number
  who: 'user' | 'assistant'
  item?: string | null
  text: string
  open: boolean
}

/** A turn Hermes never started on (the chat refused it) is let go after this. */
const SEND_STALL_MS = 20_000
/** The microphone stays closed this long after the server's audio ends, so its tail isn't heard back. */
const ECHO_TAIL_MS = 300
const SILENCE = new Float32Array(Math.round(SAMPLE_RATE * 0.8))

/** The reply the call follows, from its send until its turn ends. */
interface Follow {
  from: number
  at: number
  started: boolean
  /** Assistant items the chat had before the send: not this reply's. */
  before: Set<string>
  /** What of each of this reply's items was spoken. */
  spoken: Map<string, string>
}

/**
 * A Local Live call in the open chat, after the phone's Local Live: you talk
 * through your own speech server, everything you say goes to Hermes as the
 * chat's next message, and Hermes' reply is spoken by that server as it is
 * written. Audio goes both ways as 24 kHz PCM over the plugin's relay, which
 * hands Conduit each turn the server asks for.
 */
export function LocalLiveCall({ profile, chatId, items, onSay, running, turnsDone, lastReply, onEnd, onClassic, requests = [] }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [problem, setProblem] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [lines, setLines] = useState<Line[]>([])

  const socket = useRef<string | null>(null)
  const context = useRef<AudioContext | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const processor = useRef<ScriptProcessorNode | null>(null)
  const sources = useRef(new Set<AudioBufferSourceNode>())
  const playUntil = useRef(0)
  const ended = useRef(false)
  const ready = useRef(false)
  const mutedRef = useRef(false)
  const lineId = useRef(0)
  // The readiness check: its marker, and whether its (unspoken) response is still going.
  const marker = useRef<string | null>(null)
  const checking = useRef(false)
  // The plugin's open turn, and the Hermes reply it speaks.
  const turn = useRef<{ id: string; spoke: boolean } | null>(null)
  const follow = useRef<Follow | null>(null)
  const splitter = useRef(new SpokenSplitter())
  const told = useRef(new Set<string>())
  const live = useRef({ items, running, turnsDone, lastReply, onSay, chatId, requests })
  live.current = { items, running, turnsDone, lastReply, onSay, chatId, requests }
  // The call's finished turns, kept with the chat when it ends.
  const record = useRef<CallTurn[]>([])
  const callId = useRef(newCallId())
  const saved = useRef(false)
  const keep = (role: CallTurn['role'], text: string) => text.trim() && record.current.push({ role, text: text.trim(), at: Date.now() / 1000 })
  const save = () => {
    if (saved.current) return
    saved.current = true
    void saveCall(profile, callId.current, 'local-live', record.current, live.current.chatId)
  }

  const send = (message: Record<string, unknown>) => {
    if (socket.current) window.conduit.liveSend(socket.current, JSON.stringify(message))
  }

  const playing = () => (context.current ? context.current.currentTime < playUntil.current : false)

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
    const ctx = context.current
    if (!ctx) return
    const samples = pcmSamples(pcm)
    if (!samples.length) return
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
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
    void context.current?.close().catch(() => undefined)
    context.current = null
  }

  const fail = (message: string) => {
    if (ended.current) return
    ended.current = true
    teardown()
    setProblem(message)
    setPhase('failed')
  }

  const finish = () => {
    if (!ended.current) {
      ended.current = true
      teardown()
    }
    onEnd()
  }

  const userLine = (item: string | null, text: string, final: boolean) =>
    setLines(current => {
      const index = item ? current.findIndex(line => line.who === 'user' && line.item === item) : -1
      if (index >= 0) {
        const next = [...current]
        next[index] = { ...next[index]!, text, open: !final }
        return next
      }
      const closed = current.map(line => (line.open && line.who === 'assistant' ? { ...line, open: false } : line))
      return [...closed, { id: ++lineId.current, who: 'user' as const, item, text, open: !final }].slice(-8)
    })

  const assistantLine = (text: string, whole = false) =>
    setLines(current => {
      const index = current.findLastIndex(line => line.open && line.who === 'assistant')
      if (index >= 0) {
        const next = [...current]
        next[index] = { ...next[index]!, text: whole ? text : next[index]!.text + text, open: !whole }
        return next
      }
      if (whole && current.at(-1)?.who === 'assistant' && current.at(-1)?.text === text) return current
      return [...current, { id: ++lineId.current, who: 'assistant' as const, text, open: !whole }].slice(-8)
    })

  // MARK: Turns

  // What the open turn said so far ends a line (or nothing was said yet).
  const endedLine = useRef(true)

  /** Words for the open turn, without blank lines: a line break ends a sentence for the server. */
  const delta = (id: string, text: string) => {
    let words = text.replace(/[ \t]*\n[\s]*/g, '\n')
    if (endedLine.current) words = words.replace(/^\s+/, '')
    if (!words) return
    endedLine.current = words.endsWith('\n')
    for (const chunk of deltaChunks(words)) send(turnDelta(id, chunk))
  }

  /** A line of the call's own after what the turn said. */
  const line = (id: string, text: string) => delta(id, `${endedLine.current ? '' : '\n'}${text}`)

  const closeTurn = (id: string) => {
    splitter.current = new SpokenSplitter()
    endedLine.current = true
    turn.current = null
    send(turnDone(id))
  }

  /** Hermes' words, as they come, into the open turn. */
  const speak = (text: string) => {
    const current = turn.current
    if (!current || !text) return
    current.spoke = true
    const spoken = splitter.current.feed(text)
    if (spoken) delta(current.id, spoken)
  }

  /** Ends the open turn: what was held is said, and the screen's part named. */
  const endTurn = () => {
    const current = turn.current
    if (!current) return
    const rest = splitter.current.finish()
    if (rest) delta(current.id, rest)
    if (splitter.current.leftOut) line(current.id, ON_SCREEN_LINE())
    closeTurn(current.id)
  }

  /** A line of the call's own in place of the rest of Hermes' reply. */
  const say = (id: string, text: string) => {
    if (turn.current?.id !== id) return
    turn.current.spoke = true
    if (text) line(id, text)
    closeTurn(id)
  }

  const assistantItems = () => live.current.items.filter((item): item is Extract<TranscriptItem, { kind: 'assistant' }> => item.kind === 'assistant')

  /** Follows the reply running now: only what it writes from here on is spoken. */
  const followRunning = () => {
    const before = new Set<string>()
    const spoken = new Map<string, string>()
    for (const item of assistantItems()) {
      if (item.streaming) spoken.set(item.key, item.text)
      else before.add(item.key)
    }
    follow.current = { from: live.current.turnsDone, at: Date.now(), started: live.current.running, before, spoken }
  }

  /** Hermes took the user's answer: the reply it goes on with is spoken in this turn. */
  const goOn = (id: string) => {
    if (!live.current.running) return say(id, '')
    if (!follow.current) followRunning()
  }

  /** The words of a turn the server asks for: an answer to what waits, or the chat's next message. */
  const runTurn = async (id: string, words: string) => {
    if (!words) return say(id, '')
    const waiting = live.current.requests
    // A plain yes or no to the approval Hermes waits on: it goes on, and its reply is spoken in this turn.
    const approval = waiting.find(r => r.method === 'approval')
    const decision = approval ? plainDecision(words) : null
    if (approval && decision) {
      const result = await answerApproval(waiting, decision)
      if (ended.current || turn.current?.id !== id) return
      if (result.status === 'sent') return goOn(id)
    } else if (approval) {
      // Anything else while it waits: the call says again what it waits on.
      const view = approvalView(approval.params)
      return say(id, approvalLine(view.description || view.command || ''))
    }
    // The answer to the question Hermes asks: its next question is read out, or its reply goes on here.
    const clarify = waiting.find(r => r.method === 'clarify' && openQuestion(r))
    if (clarify) {
      const result = await answerQuestion(waiting, spokenChoice(words))
      if (ended.current || turn.current?.id !== id) return
      if (result.status === 'answered') {
        const next = openQuestion(clarify)
        if (next) return say(id, spokenQuestion(next, clarifyQuestions(clarify.params).length > 1))
        return goOn(id)
      }
    }
    // Hermes is still on a turn (typed, or the last one): the chat can't take another yet.
    if (live.current.running || follow.current) return say(id, BUSY_LINE())
    const before = new Set(assistantItems().map(item => item.key))
    follow.current = { from: live.current.turnsDone, at: Date.now(), started: false, before, spoken: new Map() }
    live.current.onSay(words)
  }

  const onTurn = (id: string, text: string) => {
    const words = text.trim()
    // The readiness check's ask: answered with nothing, so the server says nothing.
    if (marker.current && words === marker.current) {
      send(turnDone(id))
      if (!ready.current) becomeReady()
      return
    }
    checking.current = false
    // The plugin cancels a turn before sending the next: whatever was open has nobody waiting.
    turn.current = { id, spoke: false }
    splitter.current = new SpokenSplitter()
    endedLine.current = true
    void runTurn(id, words).catch(() => say(id, FAILURE_LINE()))
  }

  // MARK: Readiness

  const startCheck = () => {
    const words = readinessMarker()
    marker.current = words
    checking.current = true
    send(readinessCheck(words))
  }

  const becomeReady = () => {
    if (ready.current) return
    ready.current = true
    setPhase('listening')
    // A server that never ends the check's response mustn't hide the call's own replies.
    window.setTimeout(() => (checking.current = false), 5000)
  }

  // MARK: The server's frames

  const onFrame = (text: string) => {
    const frame = turnFrame(text)
    if (frame) {
      if (frame.type === 'turn') onTurn(frame.id, frame.text)
      else if (turn.current?.id === frame.id) {
        turn.current = null
        splitter.current = new SpokenSplitter()
      }
      return
    }
    if (!checking.current && stopsPlayback(text)) stopPlayback()
    const event = decode(text)
    if (!event) return
    switch (event.type) {
      case 'ready':
        if (!marker.current) startCheck()
        return
      case 'error':
        // Before the session is set up, the server refused it; a server that can't take the check goes ready anyway.
        if (!marker.current) return fail(refusedLine(event.message))
        if (!ready.current) {
          checking.current = false
          becomeReady()
        }
        return
      case 'responseDone':
        if (checking.current) {
          checking.current = false
          // The check's response ended without its ask reaching this call: the server's model isn't Hermes here.
          if (!ready.current) fail(ANSWERED_WITHOUT_HERMES())
        }
        return
      case 'speechStarted':
        stopPlayback()
        return
      case 'input':
        userLine(event.itemId, event.text, event.final)
        if (event.final) keep('user', event.text)
        return
      case 'audio':
        if (!checking.current && !ended.current) play(event.pcm)
        return
      case 'output':
        if (!checking.current) assistantLine(event.text)
        return
      case 'outputDone':
        if (checking.current) return
        keep('assistant', event.text)
        assistantLine(event.text, true)
        return
      default:
        return
    }
  }

  // Shows speaking while the server's audio plays.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (ended.current || !ready.current) return
      setPhase(current => (current === 'failed' ? current : playing() ? 'speaking' : 'listening'))
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  // Connect once; hang up on leaving.
  useEffect(() => {
    stopReading()
    let readyTimer = 0
    let keepalive = 0
    const stopListening = window.conduit.onLive(event => {
      if (event.id !== socket.current) return
      if (event.type === 'open') send(sessionUpdate())
      else if (event.type === 'message') onFrame(event.data)
      else if (event.type === 'close') {
        socket.current = null
        if (ended.current) return
        const reason = event.reason.trim() || (event.code === 1000 || event.code === 1005 ? '' : String(event.code))
        if (!ready.current) fail(refusedLine(reason))
        else fail(reason ? refusedLine(reason) : t('The connection to Hermes dropped.'))
      }
    })
    const connect = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (ended.current) return stream.getTracks().forEach(track => track.stop())
        mic.current = stream
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
        context.current = ctx
        const opened = await window.conduit.liveOpen(SOCKET_PATH, profile && profile !== 'default' ? { profile } : {})
        if (!opened.ok) return fail(/\b404\b/.test(opened.error) ? PLUGIN_MISSING() : t('Could not open the Local Live connection.'))
        if (ended.current) return window.conduit.liveClose(opened.id)
        socket.current = opened.id
        const source = ctx.createMediaStreamSource(stream)
        const node = ctx.createScriptProcessor(2048, 1, 1)
        processor.current = node
        node.onaudioprocess = event => {
          if (!ready.current || ended.current || mutedRef.current) return
          // While the server talks on the speakers, its own voice isn't sent back.
          if (ctx.currentTime < playUntil.current + ECHO_TAIL_MS / 1000) return
          send(audioAppend(event.inputBuffer.getChannelData(0)))
        }
        source.connect(node)
        node.connect(ctx.destination)
        keepalive = window.setInterval(() => send(KEEPALIVE), KEEPALIVE_MS)
        readyTimer = window.setTimeout(() => {
          if (!ready.current) fail(READY_TIMED_OUT())
        }, READY_TIMEOUT_MS)
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
      window.clearTimeout(readyTimer)
      window.clearInterval(keepalive)
      stopListening()
      ended.current = true
      teardown()
    }
  }, [])

  // The followed reply: its new words are spoken as they're written, and its end ends the turn.
  useEffect(() => {
    const current = follow.current
    if (!current || ended.current) return
    if (running) current.started = true
    for (const item of items) {
      if (item.kind !== 'assistant' || current.before.has(item.key)) continue
      const said = current.spoken.get(item.key)
      if (said === undefined) {
        // A new paragraph of the reply, after a tool ran.
        if (current.spoken.size) speak('\n')
        current.spoken.set(item.key, item.text)
        speak(item.text)
      } else if (item.text.length > said.length && item.text.startsWith(said)) {
        current.spoken.set(item.key, item.text)
        speak(item.text.slice(said.length))
      }
    }
    if (!running && turnsDone !== current.from) {
      follow.current = null
      // A reply whose words never streamed is said whole.
      if (turn.current && !turn.current.spoke && lastReply?.trim()) speak(lastReply)
      endTurn()
      return
    }
    if (running || current.started) return
    // Never started (the chat refused it): let it go, so the call isn't stuck.
    const timer = window.setTimeout(() => {
      if (follow.current === current && !current.started) {
        follow.current = null
        if (turn.current) say(turn.current.id, FAILURE_LINE())
      }
    }, SEND_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [items, running, turnsDone, lastReply])

  // What Hermes waits on: said in the open turn, and answered by the user's next words.
  useEffect(() => {
    for (const request of requests) {
      if (told.current.has(request.id)) continue
      told.current.add(request.id)
      const current = turn.current
      if (!current) continue
      if (request.method === 'approval') {
        const view = approvalView(request.params)
        say(current.id, approvalLine(view.description || view.command || ''))
      } else {
        const question = openQuestion(request)
        say(current.id, question ? spokenQuestion(question, clarifyQuestions(request.params).length > 1) : NEEDS_INPUT_LINE())
      }
    }
  }, [requests])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    mutedRef.current = next
    // A muted microphone sends nothing: a short silence ends the user's turn now.
    if (next && ready.current) send(audioAppend(SILENCE))
  }

  const status =
    phase === 'starting'
      ? t('Connecting…')
      : phase === 'listening'
        ? muted
          ? t('Muted')
          : t('Listening')
        : phase === 'speaking'
          ? t('Speaking')
          : t('Interrupted')

  return (
    <div className={`voice-call live phase-${phase}`} role="region" aria-label={t('Voice call')}>
      <div className="voice-call-status">
        <span className="voice-call-orb" />
        <div className="voice-call-words">
          <strong>{status}</strong>
          {problem ? <span className="voice-call-problem">{problem}</span> : <span className="meta">{t('Local Live')}</span>}
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
