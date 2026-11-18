import { useEffect, useRef, useState } from 'react'
import { language, t } from '@shared/i18n'
import { gateway } from '../gateway'
import { stopReading } from '../state/readAloud'
import type { TranscriptItem } from '../state/transcript'
import {
  DATA_CHANNEL,
  NOTHING_TO_READ,
  NOTHING_TO_SEND,
  NO_REPLY,
  SENT_TO_CHAT,
  SESSION_PATH,
  SESSION_TIMEOUT_MS,
  START_TIMEOUT_MS,
  TurnAssembler,
  WAITING_FOR_CHAT,
  appendMessages,
  briefing,
  closeMessage,
  decode,
  gptLiveBilling,
  history,
  isEndCall,
  isReadBack,
  readBack,
  replyPrompt,
  requestWords,
  sessionAnswer,
  withProfile,
  type Channel,
  type Dialect,
  type ServerEvent
} from '../state/gptLive'
import { Icon } from './icons'

interface Props {
  profile?: string
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
}

type Phase = 'starting' | 'listening' | 'speaking' | 'ending' | 'failed'
interface Line {
  id: number
  who: 'user' | 'assistant'
  text: string
  open: boolean
}

/** Saying goodbye: the call closes once the model has finished, or after this at most. */
const END_GRACE_MS = 1500
const END_TIMEOUT_MS = 8000
/** A request Hermes never started on (the chat refused it) is let go after this. */
const SEND_STALL_MS = 20_000
/** Words that end a GA call, whose delegations carry no "End call:" marker. */
const GOODBYE =
  /^(?:(?:ok(?:ay)?|alright|thanks?|thank you)[,.! ]*)*(?:good ?bye|bye(?: bye)?|hang up|end (?:the |this )?call)[,.! ]*(?:(?:thanks?|thank you)[.! ]*)?$/i

/**
 * A GPT-Live call in the open chat, after the phone's GPTLiveConversationController:
 * you talk with GPT-Live, and what you ask it to do goes to Hermes as the chat's
 * next message, with Hermes' reply told back to you in the call.
 */
export function GptLiveCall({ profile, items, onSay, running, turnsDone, lastReply, onEnd, onClassic }: Props) {
  const [phase, setPhase] = useState<Phase>('starting')
  const [problem, setProblem] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [billing] = useState(gptLiveBilling)

  const pc = useRef<RTCPeerConnection | null>(null)
  const channel = useRef<RTCDataChannel | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const speaker = useRef<HTMLAudioElement | null>(null)
  const dialect = useRef<Dialect>('frameless')
  const turns = useRef(new TurnAssembler())
  const quiet = useRef<number | null>(null)
  const ended = useRef(false)
  const ending = useRef(false)
  const lineId = useRef(0)
  // The user's words since the last delegation: finished turns, and the one still being said.
  const words = useRef({ done: '', open: '' })
  // Requests for Hermes, one at a time in the chat.
  const queue = useRef<{ id: string; request: string }[]>([])
  const active = useRef<{ id: string; from: number; at: number; started: boolean } | null>(null)
  // The latest props, for the data channel's handlers.
  const live = useRef({ running, turnsDone, lastReply, onSay })
  live.current = { running, turnsDone, lastReply, onSay }

  const append = (text: string, channelName: Channel, delegationId: string | null) => {
    const dc = channel.current
    if (!dc || dc.readyState !== 'open') return false
    for (const message of appendMessages(text, channelName, delegationId, dialect.current)) dc.send(JSON.stringify(message))
    return true
  }

  const teardown = () => {
    if (quiet.current) window.clearTimeout(quiet.current)
    try {
      if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify(closeMessage()))
    } catch {
      // Closing anyway.
    }
    channel.current?.close()
    pc.current?.close()
    mic.current?.getTracks().forEach(track => track.stop())
    speaker.current?.pause()
    channel.current = null
    pc.current = null
    mic.current = null
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

  const endSoon = (delay: number) => window.setTimeout(() => !ended.current && finish(), delay)

  const addLine = (who: Line['who'], text: string) =>
    setLines(current => {
      const last = current.at(-1)
      if (last && last.open && last.who === who) return [...current.slice(0, -1), { ...last, text: last.text + text }]
      const closed = current.map(line => (line.open ? { ...line, open: false } : line))
      return [...closed, { id: ++lineId.current, who, text, open: true }].slice(-8)
    })

  const closeLine = (who: Line['who'], transcript: string) =>
    setLines(current => {
      const index = current.findLastIndex(line => line.open && line.who === who)
      if (index < 0) return transcript.trim() ? [...current, { id: ++lineId.current, who, text: transcript.trim(), open: false }].slice(-8) : current
      const next = [...current]
      next[index] = { ...next[index]!, text: transcript.trim() || next[index]!.text, open: false }
      return next
    })

  // The next request goes once the chat is free.
  const pump = () => {
    if (active.current || live.current.running || ending.current) return
    const next = queue.current.shift()
    if (!next) return
    active.current = { id: next.id, from: live.current.turnsDone, at: Date.now(), started: false }
    live.current.onSay(next.request)
    append(SENT_TO_CHAT, 'speakable', next.id)
  }

  const delegate = (id: string, text: string) => {
    const said = [words.current.done, words.current.open].join(' ').trim()
    words.current = { done: '', open: '' }
    if (isEndCall(text) || (!text.trim() && GOODBYE.test(said))) {
      ending.current = true
      setPhase('ending')
      mic.current?.getAudioTracks().forEach(track => (track.enabled = false))
      endSoon(END_TIMEOUT_MS)
      return
    }
    if (isReadBack(text)) {
      const read = readBack(live.current.lastReply)
      if (!read) append(NOTHING_TO_READ, 'speakable', id)
      else {
        append(read.quiet, 'commentary', id)
        append(read.cue, 'speakable', id)
      }
      return
    }
    const request = requestWords(text, said)
    if (!request) {
      append(NOTHING_TO_SEND, 'commentary', id)
      return
    }
    queue.current.push({ id, request })
    if (active.current || live.current.running) append(WAITING_FOR_CHAT, 'commentary', id)
    pump()
  }

  const handle = (event: ServerEvent) => {
    switch (event.type) {
      case 'started':
        setPhase(current => (current === 'starting' ? 'listening' : current))
        return
      case 'input':
        words.current.open += event.text
        addLine('user', event.text)
        return
      case 'output':
        if (!ending.current) setPhase('speaking')
        addLine('assistant', event.text)
        return
      case 'turnDone':
        if (event.role === 'user') {
          const text = event.transcript.trim() || words.current.open.trim()
          words.current = { done: [words.current.done, text].filter(Boolean).join(' '), open: '' }
          closeLine('user', event.transcript)
        } else if (event.role === 'assistant') {
          closeLine('assistant', event.transcript)
          if (ending.current) endSoon(END_GRACE_MS)
          else setPhase('listening')
        }
        return
      case 'delegation':
        delegate(event.id, event.text)
        return
      case 'error':
        // A late append after a close is expected noise.
        if (event.code === 'context_injection_incomplete') return
        setPhase(current => {
          if (current === 'starting') {
            window.setTimeout(() =>
              fail(
                event.message
                  ? t('GPT-Live refused the conversation: {message}', { message: event.message })
                  : t("GPT-Live didn't start the conversation. Try again.")
              )
            )
          }
          return current
        })
        return
      case 'closed':
        if (ending.current) {
          if (!ended.current) finish()
        } else fail(t('GPT-Live ended the conversation.'))
    }
  }

  const received = (text: string) => {
    const event = decode(text)
    if (!event) return
    if (dialect.current !== 'ga') return handle(event)
    for (const each of turns.current.receive(event)) {
      handle(each)
      if (ended.current) return
    }
    // The GA events have no turn.done: a quiet moment ends the open turn.
    if (quiet.current) window.clearTimeout(quiet.current)
    quiet.current = null
    if (turns.current.open)
      quiet.current = window.setTimeout(() => {
        quiet.current = null
        const done = turns.current.flush()
        if (done) handle(done)
      }, turns.current.quietMs)
  }

  // Connect once; hang up on leaving.
  useEffect(() => {
    stopReading()
    let startTimer = 0
    const connect = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        if (ended.current) return stream.getTracks().forEach(track => track.stop())
        mic.current = stream
        const peer = new RTCPeerConnection()
        pc.current = peer
        stream.getAudioTracks().forEach(track => peer.addTrack(track, stream))
        peer.ontrack = event => {
          const audio = speaker.current ?? new Audio()
          speaker.current = audio
          audio.autoplay = true
          audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
          void audio.play().catch(() => undefined)
        }
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === 'failed') fail(t('The GPT-Live connection was lost.'))
        }
        const dc = peer.createDataChannel(DATA_CHANNEL)
        channel.current = dc
        dc.onmessage = event => typeof event.data === 'string' && received(event.data)
        await peer.setLocalDescription(await peer.createOffer())
        // The whole offer, candidates included: the host sends it on in one request.
        await new Promise<void>(resolve => {
          if (peer.iceGatheringState === 'complete') return resolve()
          const done = () => peer.iceGatheringState === 'complete' && resolve()
          peer.addEventListener('icegatheringstatechange', done)
          window.setTimeout(resolve, 3000)
        })
        if (ended.current) return
        const seed = history(
          items.flatMap((item): { role: 'user' | 'assistant'; text: string }[] =>
            item.kind === 'user' || item.kind === 'assistant' ? [{ role: item.kind, text: item.text }] : []
          )
        )
        const told = briefing(language())
        const body: Record<string, unknown> = { sdp: peer.localDescription?.sdp ?? '', billing, briefing: told }
        if (seed.length) body.history = seed
        const answer = sessionAnswer(await gateway.http('POST', withProfile(SESSION_PATH, profile), body, SESSION_TIMEOUT_MS), billing)
        if (ended.current) return
        dialect.current = answer.dialect
        await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
        // Given with the session where the host takes it; otherwise once it starts.
        if (!answer.briefingApplied) {
          const sendBriefing = () => append(told, 'instructions', null)
          if (dc.readyState === 'open') sendBriefing()
          else dc.addEventListener('open', sendBriefing, { once: true })
        }
        startTimer = window.setTimeout(() => {
          setPhase(current => {
            if (current === 'starting') window.setTimeout(() => fail(t("GPT-Live didn't start the conversation. Try again.")))
            return current
          })
        }, START_TIMEOUT_MS)
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
      ended.current = true
      teardown()
    }
  }, [])

  // A request's reply: told on its delegation once its turn ends, then the next request goes.
  useEffect(() => {
    const current = active.current
    if (!current || ended.current) return
    if (running) {
      current.started = true
      return
    }
    if (turnsDone !== current.from) {
      active.current = null
      append(lastReply?.trim() ? replyPrompt(lastReply) : NO_REPLY, 'speakable', current.id)
      pump()
      return
    }
    // Never started (the chat refused it): let it go, so the call isn't stuck.
    const timer = window.setTimeout(() => {
      if (active.current === current && !current.started) {
        active.current = null
        append(NO_REPLY, 'speakable', current.id)
        pump()
      }
    }, SEND_STALL_MS)
    return () => window.clearTimeout(timer)
  }, [running, turnsDone, lastReply])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    mic.current?.getAudioTracks().forEach(track => (track.enabled = !next && !ending.current))
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
          : phase === 'ending'
            ? t('Speaking')
            : t('Interrupted')
  const badge = billing === 'api' ? t('API key · billed per minute') : t('ChatGPT plan')

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
          {problem ? <span className="voice-call-problem">{problem}</span> : <span className="meta">{`${t('GPT-Live')} · ${badge}`}</span>}
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
